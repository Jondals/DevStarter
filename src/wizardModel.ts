/**
 * wizardModel.ts
 * ──────────────
 * The UI-independent "brain" of the New Project wizard.
 *
 * Both front-ends share it:
 *   - wizard.ts           · quick mode, built with QuickPick / InputBox
 *   - webview/wizardPanel · visual mode, a full page inside VS Code
 *
 * It holds the draft being edited, decides which options apply to it (libraries, extras,
 * databases…), validates the name and turns the draft into the final ProjectChoice.
 * Nothing in here shows UI, so the rules live in one place and both modes behave the same.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findTemplate, Library, librariesFor, Preset, suggestName, Template, validateProjectName } from './templates';
import { PackageManager, PackageManagerId, ToolInfo } from './tools';
import { Database, needsServer } from './scaffold/database';
import { databaseOwner, Extra, ProjectChoice, usesNode } from './project';

/** What the wizard (either mode) needs from the extension. */
export interface WizardContext {
    globalState: vscode.Memento;
    packageManagers: Promise<PackageManager[]>;
    git: Promise<ToolInfo>;
    /** GitHub CLI (for the "Publish to GitHub" extra). Optional. */
    gh?: Promise<ToolInfo>;
    /** Template chosen beforehand (e.g. from the walkthrough). */
    preselect?: string;
}

/** Everything the person has chosen so far. Both wizard modes edit one of these. */
export interface Draft {
    beginner?: boolean;
    template?: Template;
    backend?: Template;
    typescript: boolean;
    tailwind: boolean;
    database?: Database;
    libraries: Set<string>;
    extras: Set<Extra>;
    pm: PackageManager;
    name?: string;
    parentDir?: string;
}

/** What gets stored for "Repeat last setup". */
export interface LastSetup {
    templateId: string;
    backendId?: string;
    typescript: boolean;
    tailwind: boolean;
    database?: Database;
    libraries?: string[];
    extras: Extra[];
    pmId: PackageManagerId;
    parentDir: string;
}

export const LAST_FOLDER_KEY = 'devstarter.lastParentFolder';
export const LAST_SETUP_KEY = 'devstarter.lastSetup';

// ─── Static descriptions ────────────────────────────────────────────

/** Codicon, label and beginner explanation of every database. */
export const databaseInfo: Record<Database, { icon: string; label: string; detail: string }> = {
    SQLite: {
        icon: 'file',
        label: 'SQLite',
        detail: 'Stored in a single file. Nothing else to install. Easiest to start.',
    },
    PostgreSQL: {
        icon: 'database',
        label: 'PostgreSQL',
        detail: 'Powerful SQL database. Needs a server (Docker, local install or a free cloud one).',
    },
    MySQL: {
        icon: 'database',
        label: 'MySQL',
        detail: 'Popular SQL database. Needs a server (Docker, local install or cloud).',
    },
    MongoDB: {
        icon: 'json',
        label: 'MongoDB',
        detail: 'Stores JSON-like documents. Needs MongoDB, Docker or a free Atlas cluster.',
    },
};

/** One-line explanation of each package manager. */
export const packageManagerInfo: Record<PackageManagerId, string> = {
    npm: 'Comes with Node.js. The safe default.',
    pnpm: 'Fast and saves disk space.',
    bun: 'Very fast all-in-one toolkit.',
};

/**
 * Short status text for a package manager ("v11.0.0", "not installed…").
 * @param p package manager as detected on this computer
 */
export function packageManagerStatus(p: PackageManager): string {
    if (p.version) {
        return `v${p.version}`;
    }
    return p.id === 'npm' ? 'will be installed with Node.js' : 'not installed · DevStarter will install it';
}

// ─── Building the draft ─────────────────────────────────────────────

/**
 * Default package manager: the preferred one if installed, otherwise the first (npm).
 * @param pms package managers detected on this computer
 * @param preferred id from the `defaultPackageManager` setting
 */
export function defaultPackageManager(pms: PackageManager[], preferred: PackageManagerId): PackageManager {
    let pm = pms[0];
    for (const p of pms) {
        if (p.id === preferred && p.version) {
            pm = p;
        }
    }
    return pm;
}

/**
 * Looks up a package manager by id.
 * @param pms detected package managers
 * @param id id to look for
 * @returns the match, or undefined
 */
export function findPackageManager(
    pms: PackageManager[],
    id: PackageManagerId | undefined,
): PackageManager | undefined {
    for (const p of pms) {
        if (p.id === id) {
            return p;
        }
    }
    return undefined;
}

/**
 * The draft the wizard starts with, based on the user's settings.
 * @param config the `devstarter` configuration section
 * @param pms detected package managers
 * @param git detected Git (Git is pre-ticked only when it is installed)
 * @param preselect template id chosen beforehand
 */
export function initialDraft(
    config: vscode.WorkspaceConfiguration,
    pms: PackageManager[],
    git: ToolInfo,
    preselect?: string,
): Draft {
    const level = config.get<string>('experienceLevel', '');
    const draft: Draft = {
        beginner: level ? level === 'beginner' : undefined,
        template: findTemplate(preselect),
        typescript: true,
        tailwind: true,
        libraries: new Set<string>(),
        extras: new Set<Extra>(['vscode']),
        pm: defaultPackageManager(pms, config.get<PackageManagerId>('defaultPackageManager', 'npm')),
    };
    if (git.version && config.get('initGit', true)) {
        draft.extras.add('git');
    }
    return draft;
}

/**
 * Fills the draft with an idea (template, libraries and options).
 * * The idea is only a starting point: every step stays editable afterwards.
 * @param d draft to fill
 * @param preset chosen idea
 */
export function applyPreset(d: Draft, preset: Preset): void {
    d.template = findTemplate(preset.template);
    d.backend = findTemplate(preset.backend);
    d.typescript = preset.typescript;
    d.tailwind = preset.tailwind;
    d.database = preset.database;
    d.libraries = new Set(preset.libraries);
}

/**
 * Fills the draft with the last setup that was used.
 * @param d draft to fill
 * @param last stored setup
 * @param pms detected package managers
 * @returns false if the stored template no longer exists
 */
export function applyLastSetup(d: Draft, last: LastSetup, pms: PackageManager[]): boolean {
    const template = findTemplate(last.templateId);
    if (!template) {
        return false;
    }
    d.template = template;
    d.backend = findTemplate(last.backendId);
    d.typescript = last.typescript;
    d.tailwind = last.tailwind;
    d.database = last.database;
    d.libraries = new Set(last.libraries ?? []);
    d.extras = new Set(last.extras);
    d.pm = findPackageManager(pms, last.pmId) ?? d.pm;
    d.parentDir = fs.existsSync(last.parentDir) ? last.parentDir : undefined;
    return true;
}

/**
 * Switches to another template and forgets the choices that make no sense for it.
 * @param d draft to update
 * @param template new template
 */
export function selectTemplate(d: Draft, template: Template): void {
    d.template = template;
    if (!template.acceptsBackend) {
        d.backend = undefined;
    }
}

// ─── What applies to the draft ──────────────────────────────────────

/** A library together with the part of the project it goes into. */
export interface AvailableLibrary {
    lib: Library;
    /** "frontend", "backend" or the template label for single-part projects. */
    part: string;
}

/**
 * Libraries that can be added to the current project (from the template and the backend).
 * @param d draft
 */
export function availableLibraries(d: Pick<Draft, 'template' | 'backend'>): AvailableLibrary[] {
    const result: AvailableLibrary[] = [];
    if (d.template) {
        for (const lib of librariesFor(d.template.id)) {
            result.push({ lib, part: d.backend ? 'frontend' : d.template.label });
        }
    }
    if (d.backend) {
        for (const lib of librariesFor(d.backend.id)) {
            result.push({ lib, part: 'backend' });
        }
    }
    return result;
}

/** A toggle in the "Extras" step. Tailwind lives here too because it is a yes/no option. */
export interface ExtraOption {
    value: Extra | 'tailwind';
    /** Codicon name. */
    icon: string;
    label: string;
    description: string;
    /** Explanation for beginners. */
    detail: string;
    /** Ticked right now. */
    picked: boolean;
    /** Recommended for beginners (DevStarter ticks it by default). */
    advised: boolean;
}

/**
 * Extras that make sense for the draft, in display order.
 * ! Git is always offered, even when Git is not installed: DevStarter installs it if needed.
 * @param d draft
 * @param git detected Git
 * @param gh detected GitHub CLI
 */
export function extraOptions(d: Draft, git: ToolInfo, gh?: ToolInfo): ExtraOption[] {
    const t = d.template;
    if (!t) {
        return [];
    }
    const items: ExtraOption[] = [];

    /** Adds one option; the ones DevStarter ticks by default are the recommended ones. */
    function add(value: ExtraOption['value'], icon: string, label: string, description: string, detail: string): void {
        const picked = value === 'tailwind' ? d.tailwind : d.extras.has(value);
        const advised = value === 'tailwind' || value === 'git' || value === 'vscode';
        items.push({ value, icon, label, description, detail, picked, advised });
    }

    if (t.tailwind) {
        add(
            'tailwind',
            'paintcan',
            'Tailwind CSS',
            'style with classes',
            'Utility classes like "text-xl font-bold". Very popular and fast to use.',
        );
    }
    add(
        'git',
        'git-branch',
        'Git repository',
        git.version ? 'version control' : 'Git will be installed',
        'Track your changes and undo mistakes. Creates the repository with a first commit.',
    );
    add(
        'publish',
        'github',
        'Publish to GitHub',
        gh?.version ? 'private repository' : 'GitHub CLI will be installed',
        'Creates a private repository on your GitHub account and uploads the project (needs "gh auth login" once).',
    );
    add(
        'vscode',
        'extensions',
        'Recommended VS Code extensions',
        'for this stack',
        'VS Code will offer to install the extensions that make this stack easier.',
    );
    if (needsServer(d.database)) {
        add(
            'compose',
            'server-environment',
            `Docker Compose for ${d.database}`,
            'needs Docker Desktop',
            `Start ${d.database} with one command: docker compose up -d`,
        );
    }
    if ((d.backend ?? t).docker) {
        add(
            'dockerfile',
            'package',
            'Dockerfile',
            'for deployment',
            'Package your backend as a container to deploy it anywhere.',
        );
    }
    if (t.ci || d.backend?.ci) {
        add(
            'ci',
            'github-action',
            'GitHub Actions CI',
            'build & test on push',
            'GitHub checks that your project builds every time you push.',
        );
    }
    if (usesNode({ template: t, backend: d.backend })) {
        add(
            'prettier',
            'wand',
            'Prettier',
            'code formatter',
            'Formats your code automatically so it always looks tidy.',
        );
    }
    add(
        'license',
        'law',
        'MIT License',
        'open source',
        'Lets others use your code freely. Uses your Git name as author.',
    );
    return items;
}

/**
 * Applies the ticked extras (and Tailwind) to the draft.
 * @param d draft to update
 * @param chosen values that are ticked
 */
export function setExtras(d: Draft, chosen: Iterable<ExtraOption['value']>): void {
    const set = new Set(chosen);
    d.tailwind = !!d.template?.tailwind && set.has('tailwind');
    d.extras = new Set<Extra>();
    for (const value of set) {
        if (value !== 'tailwind') {
            d.extras.add(value);
        }
    }
    // * Publishing needs a Git repository.
    if (d.extras.has('publish')) {
        d.extras.add('git');
    }
}

// ─── Folder and name ────────────────────────────────────────────────

/** A suggested parent folder. */
export interface FolderOption {
    icon: string;
    label: string;
    dir: string;
}

/**
 * Suggested parent folders: current workspace, last used one and Documents (no duplicates).
 * @param globalState extension storage (holds the last used folder)
 */
export function folderOptions(globalState: vscode.Memento): FolderOption[] {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const lastFolder = globalState.get<string>(LAST_FOLDER_KEY);
    const documents = path.join(os.homedir(), 'Documents');
    const candidates: Array<[string, string, string | undefined]> = [
        ['folder-opened', 'Current workspace', workspace],
        ['history', 'Last used folder', lastFolder && fs.existsSync(lastFolder) ? lastFolder : undefined],
        ['file-directory', 'Documents', fs.existsSync(documents) ? documents : undefined],
        ['home', 'Home', os.homedir()],
    ];
    const seen = new Set<string>();
    const result: FolderOption[] = [];
    for (const [icon, label, dir] of candidates) {
        if (dir && !seen.has(dir.toLowerCase())) {
            seen.add(dir.toLowerCase());
            result.push({ icon, label, dir });
        }
    }
    return result;
}

/**
 * A free default name: my-app, my-app-2, my-app-3… (or my_app_2 for snake_case stacks).
 * @param template chosen template (decides the name style)
 * @param parentDir folder where the project will be created
 */
export function freeName(template: Template, parentDir: string | undefined): string {
    const snake = template.nameStyle === 'snake';
    const base = snake ? 'my_app' : 'my-app';
    let value = base;
    for (let i = 2; parentDir && fs.existsSync(path.join(parentDir, value)); i++) {
        value = `${base}${snake ? '_' : '-'}${i}`;
    }
    return value;
}

/**
 * Checks a project name and, if it is not valid, suggests one that is.
 * @param name typed name
 * @param template chosen template (decides the name style)
 * @param parentDir folder where the project will be created
 * @returns an error message, or undefined if the name is fine
 */
export function checkName(name: string, template: Template, parentDir: string | undefined): string | undefined {
    const error = validateProjectName(name, template.nameStyle);
    if (error) {
        const suggestion = suggestName(name, template.nameStyle);
        const useful = suggestion && suggestion !== name && !validateProjectName(suggestion, template.nameStyle);
        return useful ? `${error}. How about "${suggestion}"?` : error;
    }
    if (parentDir && fs.existsSync(path.join(parentDir, name))) {
        return `A folder named "${name}" already exists there`;
    }
    return undefined;
}

// ─── Final result ───────────────────────────────────────────────────

/**
 * Turns the draft into the final choice, dropping options that do not apply
 * (e.g. a database the chosen backend does not support).
 * ! Expects `template`, `name` and `parentDir` to be set.
 * @param d draft
 */
export function toChoice(d: Draft): ProjectChoice {
    const template = d.template!;
    const backend = template.acceptsBackend ? d.backend : undefined;
    const owner = databaseOwner({ template, backend });
    const database = d.database && owner?.databases?.includes(d.database) ? d.database : undefined;
    const node = usesNode({ template, backend });

    const extras: Extra[] = [];
    for (const e of d.extras) {
        const valid =
            (e !== 'compose' || needsServer(database)) &&
            (e !== 'dockerfile' || !!(backend ?? template).docker) &&
            (e !== 'prettier' || node) &&
            (e !== 'ci' || !!template.ci || !!backend?.ci);
        if (valid) {
            extras.push(e);
        }
    }

    // Only the libraries that belong to the chosen templates.
    const available = new Set<string>();
    for (const { lib } of availableLibraries({ template, backend })) {
        available.add(lib.id);
    }
    const libraries: string[] = [];
    for (const id of d.libraries) {
        if (available.has(id)) {
            libraries.push(id);
        }
    }

    return {
        template,
        backend,
        typescript: !!template.languages && d.typescript,
        tailwind: !!template.tailwind && d.tailwind,
        database,
        libraries,
        extras,
        pm: d.pm,
        name: d.name!,
        parentDir: d.parentDir!,
        beginner: d.beginner ?? true,
    };
}

/**
 * Remembers the folder and the setup, for "Last used folder" and "Repeat last setup".
 * @param globalState extension storage
 * @param choice final choice
 */
export async function rememberChoice(globalState: vscode.Memento, choice: ProjectChoice): Promise<void> {
    const lastSetup: LastSetup = {
        templateId: choice.template.id,
        backendId: choice.backend?.id,
        typescript: choice.typescript,
        tailwind: choice.tailwind,
        database: choice.database,
        libraries: choice.libraries,
        extras: choice.extras,
        pmId: choice.pm.id,
        parentDir: choice.parentDir,
    };
    await globalState.update(LAST_FOLDER_KEY, choice.parentDir);
    await globalState.update(LAST_SETUP_KEY, lastSetup);
}
