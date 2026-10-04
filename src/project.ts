/**
 * project.ts
 * ──────────
 * Junta todo lo que se eligió en el asistente (plantilla, backend opcional, base de datos,
 * librerías y extras) y lo convierte en una lista de pasos que el terminal ejecuta en orden.
 *
 *   Proyecto simple:     <carpeta>/<nombre>/...
 *   Proyecto full-stack: <carpeta>/<nombre>/frontend   (o mobile)
 *                        <carpeta>/<nombre>/backend
 *                        <carpeta>/<nombre>/package.json  ← "npm run dev" arranca los dos
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

/** Extras que se pueden marcar en el asistente. */
export type Extra = 'git' | 'publish' | 'ci' | 'license' | 'compose' | 'dockerfile' | 'prettier' | 'vscode';

/** Lo que devuelve el asistente. */
export interface ProjectChoice {
    template: Template;
    /** Backend añadido a un frontend o app móvil (proyecto full-stack). */
    backend?: Template;
    typescript: boolean;
    tailwind: boolean;
    database?: Database;
    /** Identificadores de las librerías elegidas (de frontend y de backend). */
    libraries: string[];
    extras: Extra[];
    pm: PackageManager;
    name: string;
    parentDir: string;
    beginner: boolean;
}

/** El plan completo del proyecto. */
export interface BuiltProject {
    root: string;
    steps: Step[];
    /** Servidores a arrancar, con la carpeta relativa a la raíz. */
    servers: DevServer[];
    /** Comando que arranca todo desde la raíz (full-stack con Node). */
    devAll?: string;
    /** Candidatos a fichero principal, relativos a la raíz. */
    mainFiles: string[];
}

/** Lo mínimo para saber qué partes tiene un proyecto. */
interface Parts {
    template: Template;
    backend?: Template;
}

/**
 * La plantilla que se encarga de la base de datos: el backend si lo hay, si no la principal.
 * @param choice plantilla y backend
 */
export function databaseOwner(choice: Parts): Template | undefined {
    const owner = choice.backend ?? choice.template;
    return owner?.databases?.length ? owner : undefined;
}

/**
 * ¿Alguna parte del proyecto usa npm/pnpm/bun?
 * @param choice plantilla y backend
 */
export function usesNode(choice: Parts): boolean {
    return !!choice.template?.node || !!choice.backend?.node;
}

/**
 * Herramientas que tienen que estar instaladas antes de empezar.
 * Node va primero porque pnpm y bun se instalan con él.
 * @param choice elección del asistente
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

/** Orden: Node primero, el resto como estaban. */
function nodeFirst(a: ToolId, b: ToolId): number {
    if (a === 'node') {
        return -1;
    }
    return b === 'node' ? 1 : 0;
}

/**
 * Resumen de una línea, p. ej. "React · TypeScript · Tailwind CSS + Express API · PostgreSQL · 3 libraries · Git · npm".
 * @param choice elección (sin nombre ni carpeta)
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

/** Cómo se llama, en lenguaje normal, lo que se va a crear según la categoría de la plantilla. */
const plainNouns: Record<Template['category'], string> = {
    Frontend: 'a website',
    'Full-stack': 'a web app',
    Backend: 'a server (API)',
    Mobile: 'a mobile app',
    Other: 'a project',
};

/**
 * Pone "a" o "an" delante de una palabra ("an Express", "a Django").
 * @param word palabra a la que va el artículo
 */
function withArticle(word: string): string {
    return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

/**
 * Resumen "para personas" de lo que se va a crear, sin siglas ni símbolos:
 * "A website made with React and TypeScript, styled with Tailwind CSS, with an Express API
 * backend and a SQLite database, plus Zustand and GSAP."
 * @param choice elección del asistente
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
 * ¿La plantilla usa Python?
 * @param t plantilla (o ninguna)
 */
function isPython(t?: Template): boolean {
    return !!t?.requires.includes('python');
}

/**
 * Separa las librerías elegidas entre la parte principal y el backend.
 * @param choice elección del asistente
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
 * Identificadores de una lista de librerías.
 * @param libs librerías
 */
function ids(libs: Library[]): string[] {
    const result: string[] = [];
    for (const lib of libs) {
        result.push(lib.id);
    }
    return result;
}

/**
 * Construye el plan completo del proyecto.
 * @param choice elección del asistente
 * @param python comando de Python del sistema (para plantillas Python)
 */
export function buildProject(choice: ProjectChoice, python?: string): BuiltProject {
    const { template, backend, name, pm } = choice;
    const fullstack = !!backend;
    const root = path.join(choice.parentDir, name);
    const extras = new Set(choice.extras);
    const libs = splitLibraries(choice);
    const steps: Step[] = [];

    // ── Opciones de cada parte
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

    // ── Servidores de desarrollo
    const servers: DevServer[] = [];
    if (frontPlan.server) {
        const label = fullstack ? (template.category === 'Mobile' ? 'Mobile app' : 'Frontend') : template.label;
        servers.push({ label, folder: fullstack ? frontFolder : '', ...frontPlan.server });
    }
    if (backPlan?.server) {
        servers.push({ label: 'Backend', folder: 'backend', ...backPlan.server });
    }

    // ── Raíz full-stack: un "npm run dev" que arranca frontend y backend a la vez
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

    // ── Guía o README
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

/** Datos que necesitan los pasos de extras. */
interface ExtraContext {
    root: string;
    front: PartOptions;
    back?: PartOptions;
    devAll?: string;
}

/**
 * Pasos de los extras: Docker Compose, Prettier, CI, licencia, pnpm y ajustes del editor.
 * @param choice elección del asistente
 * @param ctx carpetas y opciones de cada parte
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
        // En full-stack basta con configurarlo en la raíz; formatea todo lo que cuelga de ella.
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

    // pnpm: que "pnpm dev" no falle por scripts de build sin aprobar.
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
 * Extensiones de VS Code recomendadas según las plantillas y extras elegidos.
 * @param choice elección del asistente
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
 * Ajustes del espacio de trabajo: con Python, que VS Code use directamente el .venv.
 * @param choice elección del asistente
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

/** Datos para la guía. */
interface GuideContext {
    root: string;
    /** Carpeta del frontend (o de la parte principal). */
    frontDir: string;
    servers: DevServer[];
    devAll?: string;
    mainFiles: string[];
    frontPlan: Plan;
    backPlan?: Plan;
    libraries: Library[];
}

/**
 * Reúne la información de GETTING_STARTED.md / README.md.
 * @param choice elección del asistente
 * @param ctx datos calculados al construir el proyecto
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
    // Si la librería creó su página de demo, enlazamos a ella en el servidor del frontend.
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
 * Pasos de Git: .gitignore correcto, primer commit y (opcional) publicar en GitHub.
 * @param choice elección del asistente
 * @param root carpeta raíz
 * @param front opciones de la parte principal
 * @param back opciones del backend (si lo hay)
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
                    // Algunos generadores crean su propio repositorio; queremos uno solo en la raíz.
                    if (back) {
                        fs.rmSync(path.join(part, '.git'), { recursive: true, force: true });
                    }
                    // Nunca subir dependencias descargadas ni secretos.
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
        cmd(
            'Creating Git repository',
            'git init -q && git add -A && git commit -q -m "Initial commit from DevStarter"',
            root,
            true,
        ),
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
