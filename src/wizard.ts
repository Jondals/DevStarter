/**
 * wizard.ts
 * ─────────
 * Quick mode of the New Project wizard: a sequence of VS Code QuickPick / InputBox steps,
 * driven entirely from the keyboard. (The visual mode lives in webview/wizardPanel.ts;
 * both share the rules in wizardModel.ts.)
 *
 *   0. Experience level (first time only)
 *   1. What to build (an idea, a technology or "Repeat last setup")
 *   2. Language · 3. Backend · 4. Database · 5. Libraries · 6. Extras
 *   7. Package manager · 8. Folder · 9. Name · 10. Confirm
 *
 * Every step has a Back button, and steps that do not apply (e.g. picking a database for a
 * project without a backend) are skipped automatically.
 * * Ideas only pre-fill the answers: every step is still shown so anything can be changed.
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { attachableBackends, Category, findTemplate, Preset, presets, Template, templates } from './templates';
import { PackageManager, ToolInfo } from './tools';
import { Database } from './scaffold/database';
import { databaseOwner, describe, plainSummary, ProjectChoice, usesNode } from './project';
import {
    applyLastSetup,
    applyPreset,
    availableLibraries,
    checkName,
    databaseInfo,
    Draft,
    extraOptions,
    ExtraOption,
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
} from './wizardModel';

// ? Re-exported so existing imports (`import { WizardContext } from './wizard'`) keep working.
export { WizardContext } from './wizardModel';

const BACK = Symbol('back');
type Back = typeof BACK;
/** Result of a step: go on, go back, or cancel (undefined). */
type Outcome = 'next' | Back | undefined;

/** Position of the current step ("Step 2 of 7") and window title. */
interface Position {
    step: number;
    total: number;
    title: string;
}

/** A list item carrying a value. */
type Item<T> = vscode.QuickPickItem & { value: T };

// ─── Low-level inputs ───────────────────────────────────────────────
// * createQuickPick/createInputBox (instead of showQuickPick) let us show "Step 2 of 7" and a Back button.

/** Options of a list. */
interface PickOptions<T> {
    placeholder: string;
    items: T[];
    /** Allow ticking several options. */
    many?: boolean;
    /** Option highlighted when the list opens. */
    active?: T;
}

/**
 * Shows a list and waits until something is chosen.
 * @param pos step position and title
 * @param opts list options
 * @returns the chosen items, BACK if Back was pressed, or undefined if the list was closed
 */
function pick<T extends vscode.QuickPickItem>(
    pos: Position,
    opts: PickOptions<T>,
): Promise<readonly T[] | Back | undefined> {
    return new Promise(function (resolve) {
        const qp = vscode.window.createQuickPick<T>();
        let done = false;

        /** Resolves only once and closes the list. */
        function finish(value: readonly T[] | Back | undefined): void {
            if (!done) {
                done = true;
                resolve(value);
                qp.dispose();
            }
        }

        qp.title = pos.title;
        qp.step = pos.step;
        qp.totalSteps = pos.total;
        qp.placeholder = opts.placeholder;
        qp.items = opts.items;
        qp.canSelectMany = !!opts.many;
        qp.matchOnDescription = true;
        qp.matchOnDetail = true;
        qp.ignoreFocusOut = true; // * do not close when clicking elsewhere
        qp.buttons = pos.step > 1 ? [vscode.QuickInputButtons.Back] : [];
        if (opts.many) {
            qp.selectedItems = opts.items.filter(isPicked);
        } else if (opts.active) {
            qp.activeItems = [opts.active];
        }
        qp.onDidTriggerButton(function () {
            finish(BACK);
        });
        qp.onDidAccept(function () {
            finish(opts.many ? qp.selectedItems : qp.activeItems);
        });
        qp.onDidHide(function () {
            finish(undefined);
        });
        qp.show();
    });
}

/**
 * Whether an item starts ticked.
 * @param item list item
 */
function isPicked(item: vscode.QuickPickItem): boolean {
    return !!item.picked;
}

/** Options of a text field. */
interface InputOptions {
    prompt: string;
    placeholder: string;
    value: string;
    /** Returns an error message, or undefined if the text is valid. */
    validate: (v: string) => string | undefined;
}

/**
 * Shows a text field with live validation.
 * @param pos step position and title
 * @param opts field options
 * @returns the text, BACK if Back was pressed, or undefined if the field was closed
 */
function input(pos: Position, opts: InputOptions): Promise<string | Back | undefined> {
    return new Promise(function (resolve) {
        const box = vscode.window.createInputBox();
        let done = false;

        /** Resolves only once and closes the field. */
        function finish(value: string | Back | undefined): void {
            if (!done) {
                done = true;
                resolve(value);
                box.dispose();
            }
        }

        box.title = pos.title;
        box.step = pos.step;
        box.totalSteps = pos.total;
        box.prompt = opts.prompt;
        box.placeholder = opts.placeholder;
        box.value = opts.value;
        box.valueSelection = [0, opts.value.length];
        box.ignoreFocusOut = true;
        box.buttons = pos.step > 1 ? [vscode.QuickInputButtons.Back] : [];
        box.validationMessage = opts.validate(opts.value);
        box.onDidChangeValue(function (v) {
            box.validationMessage = opts.validate(v);
        });
        box.onDidTriggerButton(function () {
            finish(BACK);
        });
        box.onDidAccept(function () {
            const error = opts.validate(box.value);
            if (error) {
                box.validationMessage = error;
            } else {
                finish(box.value);
            }
        });
        box.onDidHide(function () {
            finish(undefined);
        });
        box.show();
    });
}

/**
 * Shortcut for single-choice steps.
 * @param pos step position and title
 * @param placeholder question shown in the list
 * @param items options
 * @param current value highlighted when the list opens
 * @returns { value } with the choice, BACK, or undefined if cancelled
 */
async function choose<T>(
    pos: Position,
    placeholder: string,
    items: Array<Item<T>>,
    current: T,
): Promise<{ value: T } | Back | undefined> {
    let active: Item<T> | undefined;
    for (const item of items) {
        if (item.value === current) {
            active = item;
        }
    }
    const result = await pick(pos, { placeholder, items, active });
    if (result === BACK) {
        return BACK;
    }
    return result?.[0] ? { value: result[0].value } : undefined;
}

// ─── Wizard state ───────────────────────────────────────────────────

/** The draft plus what only quick mode needs to know. */
interface State extends Draft {
    /** The experience question was shown in this run (so Back can return to it). */
    askedLevel: boolean;
    /** "Repeat last setup" was chosen: jump straight to the name. */
    repeat: boolean;
}

/** A step of the wizard: when it applies and what it does. */
interface WizardStep {
    applies(s: State): boolean;
    run(s: State, pos: Position): Promise<Outcome>;
}

const categoryLabels: Record<Category, string> = {
    Frontend: 'Frontend · websites & interfaces',
    'Full-stack': 'Full-stack · frontend + backend in one framework',
    Backend: 'Backend · APIs & servers',
    Mobile: 'Mobile · apps for your phone',
    Other: 'Other · scripts & more',
};

/** Data shared by every step. */
interface Shared {
    ctx: WizardContext;
    config: vscode.WorkspaceConfiguration;
    pms: PackageManager[];
    git: ToolInfo;
    gh?: ToolInfo;
    last?: LastSetup;
}

/** Marker of the option DevStarter recommends to beginners. */
const STAR = '⭐ Recommended';

/**
 * Prefixes the recommendation marker (beginner mode only).
 * @param beginner beginner mode
 * @param recommended the option is the recommended one
 * @param text option text (may be empty)
 */
function recommend(beginner: boolean | undefined, recommended: boolean | undefined, text?: string): string | undefined {
    if (!beginner || !recommended) {
        return text;
    }
    return text ? `${STAR} · ${text}` : STAR;
}

/**
 * Moves the recommended options to the top (beginner mode only), keeping the order of the rest.
 * @param list options
 * @param beginner beginner mode
 * @param isRecommended tells whether an option is recommended
 */
function recommendedFirst<T>(list: T[], beginner: boolean | undefined, isRecommended: (item: T) => boolean): T[] {
    if (!beginner) {
        return list;
    }
    const first: T[] = [];
    const rest: T[] = [];
    for (const item of list) {
        (isRecommended(item) ? first : rest).push(item);
    }
    return [...first, ...rest];
}

/**
 * Whether a template is recommended for beginners.
 * @param t template
 */
function isRecommendedTemplate(t: Template): boolean {
    return !!t.recommended;
}

// ─── Steps ──────────────────────────────────────────────────────────

/**
 * 0. Experience level.
 * @param sh shared data
 */
function levelStep(sh: Shared): WizardStep {
    return {
        applies(s) {
            return s.beginner === undefined || s.askedLevel;
        },
        async run(s, pos) {
            s.askedLevel = true;
            const result = await choose<boolean>(
                pos,
                'First time here! How much coding experience do you have?',
                [
                    {
                        label: "$(heart) I'm new to programming",
                        detail: 'Explanations at every step, a welcome page and a GETTING_STARTED guide.',
                        value: true,
                    },
                    {
                        label: '$(zap) I already know how to code',
                        detail: 'Fewer explanations, commands shown as they run, more options.',
                        value: false,
                    },
                ],
                s.beginner ?? true,
            );
            if (!result || result === BACK) {
                return result;
            }
            s.beginner = result.value;
            await sh.config.update(
                'experienceLevel',
                s.beginner ? 'beginner' : 'experienced',
                vscode.ConfigurationTarget.Global,
            );
            return 'next';
        },
    };
}

/** What can be chosen in step 1: repeat, an idea or a template. */
type StartChoice =
    { kind: 'repeat' } | { kind: 'preset'; preset: Preset } | { kind: 'template'; template: Template } | undefined;

/**
 * "Start from an idea" items (for people who do not know framework names yet).
 * @param beginner beginner mode (shows the explanation)
 */
function presetItems(beginner: boolean | undefined): Array<Item<StartChoice>> {
    const items: Array<Item<StartChoice>> = [
        {
            label: 'Start from an idea · no experience needed',
            kind: vscode.QuickPickItemKind.Separator,
            value: undefined,
        },
    ];
    for (const preset of presets) {
        items.push({
            label: `$(${preset.icon}) ${preset.label}`,
            description: preset.description,
            detail: beginner ? preset.detail : undefined,
            value: { kind: 'preset', preset },
        });
    }
    return items;
}

/**
 * Template items, grouped by category.
 * @param beginner beginner mode (shows explanations and recommended picks)
 */
function templateItems(beginner: boolean | undefined): Array<Item<StartChoice>> {
    const items: Array<Item<StartChoice>> = [];
    for (const category of Object.keys(categoryLabels) as Category[]) {
        items.push({ label: categoryLabels[category], kind: vscode.QuickPickItemKind.Separator, value: undefined });
        const inCategory = templates.filter(function (t) {
            return t.category === category;
        });
        for (const t of recommendedFirst(inCategory, beginner, isRecommendedTemplate)) {
            items.push({
                label: `$(${t.icon}) ${t.label}`,
                description: recommend(beginner, t.recommended, t.description),
                // * Experienced users get a more compact list.
                detail: beginner ? t.detail : undefined,
                value: { kind: 'template', template: t },
            });
        }
    }
    return items;
}

/**
 * 1. What to build: repeat the last setup, an idea or a specific template.
 * @param sh shared data
 */
function templateStep(sh: Shared): WizardStep {
    return {
        applies() {
            return !sh.ctx.preselect;
        },
        async run(s, pos) {
            s.repeat = false;
            const items: Array<Item<StartChoice>> = [];
            const last = sh.last;
            const lastTemplate = findTemplate(last?.templateId);
            if (last && lastTemplate) {
                const summary = describe({
                    template: lastTemplate,
                    backend: findTemplate(last.backendId),
                    typescript: last.typescript,
                    tailwind: last.tailwind,
                    database: last.database,
                    libraries: last.libraries ?? [],
                    extras: last.extras,
                    pm:
                        sh.pms.find(function (p) {
                            return p.id === last.pmId;
                        }) ?? s.pm,
                });
                items.push(
                    { label: 'Quick start', kind: vscode.QuickPickItemKind.Separator, value: undefined },
                    { label: '$(history) Repeat last setup', description: summary, value: { kind: 'repeat' } },
                );
            }
            // * Beginners: ideas first and then EVERY technology (recommended ones on top of each group).
            // * Experienced: technologies first and the ideas at the end.
            const shown: Array<Item<StartChoice>> = s.beginner
                ? [...items, ...presetItems(true), ...templateItems(true)]
                : [...items, ...templateItems(false), ...presetItems(false)];
            let active: Item<StartChoice> | undefined;
            for (const item of shown) {
                if (item.value?.kind === 'template' && item.value.template === s.template) {
                    active = item;
                }
            }
            const placeholder = s.beginner
                ? `What do you want to make? Pick an idea or a technology · ${STAR} = our pick for beginners (type to search)`
                : 'What do you want to build? (type to search)';
            const result = await pick(pos, { placeholder, items: shown, active });
            if (result === BACK || !result?.[0]?.value) {
                return result === BACK ? BACK : undefined;
            }
            const value = result[0].value;
            if (value.kind === 'repeat' && last) {
                s.repeat = applyLastSetup(s, last, sh.pms);
            } else if (value.kind === 'preset') {
                applyPreset(s, value.preset);
            } else if (value.kind === 'template') {
                selectTemplate(s, value.template);
            }
            return 'next';
        },
    };
}

/** 2. Language. */
function languageStep(): WizardStep {
    return {
        applies(s) {
            return !s.repeat && !!s.template?.languages;
        },
        async run(s, pos) {
            const result = await choose(
                pos,
                'Which language?',
                [
                    {
                        label: '$(symbol-type-parameter) TypeScript',
                        description: recommend(s.beginner, true, 'safer') ?? 'recommended',
                        detail: s.beginner
                            ? 'JavaScript with types: your editor catches mistakes before you run the code.'
                            : undefined,
                        value: true,
                    },
                    {
                        label: '$(symbol-variable) JavaScript',
                        detail: s.beginner ? 'Simpler to start with, no types.' : undefined,
                        value: false,
                    },
                ],
                s.typescript,
            );
            if (!result || result === BACK) {
                return result;
            }
            s.typescript = result.value;
            return 'next';
        },
    };
}

/** 3. Backend (for frontends and mobile apps). */
function backendStep(): WizardStep {
    return {
        applies(s) {
            return !s.repeat && !!s.template?.acceptsBackend;
        },
        async run(s, pos) {
            const items: Array<Item<Template | undefined>> = [
                {
                    label: '$(circle-slash) No backend',
                    detail: s.beginner ? 'Just the frontend. You can always add one later.' : undefined,
                    value: undefined,
                },
            ];
            for (const b of recommendedFirst(attachableBackends, s.beginner, isRecommendedTemplate)) {
                items.push({
                    label: `$(${b.icon}) ${b.label}`,
                    description: recommend(s.beginner, b.recommended, b.description),
                    detail: s.beginner ? b.detail : undefined,
                    value: b,
                });
            }
            const result = await choose(pos, 'Add a backend (API) to your project?', items, s.backend);
            if (!result || result === BACK) {
                return result;
            }
            s.backend = result.value;
            return 'next';
        },
    };
}

/** 4. Database. */
function databaseStep(): WizardStep {
    return {
        // ? Before the template is chosen we cannot know yet; this is also used to compute "Step X of Y".
        applies(s) {
            return !s.repeat && !!s.template && !!databaseOwner({ template: s.template, backend: s.backend });
        },
        async run(s, pos) {
            const owner = databaseOwner({ template: s.template!, backend: s.backend })!;
            const items: Array<Item<Database | undefined>> = [
                {
                    label: '$(circle-slash) No database',
                    detail: s.beginner ? 'Start simple. You can add one later.' : undefined,
                    value: undefined,
                },
            ];
            for (const db of owner.databases!) {
                items.push({
                    label: `$(${databaseInfo[db].icon}) ${databaseInfo[db].label}`,
                    description: db === 'SQLite' ? (recommend(s.beginner, true, 'easiest') ?? 'easiest') : undefined,
                    detail: s.beginner ? databaseInfo[db].detail : undefined,
                    value: db,
                });
            }
            const current = s.database && owner.databases!.includes(s.database) ? s.database : undefined;
            const result = await choose(pos, `Do you want database integration in ${owner.label}?`, items, current);
            if (!result || result === BACK) {
                return result;
            }
            s.database = result.value;
            return 'next';
        },
    };
}

/** 5. Libraries. */
function librariesStep(): WizardStep {
    return {
        applies(s) {
            return !s.repeat && !!s.template && availableLibraries(s).length > 0;
        },
        async run(s, pos) {
            const items: Array<Item<string>> = [];
            let lastPart = '';
            for (const { lib, part } of availableLibraries(s)) {
                // * One separator per part (frontend / backend) in full-stack projects.
                if (part !== lastPart) {
                    items.push({ label: part, kind: vscode.QuickPickItemKind.Separator, value: '' });
                    lastPart = part;
                }
                items.push({
                    label: lib.label,
                    description: lib.description,
                    detail: s.beginner ? lib.detail : undefined,
                    picked: s.libraries.has(lib.id),
                    value: lib.id,
                });
            }
            const result = await pick(pos, {
                placeholder: 'Add popular libraries? (optional · Space to toggle, Enter to continue)',
                items,
                many: true,
            });
            if (result === BACK || !result) {
                return result === BACK ? BACK : undefined;
            }
            s.libraries = new Set<string>();
            for (const item of result) {
                if (item.value) {
                    s.libraries.add(item.value);
                }
            }
            return 'next';
        },
    };
}

/**
 * 6. Extras (Tailwind, Git, GitHub, CI…).
 * @param sh shared data
 */
function extrasStep(sh: Shared): WizardStep {
    return {
        applies(s) {
            return !s.repeat && !!s.template;
        },
        async run(s, pos) {
            const items: Array<Item<ExtraOption['value']>> = [];
            for (const option of extraOptions(s, sh.git, sh.gh)) {
                items.push({
                    label: `$(${option.icon}) ${option.label}`,
                    description: recommend(s.beginner, option.advised, option.description),
                    detail: s.beginner ? option.detail : undefined,
                    picked: option.picked,
                    value: option.value,
                });
            }
            const result = await pick(pos, {
                placeholder: 'Extras (Space to toggle, Enter to continue)',
                items,
                many: true,
            });
            if (result === BACK || !result) {
                return result === BACK ? BACK : undefined;
            }
            setExtras(
                s,
                result.map(function (item) {
                    return item.value;
                }),
            );
            return 'next';
        },
    };
}

/**
 * 7. Package manager.
 * @param sh shared data
 */
function packageManagerStep(sh: Shared): WizardStep {
    return {
        applies(s) {
            return !s.repeat && !!s.template && usesNode({ template: s.template, backend: s.backend });
        },
        async run(s, pos) {
            const items: Array<Item<PackageManager>> = [];
            for (const p of sh.pms) {
                items.push({
                    label: `$(package) ${p.id}`,
                    description: recommend(s.beginner, p.id === 'npm', packageManagerStatus(p)),
                    detail: s.beginner ? packageManagerInfo[p.id] : undefined,
                    value: p,
                });
            }
            const result = await choose(pos, 'Package manager', items, s.pm);
            if (!result || result === BACK) {
                return result;
            }
            s.pm = result.value;
            return 'next';
        },
    };
}

/**
 * 8. Folder where the project is created.
 * @param sh shared data
 */
function locationStep(sh: Shared): WizardStep {
    return {
        applies(s) {
            return !s.repeat || !s.parentDir;
        },
        async run(s, pos) {
            const items: Array<Item<string | undefined>> = [];
            for (const option of folderOptions(sh.ctx.globalState)) {
                items.push({ label: `$(${option.icon}) ${option.label}`, description: option.dir, value: option.dir });
            }
            items.push({ label: '$(search) Browse…', detail: 'Choose any folder on your computer', value: undefined });

            while (true) {
                let active = items[0];
                for (const item of items) {
                    if (item.value && item.value === s.parentDir) {
                        active = item;
                    }
                }
                const result = await pick(pos, {
                    placeholder: 'Where should the project folder be created?',
                    items,
                    active,
                });
                if (result === BACK || !result?.[0]) {
                    return result === BACK ? BACK : undefined;
                }
                const dir = result[0].value ?? (await browseFolder(s.parentDir));
                if (!dir) {
                    continue; // * the dialog was cancelled: back to the list
                }
                s.parentDir = dir;
                return 'next';
            }
        },
    };
}

/**
 * Opens the system folder picker.
 * @param current folder to start in
 * @returns the chosen folder, or undefined if cancelled
 */
export async function browseFolder(current?: string): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Create project here',
        defaultUri: current ? vscode.Uri.file(current) : undefined,
    });
    return picked?.[0]?.fsPath;
}

/** 9. Project name. */
function nameStep(): WizardStep {
    return {
        applies() {
            return true;
        },
        async run(s, pos) {
            const t = s.template!;
            const result = await input(pos, {
                prompt: `The folder will be created in ${s.parentDir}`,
                placeholder: t.nameStyle === 'snake' ? 'my_app' : 'my-app',
                value: s.name ?? freeName(t, s.parentDir),
                validate: function (v) {
                    return checkName(v, t, s.parentDir);
                },
            });
            if (result === BACK || result === undefined) {
                return result;
            }
            s.name = result;
            return 'next';
        },
    };
}

/** 10. Confirmation. */
function confirmStep(): WizardStep {
    return {
        applies() {
            return true;
        },
        async run(s, pos) {
            const items: Array<Item<'create' | 'back' | 'cancel'>> = [
                {
                    label: '$(rocket) Create project',
                    description: path.join(s.parentDir!, s.name!),
                    // * Beginners get a plain sentence; experienced users the one-line technical summary.
                    detail: s.beginner
                        ? `${plainSummary(toChoice(s))} Anything missing on your computer gets installed for you.`
                        : describe(toChoice(s)),
                    value: 'create',
                },
                { label: '$(arrow-left) Change something', value: 'back' },
                { label: '$(close) Cancel', value: 'cancel' },
            ];
            const result = await pick(pos, { placeholder: `Ready to create "${s.name}"?`, items });
            if (result === BACK || result?.[0]?.value === 'back') {
                return BACK;
            }
            return result?.[0]?.value === 'create' ? 'next' : undefined;
        },
    };
}

// ─── Wizard engine ──────────────────────────────────────────────────

/**
 * Runs the whole quick-mode wizard.
 * @param ctx data from the extension
 * @returns the final choice, or undefined if cancelled
 */
export async function runWizard(ctx: WizardContext): Promise<ProjectChoice | undefined> {
    const config = vscode.workspace.getConfiguration('devstarter');
    const [pms, git, gh] = await Promise.all([ctx.packageManagers, ctx.git, ctx.gh]);
    const sh: Shared = { ctx, config, pms, git, gh, last: ctx.globalState.get<LastSetup>(LAST_SETUP_KEY) };
    const state: State = { ...initialDraft(config, pms, git, ctx.preselect), askedLevel: false, repeat: false };

    const steps: WizardStep[] = [
        levelStep(sh),
        templateStep(sh),
        languageStep(),
        backendStep(),
        databaseStep(),
        librariesStep(),
        extrasStep(sh),
        packageManagerStep(sh),
        locationStep(sh),
        nameStep(),
        confirmStep(),
    ];

    // * Walk the steps that apply, remembering the path so Back can retrace it.
    const history: number[] = [];
    let i = 0;
    while (i < steps.length) {
        if (!steps[i].applies(state)) {
            i++;
            continue;
        }
        const applicable = steps.filter(function (st) {
            return st.applies(state);
        });
        const pos: Position = {
            step: applicable.indexOf(steps[i]) + 1,
            total: applicable.length,
            title: state.template ? `DevStarter · New ${state.template.label} project` : 'DevStarter · New project',
        };
        const outcome = await steps[i].run(state, pos);
        if (outcome === undefined) {
            return undefined;
        }
        if (outcome === BACK) {
            i = history.pop() ?? 0;
        } else {
            history.push(i);
            i++;
        }
    }

    const choice = toChoice(state);
    await rememberChoice(ctx.globalState, choice);
    return choice;
}
