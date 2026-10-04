/**
 * wizard.ts
 * ─────────
 * Asistente "New Project": una serie de pasos con QuickPick/InputBox de VS Code.
 *
 *   0. Nivel de experiencia (solo la primera vez)
 *   1. Qué construir (o "Repeat last setup")
 *   2. Lenguaje · 3. Backend · 4. Base de datos · 5. Librerías · 6. Extras
 *   7. Gestor de paquetes · 8. Carpeta · 9. Nombre · 10. Confirmar
 *
 * Cada paso tiene botón "atrás", y los pasos que no aplican (p. ej. elegir base de datos
 * en un proyecto sin backend) se saltan solos.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    attachableBackends,
    Category,
    findTemplate,
    Library,
    librariesFor,
    Preset,
    presets,
    suggestName,
    Template,
    templates,
    validateProjectName,
} from './templates';
import { PackageManager, PackageManagerId, ToolInfo } from './tools';
import { Database, needsServer } from './scaffold/database';
import { databaseOwner, describe, Extra, plainSummary, ProjectChoice, usesNode } from './project';

/** Lo que el asistente necesita de la extensión. */
export interface WizardContext {
    globalState: vscode.Memento;
    packageManagers: Promise<PackageManager[]>;
    git: Promise<ToolInfo>;
    /** GitHub CLI (para el extra "Publish to GitHub"). Opcional. */
    gh?: Promise<ToolInfo>;
    /** Plantilla elegida de antemano (desde el walkthrough). */
    preselect?: string;
}

/** Lo que se guarda para "Repeat last setup". */
interface LastSetup {
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

const BACK = Symbol('back');
type Back = typeof BACK;
/** Resultado de un paso: seguir, volver atrás o cancelar (undefined). */
type Outcome = 'next' | Back | undefined;

/** Posición del paso actual ("Paso 2 de 7") y título de la ventana. */
interface Position {
    step: number;
    total: number;
    title: string;
}

const LAST_FOLDER_KEY = 'devstarter.lastParentFolder';
const LAST_SETUP_KEY = 'devstarter.lastSetup';

/** Elemento de una lista con un valor asociado. */
type Item<T> = vscode.QuickPickItem & { value: T };

// ─── Entradas de bajo nivel ─────────────────────────────────────────
// Usamos createQuickPick/createInputBox (y no showQuickPick) porque permiten
// mostrar "Paso 2 de 7" y el botón de volver atrás.

/** Opciones de una lista. */
interface PickOptions<T> {
    placeholder: string;
    items: T[];
    /** Permitir marcar varias opciones. */
    many?: boolean;
    /** Opción resaltada al abrir. */
    active?: T;
}

/**
 * Muestra una lista y espera a que se elija algo.
 * @returns lo elegido, BACK si pulsó "atrás", o undefined si la cerró
 */
function pick<T extends vscode.QuickPickItem>(
    pos: Position,
    opts: PickOptions<T>,
): Promise<readonly T[] | Back | undefined> {
    return new Promise(function (resolve) {
        const qp = vscode.window.createQuickPick<T>();
        let done = false;

        /** Resuelve una sola vez y cierra la lista. */
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
        qp.ignoreFocusOut = true; // que no se cierre al hacer clic fuera
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

/** ¿Este elemento empieza marcado? */
function isPicked(item: vscode.QuickPickItem): boolean {
    return !!item.picked;
}

/** Opciones de un campo de texto. */
interface InputOptions {
    prompt: string;
    placeholder: string;
    value: string;
    /** Devuelve un mensaje de error, o undefined si el texto vale. */
    validate: (v: string) => string | undefined;
}

/**
 * Muestra un campo de texto con validación en vivo.
 * @returns el texto, BACK si pulsó "atrás", o undefined si lo cerró
 */
function input(pos: Position, opts: InputOptions): Promise<string | Back | undefined> {
    return new Promise(function (resolve) {
        const box = vscode.window.createInputBox();
        let done = false;

        /** Resuelve una sola vez y cierra el campo. */
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
 * Atajo para pasos de una sola elección.
 * @returns { value } con lo elegido, BACK, o undefined si se canceló
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

// ─── Estado del asistente ───────────────────────────────────────────

/** Todo lo que se va eligiendo. */
interface State {
    beginner?: boolean;
    askedLevel: boolean;
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
    /** Se eligió "Repeat last setup": saltamos directamente al nombre. */
    repeat: boolean;
}

/** Un paso del asistente: cuándo aplica y qué hace. */
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

/** Datos compartidos por todos los pasos. */
interface Shared {
    ctx: WizardContext;
    config: vscode.WorkspaceConfiguration;
    pms: PackageManager[];
    git: ToolInfo;
    gh?: ToolInfo;
    last?: LastSetup;
}

/**
 * Librerías disponibles para el proyecto actual (de la plantilla y del backend).
 * @param s estado del asistente
 */
function availableLibraries(s: State): Array<{ lib: Library; part: string }> {
    const result: Array<{ lib: Library; part: string }> = [];
    if (s.template) {
        for (const lib of librariesFor(s.template.id)) {
            result.push({ lib, part: s.backend ? 'frontend' : s.template.label });
        }
    }
    if (s.backend) {
        for (const lib of librariesFor(s.backend.id)) {
            result.push({ lib, part: 'backend' });
        }
    }
    return result;
}

// ─── Pasos ──────────────────────────────────────────────────────────

/** 0. Nivel de experiencia. */
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

/** Marca de la opción que DevStarter recomienda a quien empieza. */
const STAR = '⭐ Recommended';

/**
 * Añade la marca de recomendación delante del texto (solo en modo principiante).
 * @param beginner modo principiante
 * @param recommended la opción es la recomendada
 * @param text texto de la opción (puede estar vacío)
 */
function recommend(beginner: boolean | undefined, recommended: boolean | undefined, text?: string): string | undefined {
    if (!beginner || !recommended) {
        return text;
    }
    return text ? `${STAR} · ${text}` : STAR;
}

/**
 * Pone primero las opciones recomendadas (solo en modo principiante), sin cambiar el orden del resto.
 * @param list opciones
 * @param beginner modo principiante
 * @param isRecommended dice si una opción es la recomendada
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

/** ¿Esta plantilla está recomendada para principiantes? */
function isRecommendedTemplate(t: Template): boolean {
    return !!t.recommended;
}

/** Lo que se puede elegir en el paso 1: repetir, una idea o una plantilla. */
type StartChoice =
    { kind: 'repeat' } | { kind: 'preset'; preset: Preset } | { kind: 'template'; template: Template } | undefined;

/**
 * Elementos "Start from an idea" (para quien no conoce los nombres de los frameworks).
 * @param beginner modo principiante (muestra la explicación)
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
 * Elementos de las plantillas, agrupados por categoría.
 * @param beginner modo principiante (muestra la explicación y las recomendadas)
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
                // Los programadores ven una lista más compacta.
                detail: beginner ? t.detail : undefined,
                value: { kind: 'template', template: t },
            });
        }
    }
    return items;
}

/** 1. Qué construir: repetir lo último, una idea o una plantilla concreta. */
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
                let lastPm = s.pm;
                for (const p of sh.pms) {
                    if (p.id === last.pmId) {
                        lastPm = p;
                    }
                }
                const summary = describe({
                    template: lastTemplate,
                    backend: findTemplate(last.backendId),
                    typescript: last.typescript,
                    tailwind: last.tailwind,
                    database: last.database,
                    libraries: last.libraries ?? [],
                    extras: last.extras,
                    pm: lastPm,
                });
                items.push(
                    { label: 'Quick start', kind: vscode.QuickPickItemKind.Separator, value: undefined },
                    { label: '$(history) Repeat last setup', description: summary, value: { kind: 'repeat' } },
                );
            }
            // Principiantes: las ideas primero y, debajo, TODAS las tecnologías (las recomendadas
            // arriba de cada grupo y con estrella). Programadores: las tecnologías y, al final, las ideas.
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
            if (value.kind === 'repeat' && last && lastTemplate) {
                applyLastSetup(s, last, lastTemplate, sh.pms);
            } else if (value.kind === 'preset') {
                applyPreset(s, value.preset);
            } else if (value.kind === 'template') {
                s.template = value.template;
                // Si cambia de plantilla, olvidamos lo que no tenga sentido para la nueva.
                if (!value.template.acceptsBackend) {
                    s.backend = undefined;
                }
            }
            return 'next';
        },
    };
}

/**
 * Rellena el estado con una idea: plantilla, librerías y opciones ya decididas.
 * Igual que "Repeat last setup", salta directamente a la carpeta y el nombre.
 * @param s estado del asistente
 * @param preset idea elegida
 */
function applyPreset(s: State, preset: Preset): void {
    s.repeat = true;
    s.template = findTemplate(preset.template);
    s.backend = findTemplate(preset.backend);
    s.typescript = preset.typescript;
    s.tailwind = preset.tailwind;
    s.database = preset.database;
    s.libraries = new Set(preset.libraries);
}

/**
 * Rellena el estado con la última configuración usada.
 * @param s estado del asistente
 * @param last configuración guardada
 * @param template plantilla de esa configuración
 * @param pms gestores de paquetes detectados
 */
function applyLastSetup(s: State, last: LastSetup, template: Template, pms: PackageManager[]): void {
    s.repeat = true;
    s.template = template;
    s.backend = findTemplate(last.backendId);
    s.typescript = last.typescript;
    s.tailwind = last.tailwind;
    s.database = last.database;
    s.libraries = new Set(last.libraries ?? []);
    s.extras = new Set(last.extras);
    for (const p of pms) {
        if (p.id === last.pmId) {
            s.pm = p;
        }
    }
    s.parentDir = fs.existsSync(last.parentDir) ? last.parentDir : undefined;
}

/** 2. Lenguaje. */
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

/** 3. Backend (para frontends y apps móviles). */
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

/** Nombre, icono y explicación de cada base de datos. */
const databaseInfo: Record<Database, [string, string]> = {
    SQLite: ['$(file) SQLite', 'Stored in a single file. Nothing else to install. Easiest to start.'],
    PostgreSQL: [
        '$(database) PostgreSQL',
        'Powerful SQL database. Needs a server (Docker, local install or a free cloud one).',
    ],
    MySQL: ['$(database) MySQL', 'Popular SQL database. Needs a server (Docker, local install or cloud).'],
    MongoDB: ['$(json) MongoDB', 'Stores JSON-like documents. Needs MongoDB, Docker or a free Atlas cluster.'],
};

/** 4. Base de datos. */
function databaseStep(): WizardStep {
    return {
        // Antes de elegir plantilla aún no sabemos si aplica (se calcula para "Paso X de Y").
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
                    label: databaseInfo[db][0],
                    description: db === 'SQLite' ? (recommend(s.beginner, true, 'easiest') ?? 'easiest') : undefined,
                    detail: s.beginner ? databaseInfo[db][1] : undefined,
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

/** 5. Librerías. */
function librariesStep(): WizardStep {
    return {
        applies(s) {
            return !s.repeat && !!s.template && availableLibraries(s).length > 0;
        },
        async run(s, pos) {
            const items: Array<Item<string>> = [];
            let lastPart = '';
            for (const { lib, part } of availableLibraries(s)) {
                // Separador por parte (frontend / backend) en proyectos full-stack.
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

/** 6. Extras. */
function extrasStep(sh: Shared): WizardStep {
    return {
        applies(s) {
            return !s.repeat && !!s.template;
        },
        async run(s, pos) {
            const t = s.template!;
            const dockerOwner = s.backend ?? t;
            const items: Array<Item<Extra | 'tailwind'>> = [];

            /** Añade una opción a la lista (el detalle solo se ve en modo principiante). */
            function add(
                value: Extra | 'tailwind',
                label: string,
                description: string,
                detail: string,
                picked: boolean,
            ): void {
                // Las que DevStarter marca de serie son las recomendadas para quien empieza.
                const advised = value === 'tailwind' || value === 'git' || value === 'vscode';
                items.push({
                    label,
                    description: recommend(s.beginner, advised, description),
                    detail: s.beginner ? detail : undefined,
                    picked,
                    value,
                });
            }

            if (t.tailwind) {
                add(
                    'tailwind',
                    '$(paintcan) Tailwind CSS',
                    'style with classes',
                    'Utility classes like "text-xl font-bold". Very popular and fast to use.',
                    s.tailwind,
                );
            }
            add(
                'git',
                '$(git-branch) Git repository',
                sh.git.version ? 'version control' : 'Git will be installed',
                'Track your changes and undo mistakes.',
                s.extras.has('git'),
            );
            add(
                'publish',
                '$(github) Publish to GitHub',
                sh.gh?.version ? 'private repository' : 'GitHub CLI will be installed',
                'Creates a private repository on your GitHub account and uploads the project (needs "gh auth login" once).',
                s.extras.has('publish'),
            );
            add(
                'vscode',
                '$(extensions) Recommended VS Code extensions',
                'for this stack',
                'VS Code will offer to install the extensions that make this stack easier.',
                s.extras.has('vscode'),
            );
            if (needsServer(s.database)) {
                add(
                    'compose',
                    `$(server-environment) Docker Compose for ${s.database}`,
                    'needs Docker Desktop',
                    `Start ${s.database} with one command: docker compose up -d`,
                    s.extras.has('compose'),
                );
            }
            if (dockerOwner.docker) {
                add(
                    'dockerfile',
                    '$(package) Dockerfile',
                    'for deployment',
                    'Package your backend as a container to deploy it anywhere.',
                    s.extras.has('dockerfile'),
                );
            }
            if (t.ci || s.backend?.ci) {
                add(
                    'ci',
                    '$(github-action) GitHub Actions CI',
                    'build & test on push',
                    'GitHub checks that your project builds every time you push.',
                    s.extras.has('ci'),
                );
            }
            if (usesNode({ template: t, backend: s.backend })) {
                add(
                    'prettier',
                    '$(wand) Prettier',
                    'code formatter',
                    'Formats your code automatically so it always looks tidy.',
                    s.extras.has('prettier'),
                );
            }
            add(
                'license',
                '$(law) MIT License',
                'open source',
                'Lets others use your code freely. Uses your Git name as author.',
                s.extras.has('license'),
            );

            const result = await pick(pos, {
                placeholder: 'Extras (Space to toggle, Enter to continue)',
                items,
                many: true,
            });
            if (result === BACK || !result) {
                return result === BACK ? BACK : undefined;
            }
            const chosen = new Set<Extra | 'tailwind'>();
            for (const item of result) {
                chosen.add(item.value);
            }
            s.tailwind = !!t.tailwind && chosen.has('tailwind');
            s.extras = new Set<Extra>();
            for (const value of chosen) {
                if (value !== 'tailwind') {
                    s.extras.add(value);
                }
            }
            // Publicar necesita un repositorio Git.
            if (s.extras.has('publish')) {
                s.extras.add('git');
            }
            return 'next';
        },
    };
}

/** 7. Gestor de paquetes. */
function packageManagerStep(sh: Shared): WizardStep {
    const info: Record<PackageManagerId, string> = {
        npm: 'Comes with Node.js. The safe default.',
        pnpm: 'Fast and saves disk space.',
        bun: 'Very fast all-in-one toolkit.',
    };
    return {
        applies(s) {
            return !s.repeat && !!s.template && usesNode({ template: s.template, backend: s.backend });
        },
        async run(s, pos) {
            const items: Array<Item<PackageManager>> = [];
            for (const p of sh.pms) {
                let description = `v${p.version}`;
                if (!p.version) {
                    description =
                        p.id === 'npm'
                            ? 'will be installed with Node.js'
                            : 'not installed · DevStarter will install it';
                }
                items.push({
                    label: `$(package) ${p.id}`,
                    description: recommend(s.beginner, p.id === 'npm', description),
                    detail: s.beginner ? info[p.id] : undefined,
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

/** 8. Carpeta donde crear el proyecto. */
function locationStep(sh: Shared): WizardStep {
    return {
        applies(s) {
            return !s.repeat || !s.parentDir;
        },
        async run(s, pos) {
            const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const lastFolder = sh.ctx.globalState.get<string>(LAST_FOLDER_KEY);
            const documents = path.join(os.homedir(), 'Documents');
            const candidates: Array<[string, string | undefined]> = [
                ['$(folder-opened) Current workspace', workspace],
                ['$(history) Last used folder', lastFolder && fs.existsSync(lastFolder) ? lastFolder : undefined],
                ['$(file-directory) Documents', fs.existsSync(documents) ? documents : undefined],
            ];
            const seen = new Set<string>();
            const items: Array<Item<string | undefined>> = [];
            for (const [label, dir] of candidates) {
                if (dir && !seen.has(dir.toLowerCase())) {
                    seen.add(dir.toLowerCase());
                    items.push({ label, description: dir, value: dir });
                }
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
                let dir = result[0].value;
                if (!dir) {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFolders: true,
                        canSelectFiles: false,
                        canSelectMany: false,
                        openLabel: 'Create project here',
                        defaultUri: s.parentDir ? vscode.Uri.file(s.parentDir) : undefined,
                    });
                    dir = picked?.[0]?.fsPath;
                    if (!dir) {
                        continue; // canceló el diálogo: volvemos a la lista
                    }
                }
                s.parentDir = dir;
                return 'next';
            }
        },
    };
}

/** 9. Nombre del proyecto. */
function nameStep(): WizardStep {
    return {
        applies() {
            return true;
        },
        async run(s, pos) {
            const t = s.template!;
            const base = t.nameStyle === 'snake' ? 'my_app' : 'my-app';
            // Proponemos un nombre libre: my-app, my-app-2, my-app-3…
            let value = s.name ?? base;
            for (let i = 2; !s.name && fs.existsSync(path.join(s.parentDir!, value)); i++) {
                value = `${base}${t.nameStyle === 'snake' ? '_' : '-'}${i}`;
            }

            /** Comprueba el nombre y, si no vale, sugiere uno que sí. */
            function validate(v: string): string | undefined {
                const error = validateProjectName(v, t.nameStyle);
                if (error) {
                    const suggestion = suggestName(v, t.nameStyle);
                    const useful = suggestion && suggestion !== v && !validateProjectName(suggestion, t.nameStyle);
                    return useful ? `${error}. How about "${suggestion}"?` : error;
                }
                if (fs.existsSync(path.join(s.parentDir!, v))) {
                    return `A folder named "${v}" already exists there`;
                }
                return undefined;
            }

            const result = await input(pos, {
                prompt: `The folder will be created in ${s.parentDir}`,
                placeholder: base,
                value,
                validate,
            });
            if (result === BACK || result === undefined) {
                return result;
            }
            s.name = result;
            return 'next';
        },
    };
}

/** 10. Confirmación. */
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
                    // Principiantes: una frase normal. Programadores: el resumen técnico de una línea.
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

// ─── Motor del asistente ────────────────────────────────────────────

/**
 * Ejecuta el asistente completo.
 * @param ctx datos de la extensión
 * @returns la elección final, o undefined si se canceló
 */
export async function runWizard(ctx: WizardContext): Promise<ProjectChoice | undefined> {
    const config = vscode.workspace.getConfiguration('devstarter');
    const [pms, git, gh] = await Promise.all([ctx.packageManagers, ctx.git, ctx.gh]);
    const preferredPm = config.get<PackageManagerId>('defaultPackageManager', 'npm');
    const level = config.get<string>('experienceLevel', '');
    const sh: Shared = { ctx, config, pms, git, gh, last: ctx.globalState.get<LastSetup>(LAST_SETUP_KEY) };

    // Gestor por defecto: el preferido si está instalado; si no, npm.
    let pm = pms[0];
    for (const p of pms) {
        if (p.id === preferredPm && p.version) {
            pm = p;
        }
    }

    const state: State = {
        beginner: level ? level === 'beginner' : undefined,
        askedLevel: false,
        template: findTemplate(ctx.preselect),
        typescript: true,
        tailwind: true,
        libraries: new Set<string>(),
        extras: new Set<Extra>(['vscode']),
        pm,
        repeat: false,
    };
    if (git.version && config.get('initGit', true)) {
        state.extras.add('git');
    }

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

    // Recorre los pasos que aplican y recuerda el camino para poder volver atrás.
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
    await ctx.globalState.update(LAST_FOLDER_KEY, choice.parentDir);
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
    await ctx.globalState.update(LAST_SETUP_KEY, lastSetup);
    return choice;
}

/**
 * Convierte el estado del asistente en la elección final, limpiando opciones que no aplican
 * (p. ej. una base de datos que el backend elegido no admite).
 * @param s estado del asistente
 */
function toChoice(s: State): ProjectChoice {
    const template = s.template!;
    const backend = template.acceptsBackend ? s.backend : undefined;
    const owner = databaseOwner({ template, backend });
    const database = s.database && owner?.databases?.includes(s.database) ? s.database : undefined;
    const node = usesNode({ template, backend });

    const extras: Extra[] = [];
    for (const e of s.extras) {
        const valid =
            (e !== 'compose' || needsServer(database)) &&
            (e !== 'dockerfile' || !!(backend ?? template).docker) &&
            (e !== 'prettier' || node) &&
            (e !== 'ci' || !!template.ci || !!backend?.ci);
        if (valid) {
            extras.push(e);
        }
    }

    // Solo las librerías que aplican a las plantillas elegidas.
    const available = new Set<string>();
    for (const { lib } of availableLibraries({ ...s, template, backend })) {
        available.add(lib.id);
    }
    const libraries: string[] = [];
    for (const id of s.libraries) {
        if (available.has(id)) {
            libraries.push(id);
        }
    }

    return {
        template,
        backend,
        typescript: !!template.languages && s.typescript,
        tailwind: !!template.tailwind && s.tailwind,
        database,
        libraries,
        extras,
        pm: s.pm,
        name: s.name!,
        parentDir: s.parentDir!,
        beginner: s.beginner ?? true,
    };
}
