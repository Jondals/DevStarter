/**
 * templates/frontend.ts
 * ─────────────────────
 * Frontend templates: React, Vue, Svelte, HTML/CSS/JS (all with Vite) and Angular.
 * All of them can get a backend: in that case the /api proxy is configured.
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
 * Tailwind CSS steps: install the packages and configure the project.
 * @param o project options
 * @param packages packages installed as development dependencies
 * @param configure writes the configuration (depends on the framework)
 * @param detail what is reported under the step
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
 * Step that sends the frontend's /api requests to the backend.
 * @param o project options (with backendUrl)
 * @param configure writes the proxy configuration (depends on the framework)
 */
function backendLinkStep(o: PartOptions, configure: (dir: string, backendUrl: string) => void): Step {
    return task('Connecting the frontend to the backend', function (log) {
        configure(o.dir, o.backendUrl!);
        log(`Requests to /api go to ${o.backendUrl}`);
    });
}

/** What changes between the Vite-based templates. */
interface ViteTemplateInfo {
    id: string;
    label: string;
    icon: string;
    detail: string;
    recommended?: boolean;
    /** Template name in create-vite (without the -ts suffix). */
    vite: string;
    welcome: WelcomeFramework;
    /** Main stylesheet. */
    css: string;
    mainFiles: (ts: boolean) => string[];
    docs: string;
    vscode: string[];
}

/**
 * Steps of a Vite template: create, install, Tailwind, proxy and welcome page.
 * @param t template data
 * @param o project options
 */
function vitePlan(t: ViteTemplateInfo, o: PartOptions): Plan {
    const steps: Step[] = [
        // ? Without an interactive terminal, create-vite uses the values we pass and asks nothing.
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
        // * The browser tab shows the project name (not "frontend").
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
    // ? The welcome page uses Tailwind, so it only makes sense with Tailwind.
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
 * Factory for the Vite-based templates, which share almost everything.
 * @param t template data
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

/** Angular steps: create with the CLI, Tailwind through PostCSS, and proxy. */
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

// ─── Main file of each template ─────────────────────────────────────

/**
 * Main file of a React project.
 * @param ts the project uses TypeScript
 */
function reactMain(ts: boolean): string[] {
    return [`src/App.${ts ? 'tsx' : 'jsx'}`];
}

/** Main file of a Vue project. */
function vueMain(): string[] {
    return ['src/App.vue'];
}

/** Main file of a Svelte project. */
function svelteMain(): string[] {
    return ['src/App.svelte'];
}

/**
 * Main files of a plain HTML/CSS/JS project (script first, then the page).
 * @param ts the project uses TypeScript
 */
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
