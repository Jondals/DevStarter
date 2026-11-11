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
    /** Short text under the name (what makes it different; "Vite" is shown in the detail). */
    description: string;
    detail: string;
    recommended?: boolean;
    /** Template name in create-vite (without the -ts suffix). */
    vite: string;
    /** Popularity rank (1 = most used); the wizard lists templates in this order. */
    rank: number;
    /** Beginner welcome page; frameworks without one keep the generator's page. */
    welcome?: WelcomeFramework;
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
    if (o.tailwind && o.beginner && t.welcome) {
        steps.push(
            task('Adding a welcome page', function () {
                writeWelcomePage(o.dir, t.welcome!, o.name, o.typescript, !!o.backendUrl);
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
        description: t.description,
        detail: `${t.detail} Runs on Vite, the fast dev server.`,
        recommended: t.recommended,
        rank: t.rank,
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

/** Main files of a Solid project. */
function solidMain(ts: boolean): string[] {
    return [`src/App.${ts ? 'tsx' : 'jsx'}`, `src/index.${ts ? 'tsx' : 'jsx'}`];
}

/** Main files of a Preact project. */
function preactMain(ts: boolean): string[] {
    return [`src/app.${ts ? 'tsx' : 'jsx'}`, `src/main.${ts ? 'tsx' : 'jsx'}`];
}

/** Main files of a Lit project. */
function litMain(ts: boolean): string[] {
    return [`src/my-element.${ts ? 'ts' : 'js'}`, 'index.html'];
}

/** Less common Vite frameworks, after the big ones. */
const moreViteTemplates: Template[] = [
    viteTemplate({
        id: 'solid',
        label: 'Solid',
        icon: 'zap',
        description: 'Reactive · very fast',
        detail: 'Looks like React, but updates only what changes. Great performance with little code.',
        vite: 'solid',
        rank: 6,
        css: 'src/index.css',
        mainFiles: solidMain,
        docs: 'https://docs.solidjs.com',
        vscode: [tailwindExt],
    }),
    viteTemplate({
        id: 'preact',
        label: 'Preact',
        icon: 'symbol-event',
        description: 'React in 3 kB',
        detail: 'The same ideas as React in a tiny package. Perfect for small, fast websites.',
        vite: 'preact',
        rank: 7,
        css: 'src/index.css',
        mainFiles: preactMain,
        docs: 'https://preactjs.com/guide/v10/getting-started',
        vscode: [tailwindExt],
    }),
    viteTemplate({
        id: 'lit',
        label: 'Lit',
        icon: 'symbol-namespace',
        description: 'Web Components',
        detail: 'Reusable custom HTML elements that work in any page or framework. Made by Google.',
        vite: 'lit',
        rank: 8,
        css: 'src/index.css',
        mainFiles: litMain,
        docs: 'https://lit.dev/docs/',
        vscode: ['runem.lit-plugin', tailwindExt],
    }),
];

export const frontendTemplates: Template[] = [
    viteTemplate({
        id: 'react',
        label: 'React',
        icon: 'symbol-event',
        description: 'Components · the most used',
        recommended: true,
        detail: 'The most popular library for building web interfaces. A great first choice.',
        vite: 'react',
        rank: 1,
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
        description: 'Templates · easy to learn',
        detail: 'Approachable and versatile. HTML-like templates that feel familiar.',
        vite: 'vue',
        rank: 2,
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
        description: 'Compiled · tiny and fast',
        detail: 'Write less code. Compiles to tiny, fast JavaScript.',
        vite: 'svelte',
        rank: 4,
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
        description: 'No framework · the basics',
        detail: 'No framework. Perfect to learn the fundamentals with a modern dev server.',
        vite: 'vanilla',
        rank: 5,
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
        description: 'Full framework · by Google',
        rank: 3,
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
    ...moreViteTemplates,
];
