/**
 * test/extension.test.ts
 * ──────────────────────
 * Tests que se ejecutan dentro de VS Code con "pnpm test".
 * Comprueban la lógica pura (nombres, comandos, plan del proyecto, utilidades)
 * y que el asistente se abre y se cierra sin errores.
 */
import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    attachableBackends,
    findLibraries,
    findTemplate,
    librariesFor,
    libraries,
    presets,
    suggestName,
    templates,
    validateProjectName,
} from '../templates';
import { compareVersions, packageManager } from '../tools';
import { explainError } from '../terminal';
import { banner, box, gradient, shimmer, stripAnsi, visibleLength } from '../ui';
import { buildProject, describe, plainSummary, ProjectChoice, requiredTools } from '../project';
import { allowPnpmBuild, ensureGitignore, setEnvValue } from '../scaffold/files';
import { databaseUrl } from '../scaffold/database';
import { runWizard } from '../wizard';
import { memoryMemento, wait } from './helpers';
import { safeCommand } from '../log';
import { scaffolderTag } from '../updates';
import { isNodeEngineError, requiredNodeFromOutput, satisfies } from '../updates';
import { detectFramework, detectParts, updateSteps } from '../updater';

/**
 * Una elección de proyecto con valores por defecto, para no repetir en cada test.
 * @param overrides valores a cambiar
 */
function choice(overrides: Partial<ProjectChoice> = {}): ProjectChoice {
    return {
        template: findTemplate('react')!,
        typescript: true,
        tailwind: true,
        libraries: [],
        extras: ['git', 'vscode'],
        pm: packageManager('npm', '11.0.0'),
        name: 'demo-app',
        parentDir: os.tmpdir(),
        beginner: true,
        ...overrides,
    };
}

/**
 * Títulos de los pasos de un proyecto (para comprobar que aparecen).
 * @param c elección
 */
function stepTitles(c: ProjectChoice): string[] {
    const titles: string[] = [];
    for (const step of buildProject(c, 'python').steps) {
        titles.push(step.title);
    }
    return titles;
}

suite('DevStarter', function () {
    test('registers its commands', async function () {
        for (const ext of vscode.extensions.all) {
            if (ext.packageJSON.name === 'devstarter') {
                await ext.activate();
            }
        }
        const commands = await vscode.commands.getCommands(true);
        for (const id of [
            'newProject',
            'checkTools',
            'updateProject',
            'recentProjects',
            'openGuide',
            'changeExperience',
        ]) {
            assert.ok(commands.includes(`devstarter.${id}`), id);
        }
    });

    test('opens the wizard without crashing and can be closed', async function () {
        const wizard = runWizard({
            globalState: memoryMemento(),
            packageManagers: Promise.resolve([
                packageManager('npm', '11.0.0'),
                packageManager('pnpm'),
                packageManager('bun'),
            ]),
            git: Promise.resolve({ id: 'git', name: 'Git', installUrl: '', version: '2.0.0' }),
        });
        await wait(500);
        await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
        assert.strictEqual(await wizard, undefined);
    });

    test('validates project names', function () {
        assert.strictEqual(validateProjectName('my-app', 'kebab'), undefined);
        assert.strictEqual(validateProjectName('my_app', 'snake'), undefined);
        assert.ok(validateProjectName('', 'kebab'));
        assert.ok(validateProjectName('My App', 'kebab'));
        assert.ok(validateProjectName('my-app', 'snake'));
        assert.ok(validateProjectName('class', 'snake'));
    });

    test('suggests valid names', function () {
        assert.strictEqual(suggestName('My Cool App', 'kebab'), 'my-cool-app');
        assert.strictEqual(suggestName('Mi Aplicación', 'snake'), 'mi_aplicacion');
        assert.strictEqual(suggestName('  2 fast!! ', 'kebab'), 'fast');
    });

    test('compares versions', function () {
        assert.ok(compareVersions('20.19.0', '20.9.1') > 0);
        assert.ok(compareVersions('18.20.4', '20.19.0') < 0);
        assert.strictEqual(compareVersions('22.0', '22.0.0'), 0);
    });

    test('builds package manager commands', function () {
        assert.strictEqual(packageManager('npm').add(['tailwindcss'], true), 'npm install -D tailwindcss');
        assert.strictEqual(
            packageManager('pnpm').exec('create-vite@latest', ['app']),
            'pnpm dlx create-vite@latest app',
        );
        assert.strictEqual(packageManager('bun').run('dev'), 'bun run dev');
    });

    test('explains common errors', function () {
        assert.match(explainError('npm warn EBADENGINE Unsupported engine') ?? '', /Node\.js/);
        assert.match(explainError('getaddrinfo ENOTFOUND registry.npmjs.org') ?? '', /network/);
        assert.match(explainError('Author identity unknown *** Please tell me who you are.') ?? '', /git config/);
        assert.match(explainError('You are not logged into any GitHub hosts') ?? '', /gh auth login/);
        assert.strictEqual(explainError('everything is fine'), undefined);
    });

    test('every template builds a project, alone and with every backend', function () {
        for (const t of templates) {
            const name = t.nameStyle === 'snake' ? 'demo_app' : 'demo-app';
            const single = buildProject(choice({ template: t, name, database: t.databases?.[0] }), 'python');
            assert.ok(single.steps.length > 0, t.id);
            if (!t.acceptsBackend) {
                continue;
            }
            for (const backend of attachableBackends) {
                const full = buildProject(
                    choice({ template: t, backend, name, database: backend.databases?.[0] }),
                    'python',
                );
                let hasBackend = false;
                for (const s of full.servers) {
                    if (s.folder === 'backend') {
                        hasBackend = true;
                    }
                }
                assert.ok(hasBackend, `${t.id} + ${backend.id}`);
            }
        }
    });

    test('every library has a unique id and applies to an existing template', function () {
        const seen = new Set<string>();
        for (const lib of libraries) {
            assert.ok(!seen.has(lib.id), `duplicated ${lib.id}`);
            seen.add(lib.id);
            for (const id of lib.templates) {
                assert.ok(findTemplate(id), `${lib.id} → ${id}`);
            }
        }
        assert.ok(librariesFor('react').length >= 5);
    });

    test('no combination of template, backend, libraries and extras throws', function () {
        const extraSets: Array<ProjectChoice['extras']> = [
            [],
            ['git', 'vscode', 'ci', 'license', 'prettier', 'dockerfile', 'compose', 'publish'],
        ];
        let combinations = 0;
        for (const t of templates) {
            const backends = t.acceptsBackend ? [undefined, ...attachableBackends] : [undefined];
            for (const backend of backends) {
                const owner = backend ?? t;
                const dbs = [undefined, ...(owner.databases ?? [])];
                // Todas las librerías aplicables a la vez (el caso más cargado) y ninguna.
                const all: string[] = [];
                for (const lib of [...librariesFor(t.id), ...(backend ? librariesFor(backend.id) : [])]) {
                    all.push(lib.id);
                }
                for (const database of dbs) {
                    for (const libs of [[], all]) {
                        for (const extras of extraSets) {
                            for (const pm of ['npm', 'pnpm', 'bun'] as const) {
                                for (const beginner of [true, false]) {
                                    const name = t.nameStyle === 'snake' ? 'demo_app' : 'demo-app';
                                    const c = choice({
                                        template: t,
                                        backend,
                                        database,
                                        libraries: libs,
                                        extras,
                                        pm: packageManager(pm, '11.0.0'),
                                        name,
                                        beginner,
                                    });
                                    const project = buildProject(c, 'python');
                                    describe(c);
                                    requiredTools(c);
                                    const seen = new Set<string>();
                                    for (const step of project.steps) {
                                        assert.ok(step.title, `${t.id}+${backend?.id}: step without title`);
                                        if (step.kind === 'command') {
                                            assert.ok(step.command.trim() && step.cwd, `${t.id}: empty command`);
                                            assert.ok(!step.command.includes('undefined'), `${t.id}: ${step.command}`);
                                        }
                                        seen.add(step.title);
                                    }
                                    combinations++;
                                }
                            }
                        }
                    }
                }
            }
        }
        assert.ok(combinations > 1000, `only ${combinations} combinations`);
    });

    test('explains what will be created in plain words', function () {
        const text = plainSummary(
            choice({
                backend: findTemplate('express'),
                database: 'SQLite',
                libraries: ['zustand', 'gsap', 'three', 'p5'],
            }),
        );
        assert.strictEqual(
            text,
            'A website made with React and TypeScript, styled with Tailwind CSS, with an Express API backend and a SQLite database, plus Zustand, GSAP, Three.js and 1 more.',
        );
        assert.strictEqual(
            plainSummary(choice({ template: findTemplate('python-script')!, tailwind: false, typescript: false })),
            'A project made with Python script.',
        );
    });

    test('a command that throws shows a clear message instead of crashing', async function () {
        const shown: string[] = [];
        const original = vscode.window.showErrorMessage;
        (vscode.window as any).showErrorMessage = async function (message: string) {
            shown.push(message);
            return undefined;
        };
        try {
            const command = safeCommand('doing something', async function () {
                throw new Error('boom');
            });
            await command(); // no debe lanzar
        } finally {
            (vscode.window as any).showErrorMessage = original;
        }
        assert.deepStrictEqual(shown, ['DevStarter had a problem while doing something: boom']);
    });

    test('the generator version setting only accepts safe values', async function () {
        const config = vscode.workspace.getConfiguration('devstarter');
        try {
            await config.update(
                'scaffolderVersions',
                { '@angular/cli': '21', 'create-vite': '7.1.0', sv: 'x; calc', nuxt: '$(evil)' },
                vscode.ConfigurationTarget.Global,
            );
            assert.strictEqual(scaffolderTag('@angular/cli'), '21');
            assert.strictEqual(scaffolderTag('create-vite'), '7.1.0');
            assert.strictEqual(scaffolderTag('sv'), 'latest');
            assert.strictEqual(scaffolderTag('nuxt'), 'latest');
            assert.strictEqual(scaffolderTag('not-pinned'), 'latest');
        } finally {
            await config.update('scaffolderVersions', undefined, vscode.ConfigurationTarget.Global);
        }
    });

    test('every idea uses existing templates and libraries, and builds', function () {
        for (const preset of presets) {
            const template = findTemplate(preset.template);
            assert.ok(template, `${preset.id}: unknown template ${preset.template}`);
            const backend = findTemplate(preset.backend);
            assert.ok(!preset.backend || backend, `${preset.id}: unknown backend ${preset.backend}`);
            const found = findLibraries(preset.libraries);
            assert.strictEqual(found.length, preset.libraries.length, `${preset.id}: unknown library`);
            for (const lib of found) {
                const fits =
                    lib.templates.includes(preset.template) ||
                    (!!preset.backend && lib.templates.includes(preset.backend));
                assert.ok(fits, `${preset.id}: ${lib.id} does not apply to ${preset.template}`);
            }
            const project = buildProject(
                choice({
                    template: template!,
                    backend,
                    typescript: preset.typescript,
                    tailwind: preset.tailwind,
                    database: preset.database,
                    libraries: preset.libraries,
                }),
                'python',
            );
            assert.ok(project.steps.length > 0, preset.id);
        }
    });

    test('creative libraries install their packages once and set up their demo', function () {
        const titles = stepTitles(choice({ libraries: ['three', 'r3f', 'gsap'] }));
        assert.ok(titles.includes('Adding GSAP, Three.js, React Three Fiber'), titles.join(' | '));
        assert.ok(titles.includes('Setting up Three.js'));
        assert.ok(titles.includes('Setting up React Three Fiber'));
    });

    test('libraries add their install steps', function () {
        const titles = stepTitles(
            choice({ backend: findTemplate('express'), libraries: ['zustand', 'helmet', 'vitest'] }),
        );
        assert.ok(titles.includes('Adding Zustand, Vitest'));
        assert.ok(titles.includes('Setting up Vitest'));
        assert.ok(titles.includes('Adding Helmet'));
        assert.ok(titles.includes('Setting up Helmet'));
    });

    test('full-stack projects get a root dev script, CI, license and one git repo', function () {
        const c = choice({
            backend: findTemplate('fastapi'),
            database: 'PostgreSQL',
            extras: ['git', 'compose', 'ci', 'license', 'publish'],
        });
        const project = buildProject(c);
        assert.strictEqual(project.devAll, 'npm run dev');
        const titles = stepTitles(c);
        for (const title of [
            'Writing docker-compose.yml',
            'Writing GitHub Actions workflow',
            'Writing LICENSE (MIT)',
            'Creating Git repository',
            'Publishing to GitHub (private repository)',
        ]) {
            assert.ok(titles.includes(title), title);
        }
        assert.deepStrictEqual(requiredTools(c), ['node', 'python', 'git', 'gh']);
    });

    test('describes a project in one line', function () {
        const text = describe(choice({ backend: findTemplate('express'), database: 'SQLite', libraries: ['zustand'] }));
        assert.strictEqual(text, 'React · TypeScript · Tailwind CSS + Express API · SQLite · 1 library · Git · npm');
    });

    test('edits .env values even when commented out', function () {
        assert.strictEqual(setEnvValue('A=1\n# DB_HOST=x\n', 'DB_HOST', '127.0.0.1'), 'A=1\nDB_HOST=127.0.0.1\n');
        assert.strictEqual(setEnvValue('A=1\n', 'B', '2'), 'A=1\nB=2\n');
    });

    test('approves pnpm builds and completes .gitignore without duplicates', function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-'));
        fs.writeFileSync(
            path.join(dir, 'pnpm-workspace.yaml'),
            'allowBuilds:\n  better-sqlite3: set this to true or false\n  esbuild: true\n',
        );
        allowPnpmBuild(dir, 'better-sqlite3');
        assert.strictEqual(
            fs.readFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'utf8'),
            'allowBuilds:\n  better-sqlite3: true\n  esbuild: true\n',
        );

        fs.writeFileSync(path.join(dir, '.gitignore'), '/node_modules\n');
        ensureGitignore(dir, ['node_modules/', '.env']);
        assert.strictEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '/node_modules\n.env\n');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('builds database URLs for each library', function () {
        assert.strictEqual(databaseUrl('PostgreSQL', 'my-app'), 'postgres://postgres:postgres@localhost:5432/my_app');
        assert.strictEqual(
            databaseUrl('MySQL', 'my-app', 'sqlalchemy'),
            'mysql+pymysql://root:password@localhost:3306/my_app',
        );
    });

    test('understands npm version ranges', function () {
        const angular = '^22.22.3 || ^24.15.0 || >=26.0.0';
        assert.strictEqual(satisfies('24.14.1', angular), false);
        assert.strictEqual(satisfies('24.15.0', angular), true);
        assert.strictEqual(satisfies('22.22.3', angular), true);
        assert.strictEqual(satisfies('23.0.0', angular), false);
        assert.strictEqual(satisfies('26.1.0', angular), true);
        assert.strictEqual(satisfies('20.19.0', '>=20.19.0'), true);
        assert.strictEqual(satisfies('18.20.0', '>= 18 < 20'), true);
        assert.strictEqual(satisfies('20.1.0', '>= 18 < 20'), false);
        assert.strictEqual(satisfies('20.5.0', '20.x'), true);
        assert.strictEqual(satisfies('21.0.0', '~20.4'), false);
        assert.strictEqual(satisfies('1.0.0', undefined), true);
    });

    test('recognises "your Node.js is too old" errors', function () {
        const output =
            'Node.js version v24.14.1 detected.\nThe Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0.\nPlease update your Node.js version';
        assert.ok(isNodeEngineError(output));
        assert.strictEqual(requiredNodeFromOutput(output), 'v22.22.3 or v24.15.0 or v26.0.0');
        assert.ok(!isNodeEngineError('npm ERR! network timeout'));
    });

    test('finds every part of a project to update', function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-parts-'));
        fs.mkdirSync(path.join(root, 'frontend', 'node_modules', 'x'), { recursive: true });
        fs.writeFileSync(path.join(root, 'frontend', 'package.json'), '{"scripts":{"build":"vite build"}}');
        fs.writeFileSync(path.join(root, 'frontend', 'pnpm-lock.yaml'), '');
        fs.writeFileSync(path.join(root, 'frontend', 'node_modules', 'x', 'package.json'), '{}');
        fs.mkdirSync(path.join(root, 'backend', '.venv'), { recursive: true });
        fs.writeFileSync(path.join(root, 'backend', 'requirements.txt'), 'flask\n');
        const parts = detectParts(root);
        const found: string[] = [];
        for (const p of parts) {
            found.push(`${p.label}:${p.kind}:${p.pm ?? ''}`);
        }
        assert.deepStrictEqual(found.sort(), ['backend:python:', 'frontend:node:pnpm']);
        const titles: string[] = [];
        for (const step of updateSteps(parts, { root, mode: 'safe', checkpoint: true, verify: true })) {
            titles.push(step.title);
        }
        assert.ok(titles.includes('Saving a Git checkpoint'));
        assert.ok(titles.includes('Installing updated packages in frontend'));
        assert.ok(titles.includes('Updating Python packages in backend'));
        assert.ok(titles.includes('Checking that frontend still builds'));
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('frameworks are updated with their official tool', function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-fw-'));
        const cases: Array<[string, Record<string, string>, string]> = [
            ['ng', { '@angular/core': '^20.0.0' }, 'ng update'],
            ['expo-app', { expo: '~54.0.0' }, 'expo install --fix'],
            ['nx', { next: '^15.0.0' }, '@next/codemod'],
            ['nu', { nuxt: '^4.0.0' }, 'nuxt upgrade'],
            ['as', { astro: '^5.0.0' }, '@astrojs/upgrade'],
        ];
        for (const [folder, deps, expected] of cases) {
            const dir = path.join(root, folder);
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: deps }));
            assert.ok(detectFramework(dir), folder);
            const commands: string[] = [];
            for (const step of updateSteps(detectParts(dir), {
                root: dir,
                mode: 'latest',
                checkpoint: false,
                verify: false,
            })) {
                if (step.kind === 'command') {
                    commands.push(step.command);
                }
            }
            assert.ok(commands.join('\n').includes(expected), `${folder}: ${commands.join(' | ')}`);
            // El framework se protege de la actualización genérica de versiones.
            assert.ok(commands.join('\n').includes('--reject'), folder);
        }
        // Un proyecto sin framework conocido no lleva herramienta oficial.
        const plain = path.join(root, 'plain');
        fs.mkdirSync(plain);
        fs.writeFileSync(path.join(plain, 'package.json'), '{"dependencies":{"left-pad":"1.0.0"}}');
        assert.strictEqual(detectFramework(plain), undefined);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('pnpm projects get packageManager pinned to the installed pnpm', function () {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-pin-'));
        const folder = 'app';
        fs.mkdirSync(path.join(root, folder));
        const file = path.join(root, folder, 'package.json');
        fs.writeFileSync(file, JSON.stringify({ name: 'app', packageManager: 'pnpm@99.0.0' }));
        const c = choice({
            template: findTemplate('angular')!,
            pm: packageManager('pnpm', '11.22.0'),
            name: folder,
            parentDir: root,
        });
        const step = buildProject(c, 'python').steps[0];
        assert.ok(step.kind === 'command' && step.command.includes('pnpm dlx @angular/cli@latest'));
        if (step.kind === 'command') {
            // Ejecutamos solo la parte del arreglo (lo que va después de "&&"), como haría la consola.
            const fix = step.command.slice(step.command.indexOf(' && ') + 4);
            cp.execSync(fix, { cwd: root });
            assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).packageManager, 'pnpm@11.22.0');
            // npm no necesita el arreglo.
            const npmStep = buildProject(choice({ template: findTemplate('angular')! }), 'python').steps[0];
            assert.ok(npmStep.kind === 'command' && !npmStep.command.includes(' && node -e'));
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('generators can be retried with another version', function () {
        const step = buildProject(choice({ template: findTemplate('angular')! }), 'python').steps[0];
        assert.ok(step.kind === 'command' && step.compat, 'Angular step has no compat info');
        if (step.kind === 'command' && step.compat) {
            assert.strictEqual(step.compat.package, '@angular/cli');
            assert.ok(step.command.includes('@angular/cli@latest'));
            assert.ok(step.compat.command('21.2.0').includes('@angular/cli@21.2.0'));
        }
    });

    test('renders terminal UI helpers', function () {
        assert.strictEqual(stripAnsi(gradient('hello')), 'hello');
        assert.strictEqual(stripAnsi(shimmer('hello', 3)), 'hello');
        const lines = box(['one', 'three'], { title: 'Hi' });
        const width = visibleLength(lines[0]);
        for (const l of lines) {
            assert.strictEqual(visibleLength(l), width);
        }
        assert.strictEqual(banner(200).length, 6);
        assert.strictEqual(banner(40).length, 1);
    });
});
