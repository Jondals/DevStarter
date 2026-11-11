/**
 * webview/wizardPanel.ts
 * ──────────────────────
 * Visual mode of the New Project wizard: a full page inside a VS Code editor tab with cards,
 * live search, toggles and a live summary, instead of a chain of QuickPick lists.
 *
 * How it works:
 *   - The extension side (this file) owns the draft and every rule (via wizardModel.ts).
 *   - The page (media/wizard/wizard.js) is a "dumb" renderer: it sends what the person
 *     clicked, and this file answers with a fresh view model describing what to show.
 *
 * Screens: level (first run only) → pick (ideas and technologies) → configure (everything
 * editable, with a live summary) → Create. Closing the tab cancels.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { attachableBackends, findTemplate, presets, Template, templates } from '../templates';
import { PackageManager, PackageManagerId, ToolInfo } from '../tools';
import { Database } from '../scaffold/database';
import { databaseOwner, describe, plainSummary, ProjectChoice, usesNode } from '../project';
import { browseFolder } from '../wizard';
import {
    applyLastSetup,
    applyPreset,
    availableLibraries,
    checkName,
    databaseInfo,
    Draft,
    extraOptions,
    ExtraOption,
    findPackageManager,
    folderOptions,
    freeName,
    initialDraft,
    LAST_SETUP_KEY,
    LastSetup,
    packageManagerInfo,
    packageManagerStatus,
    rememberChoice,
    selectTemplate,
    setExtras,
    toChoice,
    WizardContext,
} from '../wizardModel';
import { logosForLibrary, logosForOther, logosForPreset, logosForTemplate } from './logos';

/** What the visual wizard resolves with: a choice, a request to use quick mode, or nothing (closed). */
export type PanelResult = ProjectChoice | 'quick' | undefined;

// ─── Messages shared with media/wizard/wizard.js ────────────────────
// ! Keep these shapes in sync with the page script.

/** A card on the "pick" screen (an idea or a technology). */
interface Card {
    kind: 'preset' | 'template';
    id: string;
    icon: string;
    /** Technology logos (media/wizard/logos.js slugs); the icon is the fallback. */
    logos?: string[];
    label: string;
    description: string;
    detail: string;
    /** Category for the filter chips ("Ideas" for presets). */
    category: string;
    recommended: boolean;
}

/** A selectable option on the "configure" screen. */
interface ViewOption {
    id: string;
    icon?: string;
    logos?: string[];
    label: string;
    description?: string;
    detail?: string;
    selected: boolean;
    recommended?: boolean;
}

/** Everything the page needs to draw the current screen. */
interface View {
    screen: 'level' | 'pick' | 'configure';
    beginner: boolean;
    /** Template being configured. */
    template?: { id: string; icon: string; label: string; description: string; logos?: string[] };
    /** Logos of the whole chosen stack (summary). */
    stackLogos?: string[];
    /** "Repeat last setup" card, if there is one. */
    last?: string;
    typescript?: boolean;
    backends?: ViewOption[];
    database?: { owner: string; options: ViewOption[] };
    libraries: Array<{ part: string; options: ViewOption[] }>;
    extras: ViewOption[];
    packageManagers?: ViewOption[];
    folders: ViewOption[];
    parentDir?: string;
    name: string;
    nameError?: string;
    target?: string;
    summary: string;
    plain: string;
}

/** Messages sent by the page. */
type Inbound =
    | { type: 'ready' }
    | { type: 'level'; beginner: boolean }
    | { type: 'start'; kind: 'template' | 'preset' | 'repeat'; id?: string }
    | { type: 'home' }
    | { type: 'set'; field: 'typescript'; value: boolean }
    | { type: 'set'; field: 'backend' | 'database' | 'pm' | 'parentDir' | 'name'; value: string }
    | { type: 'toggle'; field: 'library' | 'extra'; id: string; on: boolean }
    | { type: 'browse' }
    | { type: 'create' }
    | { type: 'quick' };

/** The one open wizard tab (opening the command again just reveals it). */
let current: vscode.WebviewPanel | undefined;

/**
 * Opens the visual wizard and waits until the person creates a project or closes the tab.
 * @param extensionUri root of the extension (to load the page files)
 * @param ctx data from the extension (tools, storage, preselected template)
 * @returns the choice, 'quick' to switch to quick mode, or undefined if closed
 */
export async function openWizardPanel(extensionUri: vscode.Uri, ctx: WizardContext): Promise<PanelResult> {
    if (current) {
        current.reveal();
        return undefined; // * the first call is still waiting for this tab
    }
    const panel = vscode.window.createWebviewPanel('devstarter.wizard', 'New Project', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, 'media'),
            vscode.Uri.joinPath(extensionUri, 'dist', 'codicons'),
        ],
    });
    current = panel;
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
    panel.webview.html = pageHtml(panel.webview, extensionUri);
    try {
        return await new WizardSession(panel, ctx).result;
    } finally {
        current = undefined;
    }
}

/**
 * One run of the visual wizard: holds the draft and answers the page's messages.
 */
class WizardSession {
    /** Resolves when the tab is closed or a project is confirmed. */
    readonly result: Promise<PanelResult>;
    private resolve!: (value: PanelResult) => void;
    private draft!: Draft;
    private screen: View['screen'] = 'pick';
    private pms: PackageManager[] = [];
    private git: ToolInfo = { id: 'git', name: 'Git', installUrl: '' };
    private gh?: ToolInfo;
    private last?: LastSetup;
    /** The person typed a name: stop proposing "my-app-2" when the folder changes. */
    private nameTouched = false;
    /** The session already resolved (created, switched to quick mode or closed). */
    private done = false;
    private readonly config = vscode.workspace.getConfiguration('devstarter');

    /**
     * @param panel webview tab to drive
     * @param ctx data from the extension
     */
    constructor(
        private readonly panel: vscode.WebviewPanel,
        private readonly ctx: WizardContext,
    ) {
        this.result = new Promise(
            function (this: WizardSession, resolve: (value: PanelResult) => void) {
                this.resolve = resolve;
            }.bind(this),
        );
        const onMessage = this.onMessage.bind(this);
        panel.webview.onDidReceiveMessage(function (message: Inbound) {
            // ! Errors would otherwise vanish inside the webview event loop.
            onMessage(message).catch(function (err: unknown) {
                void vscode.window.showErrorMessage(`DevStarter: ${err instanceof Error ? err.message : err}`);
            });
        });
        const finish = this.finish.bind(this);
        panel.onDidDispose(function () {
            finish(undefined);
        });
    }

    /**
     * Resolves the session once and closes the tab.
     * @param value what the wizard returns
     */
    private finish(value: PanelResult): void {
        // ! dispose() fires onDidDispose, which calls finish() again: only the first call counts.
        if (this.done) {
            return;
        }
        this.done = true;
        this.resolve(value);
        this.panel.dispose();
    }

    /**
     * Detects tools (in parallel) and builds the starting draft.
     */
    private async load(): Promise<void> {
        const [pms, git, gh] = await Promise.all([this.ctx.packageManagers, this.ctx.git, this.ctx.gh]);
        this.pms = pms;
        this.git = git;
        this.gh = gh;
        this.last = this.ctx.globalState.get<LastSetup>(LAST_SETUP_KEY);
        this.draft = initialDraft(this.config, pms, git, this.ctx.preselect);
        this.draft.parentDir = folderOptions(this.ctx.globalState)[0]?.dir;
        if (this.draft.beginner === undefined) {
            this.screen = 'level';
        } else if (this.draft.template) {
            this.enterConfigure();
        }
    }

    /**
     * Handles one message from the page and answers with the new view.
     * @param m message sent by the page
     */
    private async onMessage(m: Inbound): Promise<void> {
        const d = this.draft;
        switch (m.type) {
            case 'ready':
                await this.load();
                await this.panel.webview.postMessage({ type: 'init', cards: cards(), view: this.view() });
                return;
            case 'level':
                d.beginner = m.beginner;
                await this.config.update(
                    'experienceLevel',
                    m.beginner ? 'beginner' : 'experienced',
                    vscode.ConfigurationTarget.Global,
                );
                // * Only the first-run question moves on; the top-bar switch keeps the current screen.
                if (this.screen === 'level') {
                    this.screen = 'pick';
                    if (d.template) {
                        this.enterConfigure();
                    }
                }
                break;
            case 'start':
                this.start(m.kind, m.id);
                break;
            case 'home':
                this.screen = 'pick';
                break;
            case 'set':
                this.set(m);
                break;
            case 'toggle':
                this.toggle(m.field, m.id, m.on);
                break;
            case 'browse': {
                const dir = await browseFolder(d.parentDir);
                if (dir) {
                    this.setFolder(dir);
                }
                break;
            }
            case 'create':
                await this.create();
                return;
            case 'quick':
                this.finish('quick');
                return;
        }
        await this.panel.webview.postMessage({ type: 'view', view: this.view() });
    }

    /**
     * Starts configuring from a technology, an idea or the last setup.
     * @param kind what was clicked
     * @param id template or preset id
     */
    private start(kind: 'template' | 'preset' | 'repeat', id?: string): void {
        const d = this.draft;
        if (kind === 'repeat' && this.last) {
            applyLastSetup(d, this.last, this.pms);
            d.parentDir ??= folderOptions(this.ctx.globalState)[0]?.dir;
        } else if (kind === 'preset') {
            const preset = presets.find(function (p) {
                return p.id === id;
            });
            if (preset) {
                applyPreset(d, preset);
            }
        } else {
            const template = findTemplate(id);
            if (template) {
                selectTemplate(d, template);
            }
        }
        if (d.template) {
            this.enterConfigure();
        }
    }

    /**
     * Switches to the configure screen, proposing a free name if none was typed.
     */
    private enterConfigure(): void {
        this.screen = 'configure';
        if (!this.nameTouched && this.draft.template) {
            this.draft.name = freeName(this.draft.template, this.draft.parentDir);
        }
    }

    /**
     * Applies a single-value change.
     * @param m the "set" message
     */
    private set(m: Extract<Inbound, { type: 'set' }>): void {
        const d = this.draft;
        if (m.field === 'typescript') {
            d.typescript = m.value;
        } else if (m.field === 'backend') {
            d.backend = attachableBackends.find(function (b) {
                return b.id === m.value;
            });
        } else if (m.field === 'database') {
            d.database = (m.value || undefined) as Database | undefined;
        } else if (m.field === 'pm') {
            d.pm = findPackageManager(this.pms, m.value as PackageManagerId) ?? d.pm;
        } else if (m.field === 'parentDir') {
            this.setFolder(m.value);
        } else if (m.field === 'name') {
            d.name = m.value.trim();
            this.nameTouched = true;
        }
    }

    /**
     * Changes the parent folder and refreshes the proposed name.
     * @param dir new parent folder
     */
    private setFolder(dir: string): void {
        this.draft.parentDir = dir;
        if (!this.nameTouched && this.draft.template) {
            this.draft.name = freeName(this.draft.template, dir);
        }
    }

    /**
     * Ticks or unticks a library or an extra.
     * @param field which list
     * @param id library id or extra value
     * @param on ticked
     */
    private toggle(field: 'library' | 'extra', id: string, on: boolean): void {
        const d = this.draft;
        if (field === 'library') {
            if (on) {
                d.libraries.add(id);
            } else {
                d.libraries.delete(id);
            }
            return;
        }
        const ticked = new Set<ExtraOption['value']>();
        for (const option of extraOptions(d, this.git, this.gh)) {
            if (option.picked) {
                ticked.add(option.value);
            }
        }
        if (on) {
            ticked.add(id as ExtraOption['value']);
        } else {
            ticked.delete(id as ExtraOption['value']);
            // ? Unticking Git also unticks GitHub: publishing needs a repository.
            if (id === 'git') {
                ticked.delete('publish');
                ticked.delete('existing');
            }
        }
        setExtras(d, ticked, on ? id : undefined);
    }

    /**
     * Validates and, if everything is fine, closes the tab and returns the choice.
     */
    private async create(): Promise<void> {
        const d = this.draft;
        if (!d.template || !d.parentDir || !d.name || checkName(d.name, d.template, d.parentDir)) {
            await this.panel.webview.postMessage({ type: 'view', view: this.view() });
            return;
        }
        const choice = toChoice(d);
        await rememberChoice(this.ctx.globalState, choice);
        this.finish(choice);
    }

    /**
     * Builds the view model of the current state.
     */
    private view(): View {
        const d = this.draft;
        const beginner = d.beginner ?? true;
        const t = d.template;
        const view: View = {
            screen: this.screen,
            beginner,
            last: this.lastSummary(),
            libraries: [],
            extras: [],
            folders: [],
            name: d.name ?? '',
            summary: '',
            plain: '',
        };
        if (!t || this.screen !== 'configure') {
            return view;
        }
        view.template = {
            id: t.id,
            icon: t.icon,
            label: t.label,
            description: t.description,
            logos: logosForTemplate(t.id),
        };
        view.typescript = t.languages ? d.typescript : undefined;
        view.backends = t.acceptsBackend ? this.backendOptions() : undefined;
        view.database = this.databaseOptions();
        view.libraries = this.libraryGroups();
        view.extras = extraOptions(d, this.git, this.gh).map(function (o) {
            return {
                id: o.value,
                icon: o.icon,
                label: o.label,
                description: o.description,
                detail: o.detail,
                selected: o.picked,
                recommended: o.advised,
                logos: logosForOther(o.value),
            };
        });
        view.packageManagers = usesNode({ template: t, backend: d.backend }) ? this.pmOptions() : undefined;
        view.folders = folderOptions(this.ctx.globalState).map(function (f) {
            return { id: f.dir, icon: f.icon, label: f.label, description: f.dir, selected: f.dir === d.parentDir };
        });
        view.parentDir = d.parentDir;
        view.nameError = d.parentDir ? checkName(view.name, t, d.parentDir) : 'Choose a folder first';
        view.target = d.parentDir && view.name ? path.join(d.parentDir, view.name) : undefined;
        const choice = toChoice({ ...d, name: view.name, parentDir: d.parentDir ?? '' });
        view.summary = describe(choice);
        view.plain = plainSummary(choice);
        view.stackLogos = stackLogos(choice.template.id, d.backend?.id, d.database, view.packageManagers && d.pm.id);
        return view;
    }

    /**
     * One-line summary of the last setup, if it can be repeated.
     */
    private lastSummary(): string | undefined {
        const last = this.last;
        const template = findTemplate(last?.templateId);
        if (!last || !template) {
            return undefined;
        }
        return describe({
            template,
            backend: findTemplate(last.backendId),
            typescript: last.typescript,
            tailwind: last.tailwind,
            database: last.database,
            libraries: last.libraries ?? [],
            extras: last.extras,
            pm: findPackageManager(this.pms, last.pmId) ?? this.draft.pm,
        });
    }

    /** Backend options, "No backend" first. */
    private backendOptions(): ViewOption[] {
        const selected = this.draft.backend?.id ?? '';
        const options: ViewOption[] = [
            {
                id: '',
                icon: 'circle-slash',
                label: 'No backend',
                detail: 'Just the frontend. You can always add one later.',
                selected: selected === '',
            },
        ];
        for (const b of attachableBackends) {
            options.push(templateOption(b, b.id === selected));
        }
        return options;
    }

    /** Database options of the part that owns the database, or undefined if none does. */
    private databaseOptions(): View['database'] {
        const d = this.draft;
        const owner = databaseOwner({ template: d.template!, backend: d.backend });
        if (!owner) {
            return undefined;
        }
        const selected = d.database && owner.databases!.includes(d.database) ? d.database : '';
        const options: ViewOption[] = [
            {
                id: '',
                icon: 'circle-slash',
                label: 'No database',
                detail: 'Start simple. You can add one later.',
                selected: selected === '',
            },
        ];
        for (const db of owner.databases!) {
            options.push({
                id: db,
                icon: databaseInfo[db].icon,
                label: databaseInfo[db].label,
                description: db === 'SQLite' ? 'easiest' : undefined,
                detail: databaseInfo[db].detail,
                logos: logosForOther(db),
                selected: db === selected,
                recommended: db === 'SQLite',
            });
        }
        return { owner: owner.label, options };
    }

    /** Libraries grouped by part (frontend / backend). */
    private libraryGroups(): View['libraries'] {
        const groups: View['libraries'] = [];
        for (const { lib, part } of availableLibraries(this.draft)) {
            let group = groups[groups.length - 1];
            if (!group || group.part !== part) {
                group = { part, options: [] };
                groups.push(group);
            }
            group.options.push({
                id: lib.id,
                label: lib.label,
                description: lib.description,
                detail: lib.detail,
                selected: this.draft.libraries.has(lib.id),
                logos: logosForLibrary(lib.id),
            });
        }
        return groups;
    }

    /** Package manager options with their installed version. */
    private pmOptions(): ViewOption[] {
        const selected = this.draft.pm.id;
        return this.pms.map(function (p) {
            return {
                id: p.id,
                icon: 'package',
                label: p.id,
                description: packageManagerStatus(p),
                detail: packageManagerInfo[p.id],
                logos: logosForOther(p.id),
                selected: p.id === selected,
                recommended: p.id === 'npm',
            };
        });
    }
}

/**
 * A template shown as an option.
 * @param t template
 * @param selected currently chosen
 */
function templateOption(t: Template, selected: boolean): ViewOption {
    return {
        id: t.id,
        icon: t.icon,
        label: t.label,
        description: t.description,
        detail: t.detail,
        selected,
        recommended: t.recommended,
        logos: logosForTemplate(t.id),
    };
}

/**
 * Logos of the whole chosen stack, without repeats (for the summary).
 * @param templateId main template
 * @param backendId backend, if any
 * @param database database, if any
 * @param pm package manager, if the project uses one
 */
function stackLogos(templateId: string, backendId?: string, database?: string, pm?: string): string[] {
    const all = [
        ...(logosForTemplate(templateId) ?? []),
        ...(backendId ? (logosForTemplate(backendId) ?? []) : []),
        ...(database ? (logosForOther(database) ?? []) : []),
        ...(pm ? (logosForOther(pm) ?? []) : []),
    ];
    return [...new Set(all)];
}

/** Cards of the "pick" screen: every idea and every technology. */
function cards(): Card[] {
    const result: Card[] = [];
    for (const p of presets) {
        result.push({
            kind: 'preset',
            id: p.id,
            icon: p.icon,
            label: p.label,
            description: p.description,
            detail: p.detail,
            category: 'Ideas',
            recommended: false,
            logos: logosForPreset(p.id),
        });
    }
    for (const t of templates) {
        result.push({
            kind: 'template',
            id: t.id,
            icon: t.icon,
            label: t.label,
            description: t.description,
            detail: t.detail,
            category: t.category,
            recommended: !!t.recommended,
            logos: logosForTemplate(t.id),
        });
    }
    return result;
}

/**
 * HTML shell of the page. The content is drawn by media/wizard/wizard.js.
 * ! Strict Content-Security-Policy: only our own files and one nonce'd script can run.
 * @param webview the tab's webview (to build resource URIs)
 * @param extensionUri root of the extension
 */
function pageHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    /** URI the page can load for a file shipped with the extension. */
    function asset(...segments: string[]): vscode.Uri {
        return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments));
    }
    const nonce = crypto.randomBytes(16).toString('base64');
    const csp = [
        "default-src 'none'",
        `img-src ${webview.cspSource} data:`,
        `style-src ${webview.cspSource}`,
        `font-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('dist', 'codicons', 'codicon.css')}">
<link rel="stylesheet" href="${asset('media', 'wizard', 'wizard.css')}">
<title>New Project</title>
</head>
<body>
<div id="app" class="loading" data-logo="${asset('media', 'icon.png')}"><div class="spinner"></div><p>Checking your tools…</p></div>
<script nonce="${nonce}" src="${asset('media', 'wizard', 'logos.js')}"></script>
<script nonce="${nonce}" src="${asset('media', 'wizard', 'wizard.js')}"></script>
</body>
</html>`;
}
