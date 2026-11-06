/**
 * project.ts
 * ──────────
 * Gathers everything chosen in the wizard (template, optional backend, database,
 * libraries and extras) and turns it into a list of steps that the terminal runs in order.
 *
 *   Single project:     <folder>/<name>/...
 *   Full-stack project: <folder>/<name>/frontend   (or mobile)
 *                       <folder>/<name>/backend
 *                       <folder>/<name>/package.json  ← "npm run dev" starts both
 */
import * as fs from 'fs';
import * as path from 'path';
import { Step } from './terminal';
import { cmd, findLibraries, Library, librarySteps, PartOptions, Plan, task, Template } from './templates';
import { PackageManager, ToolId } from './tools';
import { Database, needsServer } from './scaffold/database';
import { writeDatabaseCompose } from './scaffold/docker';
import { ensureGitignore, relaxPnpmBuilds } from './scaffold/files';
import {
    CiPart,
    configurePrettier,
    DevServer,
    GuideInfo,
    writeEditorConfig,
    writeFullstackRoot,
    writeGettingStarted,
    writeGithubActions,
    writeMitLicense,
    writeRootReadme,
    writeVscodeRecommendations,
} from './scaffold/extras';

/** Extras that can be ticked in the wizard. */
export type Extra = 'git' | 'publish' | 'ci' | 'license' | 'compose' | 'dockerfile' | 'prettier' | 'vscode';

/** What the wizard returns. */
export interface ProjectChoice {
    template: Template;
    /** Backend added to a frontend or mobile app (full-stack project). */
    backend?: Template;
    typescript: boolean;
    tailwind: boolean;
    database?: Database;
    /** Ids of the chosen libraries (frontend and backend). */
    libraries: string[];
    extras: Extra[];
    pm: PackageManager;
    name: string;
    parentDir: string;
    beginner: boolean;
}

/** The complete plan of the project. */
export interface BuiltProject {
    root: string;
    steps: Step[];
    /** Servers to start, with their folder relative to the root. */
    servers: DevServer[];
    /** Command that starts everything from the root (full-stack with Node). */
    devAll?: string;
    /** Candidates for the main file, relative to the root. */
    mainFiles: string[];
}

/** The minimum needed to know which parts a project has. */
interface Parts {
    template: Template;
    backend?: Template;
}

/**
 * The template in charge of the database: the backend if there is one, otherwise the main one.
 * @param choice template and backend
 */
export function databaseOwner(choice: Parts): Template | undefined {
    const owner = choice.backend ?? choice.template;
    return owner?.databases?.length ? owner : undefined;
}

/**
 * Whether any part of the project uses npm/pnpm/bun.
 * @param choice template and backend
 */
export function usesNode(choice: Parts): boolean {
    return !!choice.template?.node || !!choice.backend?.node;
}

/**
 * Tools that must be installed before starting.
 * ? Node goes first because pnpm and bun are installed with it.
 * @param choice the wizard's choice
 */
export function requiredTools(choice: ProjectChoice): ToolId[] {
    const tools = new Set<ToolId>([...choice.template.requires, ...(choice.backend?.requires ?? [])]);
    if (choice.extras.includes('git') || choice.extras.includes('publish')) {
        tools.add('git');
    }
    if (choice.extras.includes('publish')) {
        tools.add('gh');
    }
    const list = [...tools];
    list.sort(nodeFirst);
    return list;
}

/** Order: Node first, the rest as they were. */
function nodeFirst(a: ToolId, b: ToolId): number {
    if (a === 'node') {
        return -1;
    }
    return b === 'node' ? 1 : 0;
}

/**
 * One-line summary, e.g. "React · TypeScript · Tailwind CSS + Express API · PostgreSQL · 3 libraries · Git · npm".
 * @param choice choice (without name or folder)
 */
export function describe(choice: Omit<ProjectChoice, 'name' | 'parentDir' | 'beginner'>): string {
    const t = choice.template;
    const head: string[] = [t.label];
    if (t.languages) {
        head.push(choice.typescript ? 'TypeScript' : 'JavaScript');
    }
    if (t.tailwind && choice.tailwind) {
        head.push('Tailwind CSS');
    }
    const rest: string[] = [];
    if (databaseOwner(choice) && choice.database) {
        rest.push(choice.database);
    }
    const libs = choice.libraries?.length ?? 0;
    if (libs) {
        rest.push(`${libs} ${libs === 1 ? 'library' : 'libraries'}`);
    }
    const extraNames: Array<[Extra, string]> = [
        ['compose', 'Docker Compose'],
        ['dockerfile', 'Dockerfile'],
        ['prettier', 'Prettier'],
        ['ci', 'CI'],
        ['git', 'Git'],
        ['publish', 'GitHub'],
    ];
    for (const [extra, label] of extraNames) {
        if (choice.extras.includes(extra) && (extra !== 'compose' || needsServer(choice.database))) {
            rest.push(label);
        }
    }
    if (usesNode(choice)) {
        rest.push(choice.pm.id);
    }
    return [head.join(' · ') + (choice.backend ? ` + ${choice.backend.label}` : ''), ...rest].join(' · ');
}

/** Plain-language name of what will be created, by template category. */
const plainNouns: Record<Template['category'], string> = {
    Frontend: 'a website',
    'Full-stack': 'a web app',
    Backend: 'a server (API)',
    Mobile: 'a mobile app',
    Other: 'a project',
};

/**
 * Puts "a" or "an" before a word ("an Express", "a Django").
 * @param word word the article goes with
 */
function withArticle(word: string): string {
    return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

/**
 * "Human" summary of what will be created, without acronyms or symbols:
 * "A website made with React and TypeScript, styled with Tailwind CSS, with an Express API
 * backend and a SQLite database, plus Zustand and GSAP."
 * @param choice the wizard's choice
 */
export function plainSummary(choice: Omit<ProjectChoice, 'name' | 'parentDir' | 'beginner'>): string {
    const t = choice.template;
    const noun = plainNouns[t.category];
    let text = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} made with ${t.label}`;
    if (t.languages && choice.typescript) {
        text += ' and TypeScript';
    }
    if (t.tailwind && choice.tailwind) {
        text += ', styled with Tailwind CSS';
    }
    if (choice.backend) {
        text += `, with ${withArticle(choice.backend.label)} backend`;
    }
    if (choice.database && databaseOwner(choice)) {
        text += `${choice.backend ? ' and' : ', with'} ${withArticle(choice.database)} database`;
    }
    const names: string[] = [];
    for (const lib of findLibraries(choice.libraries)) {
        names.push(lib.label);
    }
    if (names.length) {
        const shown = names.slice(0, 3).join(', ');
        text += `, plus ${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
    }
    return `${text}.`;
}

/**
 * Whether the template uses Python.
 * @param t template (or none)
 */
function isPython(t?: Template): boolean {
    return !!t?.requires.includes('python');
}

/**
 * Splits the chosen libraries between the main part and the backend.
 * @param choice the wizard's choice
 */
function splitLibraries(choice: ProjectChoice): { front: Library[]; back: Library[] } {
    const front: Library[] = [];
    const back: Library[] = [];
    for (const lib of findLibraries(choice.libraries)) {
        if (choice.backend && lib.templates.includes(choice.backend.id)) {
            back.push(lib);
        } else if (lib.templates.includes(choice.template.id)) {
            front.push(lib);
        }
    }
    return { front, back };
}

/**
 * Ids of a list of libraries.
 * @param libs libraries
 */
function ids(libs: Library[]): string[] {
    const result: string[] = [];
    for (const lib of libs) {
        result.push(lib.id);
    }
    return result;
}

/**
 * Builds the complete plan of the project.
 * @param choice the wizard's choice
 * @param python system Python command (for Python templates)
 */
export function buildProject(choice: ProjectChoice, python?: string): BuiltProject {
    const { template, backend, name, pm } = choice;
    const fullstack = !!backend;
    const root = path.join(choice.parentDir, name);
    const extras = new Set(choice.extras);
    const libs = splitLibraries(choice);
    const steps: Step[] = [];

    // ── Options of each part
    const frontFolder = fullstack ? (template.category === 'Mobile' ? 'mobile' : 'frontend') : name;
    const frontParent = fullstack ? root : choice.parentDir;
    const front: PartOptions = {
        name,
        packageName: fullstack ? `${name}-${frontFolder}` : name,
        parentDir: frontParent,
        folder: frontFolder,
        dir: path.join(frontParent, frontFolder),
        typescript: choice.typescript,
        tailwind: choice.tailwind,
        database: fullstack ? undefined : choice.database,
        pm,
        python,
        beginner: choice.beginner,
        backendUrl: fullstack ? `http://localhost:${backend!.port}` : undefined,
        dockerfile: !fullstack && extras.has('dockerfile'),
        libraries: ids(libs.front),
    };
    const frontPlan: Plan = template.plan(front);

    let back: PartOptions | undefined;
    let backPlan: Plan | undefined;
    if (backend) {
        steps.push(
            task('Creating project folder', function () {
                fs.mkdirSync(root, { recursive: true });
            }),
        );
        back = {
            ...front,
            packageName: `${name}-backend`,
            parentDir: root,
            folder: 'backend',
            dir: path.join(root, 'backend'),
            typescript: false,
            tailwind: false,
            database: choice.database,
            backendUrl: undefined,
            dockerfile: extras.has('dockerfile'),
            libraries: ids(libs.back),
        };
        backPlan = backend.plan(back);
    }

    steps.push(...frontPlan.steps, ...librarySteps(libs.front, front));
    if (backPlan && back) {
        steps.push(...backPlan.steps, ...librarySteps(libs.back, back));
    }

    // ── Dev servers
    const servers: DevServer[] = [];
    if (frontPlan.server) {
        const label = fullstack ? (template.category === 'Mobile' ? 'Mobile app' : 'Frontend') : template.label;
        servers.push({ label, folder: fullstack ? frontFolder : '', ...frontPlan.server });
    }
    if (backPlan?.server) {
        servers.push({ label: 'Backend', folder: 'backend', ...backPlan.server });
    }

    // ── Full-stack root: one "npm run dev" that starts frontend and backend together
    let devAll: string | undefined;
    if (fullstack && usesNode(choice) && servers.length > 1) {
        const runAll = pm.run('dev');
        devAll = runAll;
        steps.push(
            task('Writing root package.json', function (log) {
                writeFullstackRoot(root, name, servers);
                log(`"${runAll}" starts frontend and backend together`);
            }),
            cmd('Installing concurrently', pm.add(['concurrently'], true), root),
        );
    }

    steps.push(...extraSteps(choice, { root, front, back, devAll }));

    // ── Guide or README
    const mainFiles: string[] = [];
    for (const f of frontPlan.mainFiles) {
        mainFiles.push(fullstack ? `${frontFolder}/${f}` : f);
    }
    const guideContext: GuideContext = {
        root,
        frontDir: front.dir,
        servers,
        devAll,
        mainFiles,
        frontPlan,
        backPlan,
        libraries: [...libs.front, ...libs.back],
    };
    if (choice.beginner) {
        steps.push(
            task(
                'Writing GETTING_STARTED.md',
                function () {
                    writeGettingStarted(root, buildGuideInfo(choice, guideContext));
                },
                true,
            ),
        );
    } else if (fullstack) {
        steps.push(
            task(
                'Writing README.md',
                function () {
                    writeRootReadme(root, buildGuideInfo(choice, guideContext));
                },
                true,
            ),
        );
    }

    steps.push(...gitSteps(choice, root, front, back));
    return { root, steps, servers, devAll, mainFiles };
}

/** Data the extras steps need. */
interface ExtraContext {
    root: string;
    front: PartOptions;
    back?: PartOptions;
    devAll?: string;
}

/**
 * Steps of the extras: Docker Compose, Prettier, CI, license, pnpm and editor settings.
 * @param choice the wizard's choice
 * @param ctx folders and options of each part
 */
function extraSteps(choice: ProjectChoice, ctx: ExtraContext): Step[] {
    const { template, backend, pm, name } = choice;
    const extras = new Set(choice.extras);
    const { root, front, back, devAll } = ctx;
    const steps: Step[] = [];

    if (extras.has('compose') && needsServer(choice.database)) {
        steps.push(
            task('Writing docker-compose.yml', function (log) {
                writeDatabaseCompose(root, choice.database!, name);
                log(`Start ${choice.database} with: docker compose up -d`);
            }),
        );
    }

    if (extras.has('prettier') && usesNode(choice)) {
        // ? In full-stack projects configuring it at the root is enough; it formats everything below it.
        let prettierDir = front.dir;
        if (devAll) {
            prettierDir = root;
        } else if (!template.node && back) {
            prettierDir = back.dir;
        }
        steps.push(
            task('Configuring Prettier', function () {
                configurePrettier(prettierDir);
            }),
            cmd('Installing Prettier', pm.add(['prettier'], true), prettierDir),
        );
    }

    if (extras.has('ci')) {
        const parts: CiPart[] = [];
        if (template.ci) {
            parts.push({
                job: backend ? front.folder : 'build',
                folder: backend ? front.folder : '',
                kind: template.ci,
            });
        }
        if (backend?.ci && back) {
            parts.push({ job: 'backend', folder: 'backend', kind: backend.ci });
        }
        steps.push(
            task('Writing GitHub Actions workflow', function (log) {
                writeGithubActions(root, parts, pm);
                log('.github/workflows/ci.yml builds and tests on every push');
            }),
        );
    }

    if (extras.has('license')) {
        steps.push(
            task('Writing LICENSE (MIT)', function () {
                writeMitLicense(root);
            }),
        );
    }

    // ! pnpm: make sure "pnpm dev" does not fail because of unapproved build scripts.
    if (pm.id === 'pnpm' && usesNode(choice)) {
        steps.push(
            task(
                'Configuring pnpm',
                function () {
                    for (const dir of [front.dir, path.join(root, 'backend'), root]) {
                        if (fs.existsSync(path.join(dir, 'package.json'))) {
                            relaxPnpmBuilds(dir);
                        }
                    }
                },
                true,
            ),
        );
    }

    steps.push(
        task(
            'Writing editor settings',
            function (log) {
                writeEditorConfig(root);
                if (extras.has('vscode')) {
                    writeVscodeRecommendations(root, recommendedExtensions(choice), editorSettings(choice));
                    log('.vscode/extensions.json (VS Code will offer to install them)');
                }
            },
            true,
        ),
    );
    return steps;
}

/**
 * Recommended VS Code extensions for the chosen templates and extras.
 * @param choice the wizard's choice
 */
function recommendedExtensions(choice: ProjectChoice): string[] {
    const extras = new Set(choice.extras);
    const list = [...choice.template.vscode, ...(choice.backend?.vscode ?? [])];
    if (extras.has('prettier')) {
        list.push('esbenp.prettier-vscode');
    }
    if (extras.has('compose') || extras.has('dockerfile')) {
        list.push('ms-azuretools.vscode-containers');
    }
    if (extras.has('ci')) {
        list.push('github.vscode-github-actions');
    }
    if (choice.database && choice.database !== 'MongoDB') {
        list.push('cweijan.vscode-database-client2');
    }
    return list;
}

/**
 * Workspace settings: with Python, make VS Code use the .venv directly.
 * @param choice the wizard's choice
 */
function editorSettings(choice: ProjectChoice): Record<string, unknown> {
    let folder: string | undefined;
    if (isPython(choice.backend)) {
        folder = 'backend';
    } else if (isPython(choice.template) && !choice.backend) {
        folder = '';
    }
    if (folder === undefined) {
        return {};
    }
    const python = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
    const parts = ['${workspaceFolder}', folder, '.venv', python].filter(Boolean);
    return { 'python.defaultInterpreterPath': parts.join('/') };
}

/** Data for the guide. */
interface GuideContext {
    root: string;
    /** Folder of the frontend (or of the main part). */
    frontDir: string;
    servers: DevServer[];
    devAll?: string;
    mainFiles: string[];
    frontPlan: Plan;
    backPlan?: Plan;
    libraries: Library[];
}

/**
 * Gathers the information for GETTING_STARTED.md / README.md.
 * @param choice the wizard's choice
 * @param ctx data computed while building the project
 */
function buildGuideInfo(choice: ProjectChoice, ctx: GuideContext): GuideInfo {
    const extras = new Set(choice.extras);
    const list: string[] = [];
    if (choice.tailwind && choice.template.tailwind) {
        list.push('Tailwind CSS v4');
    }
    if (choice.backend) {
        list.push(`A ${choice.backend.label} backend in \`backend/\`, connected to the frontend`);
    }
    if (choice.database && databaseOwner(choice)) {
        list.push(`${choice.database} connection (settings in \`.env\`)`);
    }
    const extraTexts: Array<[Extra, string]> = [
        ['compose', 'docker-compose.yml to start the database'],
        ['dockerfile', 'A Dockerfile for the backend'],
        ['prettier', 'Prettier code formatter (`format` script)'],
        ['ci', 'GitHub Actions workflow (`.github/workflows/ci.yml`)'],
        ['license', 'MIT license'],
        ['vscode', 'Recommended VS Code extensions'],
        ['git', 'A Git repository with a first commit'],
        ['publish', 'A private GitHub repository'],
    ];
    for (const [extra, text] of extraTexts) {
        if (extras.has(extra) && (extra !== 'compose' || needsServer(choice.database))) {
            list.push(text);
        }
    }
    let mainFile: string | undefined;
    for (const f of ctx.mainFiles) {
        if (!mainFile && fs.existsSync(path.join(ctx.root, f))) {
            mainFile = f;
        }
    }
    const notes = [...ctx.frontPlan.notes];
    for (const n of ctx.backPlan?.notes ?? []) {
        notes.push(`Backend: ${n}`);
    }
    // * If the library created its demo page, link to it on the frontend server.
    const frontUrl = ctx.servers[0]?.url;
    const libraries: Array<{ label: string; docs: string; demo?: string }> = [];
    for (const lib of ctx.libraries) {
        const hasDemo = !!lib.demo && !!frontUrl && fs.existsSync(path.join(ctx.frontDir, lib.demo));
        libraries.push({ label: lib.label, docs: lib.docs, demo: hasDemo ? `${frontUrl}/${lib.demo}` : undefined });
    }
    return {
        name: choice.name,
        stack: describe(choice),
        servers: ctx.servers,
        devAll: ctx.devAll,
        mainFile,
        docs: [choice.template.docs, ...(choice.backend ? [choice.backend.docs] : [])],
        notes,
        extras: list,
        libraries,
    };
}

/**
 * Git steps: a proper .gitignore, the first commit and (optionally) publishing to GitHub.
 * @param choice the wizard's choice
 * @param root root folder
 * @param front options of the main part
 * @param back options of the backend (if any)
 */
function gitSteps(choice: ProjectChoice, root: string, front: PartOptions, back?: PartOptions): Step[] {
    const extras = new Set(choice.extras);
    if (!extras.has('git') && !extras.has('publish')) {
        return [];
    }
    const parts = back ? [front.dir, back.dir] : [root];
    const steps: Step[] = [
        task(
            'Preparing Git repository',
            function () {
                for (const part of parts) {
                    // ! Some generators create their own repository; we want a single one at the root.
                    if (back) {
                        fs.rmSync(path.join(part, '.git'), { recursive: true, force: true });
                    }
                    // ! Never commit downloaded dependencies or secrets.
                    const entries = ['.env'];
                    if (fs.existsSync(path.join(part, 'package.json'))) {
                        entries.push('node_modules/', 'dist/');
                    }
                    if (fs.existsSync(path.join(part, '.venv'))) {
                        entries.push('.venv/', '__pycache__/');
                    }
                    ensureGitignore(part, entries);
                }
            },
            true,
        ),
        cmd('Creating Git repository', 'git init -q && git add -A', root, true),
        // ! Separate step: the commit fails when Git has no user.name/user.email yet, but the
        // ! repository above must still exist (the person can commit later).
        cmd('Saving the first commit', 'git commit -q -m "Initial commit from DevStarter"', root, true),
    ];
    if (extras.has('publish')) {
        steps.push(
            cmd(
                'Publishing to GitHub (private repository)',
                `gh repo create ${choice.name} --private --source . --remote origin --push`,
                root,
                true,
            ),
        );
    }
    return steps;
}
