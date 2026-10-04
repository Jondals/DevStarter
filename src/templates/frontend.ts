/**
 * templates/frontend.ts
 * ─────────────────────
 * Plantillas de frontend: React, Vue, Svelte, HTML/CSS/JS (todas con Vite) y Angular.
 * Todas pueden recibir un backend: en ese caso se configura el proxy de /api.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Step } from '../terminal';
import {
    configureAngularProxy,
    configureAngularTailwind,
    configureViteProxy,
    configureViteTailwind,
} from '../scaffold/tailwind';
import { WelcomeFramework, writeWelcomePage } from '../scaffold/welcome';
import { cmd, PartOptions, Plan, scaffold, task, Template } from './types';

/**
 * Pasos de Tailwind CSS: instalar los paquetes y configurar el proyecto.
 * @param o opciones del proyecto
 * @param packages paquetes que se instalan como dependencias de desarrollo
 * @param configure escribe la configuración (depende del framework)
 * @param detail lo que se cuenta debajo del paso
 */
function tailwindSteps(o: PartOptions, packages: string[], configure: () => void, detail: string): Step[] {
    return [
        cmd('Installing Tailwind CSS', o.pm.add(packages, true), o.dir),
        task('Configuring Tailwind CSS', function (log) {
            configure();
            log(detail);
        }),
    ];
}

/**
 * Paso que hace que las peticiones a /api del frontend lleguen al backend.
 * @param o opciones del proyecto (con backendUrl)
 * @param configure escribe la configuración del proxy (depende del framework)
 */
function backendLinkStep(o: PartOptions, configure: (dir: string, backendUrl: string) => void): Step {
    return task('Connecting the frontend to the backend', function (log) {
        configure(o.dir, o.backendUrl!);
        log(`Requests to /api go to ${o.backendUrl}`);
    });
}

/** Datos que cambian entre las plantillas basadas en Vite. */
interface ViteTemplateInfo {
    id: string;
    label: string;
    icon: string;
    detail: string;
    recommended?: boolean;
    /** Nombre de la plantilla en create-vite (sin el sufijo -ts). */
    vite: string;
    welcome: WelcomeFramework;
    /** Hoja de estilos principal. */
    css: string;
    mainFiles: (ts: boolean) => string[];
    docs: string;
    vscode: string[];
}

/**
 * Pasos de una plantilla Vite: crear, instalar, Tailwind, proxy y página de bienvenida.
 * @param t datos de la plantilla
 * @param o opciones del proyecto
 */
function vitePlan(t: ViteTemplateInfo, o: PartOptions): Plan {
    const steps: Step[] = [
        // create-vite sin terminal interactivo usa los valores que le pasamos y no pregunta nada.
        scaffold(
            o,
            `Creating ${t.label} project with Vite`,
            'create-vite',
            [
                o.folder,
                '--template',
                t.vite + (o.typescript ? '-ts' : ''),
                '--no-interactive',
                '--no-immediate',
                '--no-rolldown',
            ],
            o.parentDir,
        ),
        cmd('Installing dependencies', o.pm.install(), o.dir),
        // La pestaña del navegador muestra el nombre del proyecto (no "frontend").
        task(
            'Setting the page title',
            function () {
                const html = path.join(o.dir, 'index.html');
                fs.writeFileSync(
                    html,
                    fs.readFileSync(html, 'utf8').replace(/<title>.*<\/title>/, `<title>${o.name}</title>`),
                );
            },
            true,
        ),
    ];
    if (o.tailwind) {
        steps.push(
            ...tailwindSteps(
                o,
                ['tailwindcss', '@tailwindcss/vite'],
                function () {
                    configureViteTailwind(o.dir, t.css);
                },
                `Wired @tailwindcss/vite into vite.config and ${t.css}`,
            ),
        );
    }
    if (o.backendUrl) {
        steps.push(backendLinkStep(o, configureViteProxy));
    }
    // La página de bienvenida usa Tailwind, así que solo tiene sentido con Tailwind.
    if (o.tailwind && o.beginner) {
        steps.push(
            task('Adding a welcome page', function () {
                writeWelcomePage(o.dir, t.welcome, o.name, o.typescript, !!o.backendUrl);
            }),
        );
    }
    const notes = [
        'Vite reloads the browser automatically every time you save.',
        o.tailwind
            ? 'Style elements with Tailwind classes like `text-xl font-bold text-indigo-400`. Docs: https://tailwindcss.com/docs'
            : 'Your styles live in the `src` folder as plain CSS files.',
    ];
    if (o.backendUrl) {
        notes.push("Call your backend with `fetch('/api/...')`. Vite forwards those requests to the backend.");
    }
    notes.push(`Build for production with \`${o.pm.run('build')}\` (output goes to \`dist/\`).`);
    return {
        steps,
        server: { command: o.pm.run('dev'), url: 'http://localhost:5173' },
        mainFiles: t.mainFiles(o.typescript),
        notes,
    };
}

/**
 * Fábrica para las plantillas basadas en Vite, que comparten casi todo.
 * @param t datos de la plantilla
 */
function viteTemplate(t: ViteTemplateInfo): Template {
    return {
        id: t.id,
        label: t.label,
        icon: t.icon,
        category: 'Frontend',
        description: 'Vite',
        detail: t.detail,
        recommended: t.recommended,
        languages: true,
        tailwind: true,
        acceptsBackend: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: t.docs,
        vscode: t.vscode,
        plan(o) {
            return vitePlan(t, o);
        },
    };
}

/** Pasos de Angular: crear con el CLI, Tailwind por PostCSS y proxy. */
function angularPlan(o: PartOptions): Plan {
    const steps: Step[] = [
        scaffold(
            o,
            'Creating Angular project (this one takes a while)',
            '@angular/cli',
            [
                'new',
                o.folder,
                '--defaults',
                '--interactive=false',
                '--skip-git',
                '--style=css',
                '--ssr=false',
                `--package-manager=${o.pm.id}`,
            ],
            o.parentDir,
        ),
    ];
    if (o.tailwind) {
        steps.push(
            ...tailwindSteps(
                o,
                ['tailwindcss', '@tailwindcss/postcss', 'postcss'],
                function () {
                    configureAngularTailwind(o.dir);
                },
                'Added .postcssrc.json and imported Tailwind in src/styles.css',
            ),
        );
    }
    if (o.backendUrl) {
        steps.push(backendLinkStep(o, configureAngularProxy));
    }
    return {
        steps,
        server: { command: o.pm.run('start'), url: 'http://localhost:4200' },
        mainFiles: ['src/app/app.html', 'src/app/app.component.html'],
        notes: [
            'Each component has a `.ts` (logic), `.html` (template) and `.css` (styles) file.',
            `Generate new components with \`${o.pm.bin('ng', ['generate', 'component', 'my-component'])}\`.`,
        ],
    };
}

/** Funciones auxiliares para los ficheros principales de cada plantilla. */
function reactMain(ts: boolean): string[] {
    return [`src/App.${ts ? 'tsx' : 'jsx'}`];
}
function vueMain(): string[] {
    return ['src/App.vue'];
}
function svelteMain(): string[] {
    return ['src/App.svelte'];
}
function vanillaMain(ts: boolean): string[] {
    return [`src/main.${ts ? 'ts' : 'js'}`, 'index.html'];
}

const tailwindExt = 'bradlc.vscode-tailwindcss';
const eslintExt = 'dbaeumer.vscode-eslint';

export const frontendTemplates: Template[] = [
    viteTemplate({
        id: 'react',
        label: 'React',
        icon: 'symbol-event',
        recommended: true,
        detail: 'The most popular library for building web interfaces. A great first choice.',
        vite: 'react',
        welcome: 'react',
        css: 'src/index.css',
        mainFiles: reactMain,
        docs: 'https://react.dev/learn',
        vscode: [eslintExt, tailwindExt],
    }),
    viteTemplate({
        id: 'vue',
        label: 'Vue',
        icon: 'symbol-color',
        detail: 'Approachable and versatile. HTML-like templates that feel familiar.',
        vite: 'vue',
        welcome: 'vue',
        css: 'src/style.css',
        mainFiles: vueMain,
        docs: 'https://vuejs.org/guide/introduction.html',
        vscode: ['Vue.volar', tailwindExt],
    }),
    viteTemplate({
        id: 'svelte',
        label: 'Svelte',
        icon: 'flame',
        detail: 'Write less code. Compiles to tiny, fast JavaScript.',
        vite: 'svelte',
        welcome: 'svelte',
        css: 'src/app.css',
        mainFiles: svelteMain,
        docs: 'https://svelte.dev/tutorial',
        vscode: ['svelte.svelte-vscode', tailwindExt],
    }),
    viteTemplate({
        id: 'vanilla',
        label: 'HTML, CSS & JavaScript',
        icon: 'code',
        detail: 'No framework. Perfect to learn the fundamentals with a modern dev server.',
        vite: 'vanilla',
        welcome: 'vanilla',
        css: 'src/style.css',
        mainFiles: vanillaMain,
        docs: 'https://developer.mozilla.org/en-US/docs/Learn',
        vscode: [tailwindExt],
    }),
    {
        id: 'angular',
        label: 'Angular',
        icon: 'shield',
        category: 'Frontend',
        description: 'Angular CLI',
        detail: 'A complete framework by Google with everything included. Uses TypeScript.',
        tailwind: true,
        acceptsBackend: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://angular.dev/tutorials',
        vscode: ['Angular.ng-template', tailwindExt],
        plan: angularPlan,
    },
];
