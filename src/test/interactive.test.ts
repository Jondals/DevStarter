/**
 * test/interactive.test.ts
 * ────────────────────────
 * "Click by click" tests: they replace VS Code's windows (QuickPick, InputBox, terminal,
 * dialogs and notifications) with fakes that pick options the way a person would,
 * and run the extension's real commands:
 *
 *  - The whole quick wizard, with the Back button and the libraries step.
 *  - An idea ("Start from an idea") that pre-fills every step and keeps them editable.
 *  - Check My Tools and Recent Projects.
 *  - End to end: create a real project from an idea (needs internet).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { packageManager } from '../tools';
import { CommandStep, DevStarterTerminal } from '../terminal';
import { latestCompatibleVersion } from '../updates';
import { afterCreate, isListening, openWhenReady } from '../commands/launch';
import { PendingLaunch } from '../state';
import * as net from 'net';
import * as http from 'http';
import { runWizard } from '../wizard';
import { ProjectChoice } from '../project';
import {
    captureTerminal,
    devstarterApi,
    installFakeInputs,
    interceptOpenFolder,
    memoryMemento,
    plainLabel,
    removeQuietly,
    restoreWindow,
    selectable,
    silenceMessages,
    wait,
} from './helpers';

/** Normalized path for comparisons (Windows paths ignore case and slash direction). */
function normalizeOpened(item: { folder: string; newWindow: boolean }): { folder: string; newWindow: boolean } {
    return { folder: vscode.Uri.file(item.folder).fsPath.toLowerCase(), newWindow: item.newWindow };
}

/**
 * Runs afterCreate with fake terminals and folder opening.
 * @param hasWorkspace pretends a folder is already open (or not)
 */
async function runAfterCreate(hasWorkspace: boolean): Promise<{
    terminals: Array<[string, string]>;
    saved: PendingLaunch | undefined;
    opened: Array<{ folder: string; newWindow: boolean }>;
}> {
    const terminals: Array<[string, string]> = [];
    (vscode.window as any).createTerminal = function (options: vscode.TerminalOptions) {
        const entry: [string, string] = [options.name ?? '', ''];
        terminals.push(entry);
        return {
            show() {},
            dispose() {},
            sendText(text: string) {
                entry[1] = text;
            },
        };
    };
    silenceMessages();
    const original = vscode.commands.executeCommand;
    const opened: Array<{ folder: string; newWindow: boolean }> = [];
    (vscode.commands as any).executeCommand = async function (command: string, ...args: any[]) {
        if (command === 'vscode.openFolder') {
            opened.push({ folder: (args[0] as vscode.Uri).fsPath, newWindow: !!args[1]?.forceNewWindow });
            return undefined;
        }
        return original.call(vscode.commands, command, ...args);
    };
    // "A folder is open" = workspaceFolders is not empty.
    const descriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        configurable: true,
        get() {
            return hasWorkspace ? [{ uri: vscode.Uri.file('C:/other'), name: 'other', index: 0 }] : undefined;
        },
    });
    // ! We do not want to open a real browser: the site does not answer and it would keep waiting in the background.
    const memento = memoryMemento();
    try {
        await afterCreate(
            { globalState: memento } as unknown as vscode.ExtensionContext,
            {
                root: 'C:/p',
                servers: [
                    { label: 'Frontend', cwd: 'C:/p/frontend', command: 'pnpm dev' },
                    { label: 'Backend', cwd: 'C:/p/backend', command: 'php artisan serve' },
                ],
                openGuide: false,
                createdAt: Date.now(),
            },
            'p',
        );
    } finally {
        (vscode.commands as any).executeCommand = original;
        if (descriptor) {
            Object.defineProperty(vscode.workspace, 'workspaceFolders', descriptor);
        }
    }
    return { terminals, saved: memento.get<PendingLaunch>('devstarter.pendingLaunch'), opened };
}

suite('DevStarter · click by click', function () {
    // * These tests drive the keyboard (QuickPick) wizard, so "New Project" must open it instead of the webview.
    suiteSetup(async function () {
        await vscode.workspace
            .getConfiguration('devstarter')
            .update('wizardStyle', 'quick', vscode.ConfigurationTarget.Global);
    });
    teardown(restoreWindow);

    test('the wizard goes through every step, with Back and libraries', async function () {
        this.timeout(20000);
        let librariesVisits = 0;
        const firstScreens: vscode.QuickPickItem[][] = [];
        const starred = new Set<string>();
        const seen = installFakeInputs(function (placeholder, items) {
            // Record everything the wizard marks as recommended, in any step.
            for (const item of selectable(items)) {
                if (item.description?.includes('⭐ Recommended')) {
                    starred.add(plainLabel(item));
                }
            }
            if (placeholder.includes('coding experience')) {
                return { labels: ["I'm new to programming"] };
            }
            if (placeholder.includes('What do you want')) {
                firstScreens.push(selectable(items));
                return { labels: ['React'] };
            }
            if (placeholder.includes('Which language')) {
                return { labels: ['TypeScript'] };
            }
            if (placeholder.includes('Add a backend')) {
                return { labels: ['Express API'] };
            }
            if (placeholder.includes('database integration')) {
                return { labels: ['SQLite'] };
            }
            if (placeholder.includes('libraries')) {
                librariesVisits++;
                // ? The first time we press Back to check that it returns to the database step.
                return librariesVisits === 1 ? 'back' : { labels: ['Three.js', 'GSAP', 'Zustand', 'Helmet'] };
            }
            if (placeholder.includes('Extras')) {
                return 'defaults';
            }
            if (placeholder.includes('Package manager')) {
                return { labels: ['npm'] };
            }
            if (placeholder.includes('Where should')) {
                return { index: 0 };
            }
            if (placeholder.includes('Ready to create')) {
                return { labels: ['Create project'] };
            }
            throw new Error(`Unexpected step: ${placeholder}`);
        }, `wizard-test-${Date.now()}`);

        const choice = (await runWizard({
            globalState: memoryMemento(),
            packageManagers: Promise.resolve([
                packageManager('npm', '11.0.0'),
                packageManager('pnpm'),
                packageManager('bun'),
            ]),
            git: Promise.resolve({ id: 'git', name: 'Git', installUrl: '', version: '2.0.0' }),
        })) as ProjectChoice;

        assert.ok(choice, 'the wizard returned nothing');
        // A beginner sees EVERYTHING on the first screen: the ideas and every technology...
        const labels = firstScreens[0].map(plainLabel);
        for (const expected of ['A 3D website', 'React', 'Laravel', 'Flutter', 'Rust (Axum)', 'Spring Boot']) {
            assert.ok(labels.includes(expected), `${expected} missing: ${labels.join(', ')}`);
        }
        // ...with the recommendation marked and recommended ones first in their group (FastAPI before NestJS).
        const react = firstScreens[0].find(function (i) {
            return plainLabel(i) === 'React';
        });
        assert.ok(react?.description?.includes('⭐ Recommended'), react?.description);
        assert.ok(labels.indexOf('FastAPI') < labels.indexOf('NestJS'), labels.join(', '));
        for (const expected of [
            'React',
            'TypeScript',
            'Express API',
            'SQLite',
            'Tailwind CSS',
            'Git repository',
            'npm',
        ]) {
            assert.ok(starred.has(expected), `${expected} is not marked as recommended: ${[...starred].join(', ')}`);
        }
        assert.strictEqual(choice.template.id, 'react');
        assert.strictEqual(choice.backend?.id, 'express');
        assert.strictEqual(choice.database, 'SQLite');
        assert.deepStrictEqual([...choice.libraries].sort(), ['gsap', 'helmet', 'three', 'zustand']);
        assert.ok(choice.extras.includes('vscode') && choice.extras.includes('git'));
        assert.strictEqual(librariesVisits, 2, 'Back from libraries should return to it after the database step');
        // After Back, the database question is asked again.
        const order: string[] = [];
        for (const p of seen) {
            order.push(p.split(' ')[0]);
        }
        assert.ok(seen.some(isDatabaseQuestion));
        assert.ok(seen.filter(isDatabaseQuestion).length === 2, order.join(' → '));
    });

    test('an idea pre-fills every step but keeps them editable (Git included)', async function () {
        this.timeout(20000);
        const extrasOffered: string[] = [];
        const seen = installFakeInputs(function (placeholder, items) {
            if (placeholder.includes('coding experience')) {
                return { labels: ["I'm new to programming"] };
            }
            if (placeholder.includes('What do you want')) {
                return { labels: ['A 3D website'] };
            }
            if (placeholder.includes('Extras')) {
                extrasOffered.push(...selectable(items).map(plainLabel));
            }
            if (placeholder.includes('Where should')) {
                return { index: 0 };
            }
            if (placeholder.includes('Ready to create')) {
                return { labels: ['Create project'] };
            }
            // * Every other step is shown with the idea's answers already selected: just accept them.
            return 'defaults';
        }, `idea-test-${Date.now()}`);

        const choice = (await runWizard({
            globalState: memoryMemento(),
            packageManagers: Promise.resolve([
                packageManager('npm', '11.0.0'),
                packageManager('pnpm'),
                packageManager('bun'),
            ]),
            git: Promise.resolve({ id: 'git', name: 'Git', installUrl: '', version: '2.0.0' }),
        })) as ProjectChoice;

        assert.strictEqual(choice.template.id, 'vanilla');
        assert.deepStrictEqual([...choice.libraries].sort(), ['gsap', 'three']);
        assert.strictEqual(choice.tailwind, true);
        assert.ok(
            seen.some(function (p) {
                return p.includes('libraries');
            }),
            `the libraries step should be shown for an idea: ${seen.join(' | ')}`,
        );
        assert.ok(extrasOffered.includes('Git repository'), `Git not offered: ${extrasOffered.join(', ')}`);
        assert.ok(choice.extras.includes('git'), 'Git should stay ticked by default');
    });

    test('Check & Update My Tools lists versions and offers installs and updates', async function () {
        this.timeout(120000);
        const output = captureTerminal();
        silenceMessages();
        const offered: vscode.QuickPickItem[] = [];
        (vscode.window as any).showQuickPick = async function (items: vscode.QuickPickItem[]) {
            offered.push(...items);
            return undefined; // we do not install or update anything
        };
        await vscode.commands.executeCommand('devstarter.checkTools');
        const text = output();
        assert.ok(text.includes('Your development tools'), text);
        for (const tool of ['Node.js', 'Git', 'Python', 'npm', 'pnpm', 'bun']) {
            assert.ok(text.includes(tool), `${tool} missing in:\n${text}`);
        }
        assert.match(text, /Node\.js\s+v\d+\.\d+/);
        for (const item of offered) {
            const label = plainLabel(item);
            const name = label.replace(/^(Install|Update) /, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (label.startsWith('Install ')) {
                // What is offered for install shows as "not installed".
                assert.match(text, new RegExp(`${name}\\s+not installed`));
            } else {
                // What is offered for update is installed (with its version).
                assert.match(text, new RegExp(`${name}\\s+v\\d`));
            }
        }
        // npm is installed here, so updating it is always offered.
        assert.ok(
            offered.some(function (i) {
                return plainLabel(i) === 'Update npm';
            }),
        );
    });

    test('a failed step can be fixed and retried automatically', async function () {
        this.timeout(30000);
        const output = captureTerminal();
        const term = await DevStarterTerminal.create('recovery test', { verbose: false, beginner: false });
        let asked = 0;
        term.setRecovery(async function (step) {
            asked++;
            // Fake fix: a step first and then the same step with another command.
            return {
                message: 'Fixing it',
                before: [{ kind: 'task', title: 'Preparing the fix', run() {} }],
                retry: { ...(step as CommandStep), title: 'Fixed step', command: 'node -e "process.exit(0)"' },
            };
        });
        const result = await term.runSteps([
            { kind: 'command', title: 'Broken step', command: 'node -e "process.exit(3)"', cwd: os.tmpdir() },
        ]);
        assert.strictEqual(result, 'success', output());
        assert.strictEqual(asked, 1);
        const text = output();
        assert.ok(
            text.includes('Fixing it') && text.includes('Preparing the fix') && text.includes('Fixed step'),
            text,
        );
    });

    test('a step that keeps failing is only fixed once (no loops)', async function () {
        this.timeout(30000);
        captureTerminal();
        const term = await DevStarterTerminal.create('recovery loop test', { verbose: false, beginner: false });
        let asked = 0;
        term.setRecovery(async function (step) {
            asked++;
            return { message: 'Trying again', before: [], retry: step };
        });
        const result = await term.runSteps([
            { kind: 'command', title: 'Always broken', command: 'node -e "process.exit(3)"', cwd: os.tmpdir() },
        ]);
        assert.strictEqual(result, 'failed');
        assert.strictEqual(asked, 1);
    });

    test('the app opens by itself when the dev server answers: browser by default, VS Code or nothing if you choose', async function () {
        this.timeout(60000);
        const server = http.createServer(function (_req, res) {
            res.end('hello');
        });
        await new Promise<void>(function (resolve) {
            server.listen(0, resolve);
        });
        const url = `http://localhost:${(server.address() as { port: number }).port}`;

        // Fake both ways of opening (so the test never opens a real browser).
        const inside: string[] = [];
        const outside: string[] = [];
        const originalCommand = vscode.commands.executeCommand;
        const originalExternal = vscode.env.openExternal;
        (vscode.commands as any).executeCommand = async function (command: string, ...args: unknown[]) {
            if (command === 'simpleBrowser.show') {
                inside.push(String(args[0]));
                return undefined;
            }
            return originalCommand.call(vscode.commands, command, ...args);
        };
        (vscode.env as any).openExternal = async function (uri: vscode.Uri) {
            outside.push(uri.toString());
            return true;
        };
        const config = vscode.workspace.getConfiguration('devstarter');
        try {
            // Untouched: in the browser.
            await config.update('openBrowser', undefined, vscode.ConfigurationTarget.Global);
            await openWhenReady(url);
            assert.strictEqual(outside.length, 1, 'default should open the browser');
            assert.ok(outside[0].startsWith(url.replace('localhost', 'localhost')), outside[0]);
            assert.strictEqual(inside.length, 0);

            // Inside VS Code.
            await config.update('openBrowser', 'inside', vscode.ConfigurationTarget.Global);
            await openWhenReady(url);
            assert.deepStrictEqual(inside, [url]);
            assert.strictEqual(outside.length, 1);

            // Nothing.
            await config.update('openBrowser', 'off', vscode.ConfigurationTarget.Global);
            await openWhenReady(url);
            assert.strictEqual(inside.length + outside.length, 2);
        } finally {
            await config.update('openBrowser', undefined, vscode.ConfigurationTarget.Global);
            (vscode.commands as any).executeCommand = originalCommand;
            (vscode.env as any).openExternal = originalExternal;
            server.close();
        }
    });

    test('tools installed while VS Code is open reach new terminals (PATH)', async function () {
        this.timeout(30000);
        const api = await devstarterApi();
        const toolsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-php-'));
        const originalPath = process.env.PATH;
        try {
            // As if php.new had just installed PHP: the folder appears in the process PATH.
            process.env.PATH = `${originalPath}${path.delimiter}${toolsDir}`;
            const extra = api.syncTerminalPath() as string | undefined;
            assert.ok(extra && extra.includes(toolsDir), `terminal PATH extras: ${extra}`);
        } finally {
            process.env.PATH = originalPath;
            removeQuietly(toolsDir);
        }
    });

    test('frontend and backend start by themselves, each in its own terminal', async function () {
        this.timeout(30000);
        const api = await devstarterApi();
        const created: Array<{ name: string; cwd: string; sent: string[] }> = [];
        (vscode.window as any).createTerminal = function (options: vscode.TerminalOptions) {
            const terminal = { name: options.name ?? '', cwd: String(options.cwd), sent: [] as string[] };
            created.push(terminal);
            return {
                show() {},
                dispose() {},
                sendText(text: string) {
                    terminal.sent.push(text);
                },
            };
        };
        // The URL does not answer: this also checks that it does not block waiting for the browser.
        await api.startDevServers({
            root: 'C:/p',
            servers: [
                { label: 'Frontend', cwd: 'C:/p/frontend', command: 'pnpm dev' },
                { label: 'Backend', cwd: 'C:/p/backend', command: 'php artisan serve' },
            ],
            openGuide: false,
            createdAt: Date.now(),
        });
        assert.deepStrictEqual(
            created.map(function (t) {
                return [t.name, t.sent[0]];
            }),
            [
                ['Frontend', 'pnpm dev'],
                ['Backend', 'php artisan serve'],
            ],
        );
    });

    test('with a folder already open, the servers start right away and the project opens in a new window', async function () {
        this.timeout(30000);
        const { terminals, saved, opened } = await runAfterCreate(true);
        // The servers start RIGHT AWAY, from this window (they do not depend on the new one having DevStarter)...
        assert.deepStrictEqual(terminals, [
            ['Frontend', 'pnpm dev'],
            ['Backend', 'php artisan serve'],
        ]);
        // ...and the new window already knows it must not start them again.
        assert.strictEqual(saved?.serversStarted, true);
        assert.deepStrictEqual(opened, [{ folder: 'C:\\p', newWindow: true }].map(normalizeOpened));
    });

    test('with no folder open, opening the project reloads the window, so the servers start after the reload', async function () {
        this.timeout(30000);
        const { terminals, saved, opened } = await runAfterCreate(false);
        assert.deepStrictEqual(terminals, [], 'terminals would be lost on reload');
        assert.notStrictEqual(saved?.serversStarted, true);
        assert.deepStrictEqual(opened, [{ folder: 'C:\\p', newWindow: false }].map(normalizeOpened));
    });

    test('a busy port is detected (and a free one is not)', async function () {
        this.timeout(30000);
        const server = net.createServer();
        await new Promise<void>(function (resolve) {
            server.listen(0, '127.0.0.1', resolve);
        });
        const port = (server.address() as net.AddressInfo).port;
        try {
            assert.strictEqual(await isListening(port), true);
        } finally {
            await new Promise(function (resolve) {
                server.close(resolve);
            });
        }
        assert.strictEqual(await isListening(port), false);
    });

    test('Update Project refuses to run install scripts in an untrusted folder', async function () {
        this.timeout(30000);
        const messages: string[] = [];
        const original = vscode.window.showWarningMessage;
        (vscode.window as any).showWarningMessage = async function (message: string) {
            messages.push(message);
            return undefined;
        };
        let asked = 0;
        (vscode.window as any).showQuickPick = async function () {
            asked++;
            return undefined;
        };
        const descriptor = Object.getOwnPropertyDescriptor(vscode.workspace, 'isTrusted');
        Object.defineProperty(vscode.workspace, 'isTrusted', {
            configurable: true,
            get() {
                return false;
            },
        });
        try {
            await vscode.commands.executeCommand('devstarter.updateProject');
        } finally {
            (vscode.window as any).showWarningMessage = original;
            if (descriptor) {
                Object.defineProperty(vscode.workspace, 'isTrusted', descriptor);
            }
        }
        assert.strictEqual(messages.length, 1, 'it should explain why it does nothing');
        assert.match(messages[0], /trust this folder/);
        assert.strictEqual(asked, 0, 'it must not even offer to update');
    });

    test('Recent Projects shows created projects and asks how to open them', async function () {
        this.timeout(20000);
        const api = await devstarterApi();
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-demo-'));
        await api.rememberProject({ name: 'recent-demo', root, stack: 'React · TypeScript', createdAt: Date.now() });

        const calls: vscode.QuickPickItem[][] = [];
        (vscode.window as any).showQuickPick = async function (items: any[]) {
            calls.push(items);
            if (calls.length === 1) {
                return items.find(function (i: vscode.QuickPickItem) {
                    return i.label.includes('recent-demo');
                });
            }
            return undefined; // we do not open any window during the test
        };
        await vscode.commands.executeCommand('devstarter.recentProjects');

        assert.strictEqual(calls.length, 2, 'it should ask which project and then how to open it');
        const project = calls[0].find(function (i) {
            return i.label.includes('recent-demo');
        });
        assert.ok(project);
        assert.strictEqual(project.description, 'React · TypeScript');
        assert.deepStrictEqual(calls[1].map(plainLabel), [
            'Open in this window',
            'Open in a new window',
            'Show in file explorer',
        ]);
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('Update Project updates an old library to its latest version (needs internet)', async function () {
        this.timeout(180000);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-update-'));
        // is-number 6 is old: the latest is 7.
        fs.writeFileSync(
            path.join(dir, 'package.json'),
            JSON.stringify(
                { name: 'update-demo', version: '1.0.0', private: true, dependencies: { 'is-number': '^6.0.0' } },
                null,
                2,
            ),
        );
        (vscode.window as any).showOpenDialog = async function () {
            return [vscode.Uri.file(dir)];
        };
        const placeholders: string[] = [];
        (vscode.window as any).showQuickPick = async function (items: any[], options: vscode.QuickPickOptions) {
            placeholders.push(options.placeHolder ?? '');
            if (options.canPickMany) {
                return []; // no extra options
            }
            return items.find(function (i: vscode.QuickPickItem) {
                return plainLabel(i) === 'Latest versions';
            });
        };
        const output = captureTerminal();
        silenceMessages();

        await vscode.commands.executeCommand('devstarter.updateProject');

        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const text = output();
        assert.match(pkg.dependencies['is-number'], /^\^7\./, text);
        assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'is-number')), 'packages were not installed');
        assert.ok(text.includes('Your project is up to date.'), text);
        assert.ok(placeholders[0].includes('JavaScript (npm)'), placeholders.join(' | '));
        removeQuietly(dir);
    });

    test('finds the newest Angular CLI that works with an older Node.js (needs internet)', async function () {
        this.timeout(60000);
        const version = await latestCompatibleVersion('@angular/cli', '20.0.0');
        assert.ok(version, 'no compatible version found');
        // Angular 20+ needs Node 20.19+, so for Node 20.0.0 it must be an older version.
        assert.ok(Number(version!.split('.')[0]) < 20, version);
    });

    test('Angular is created even with an old Node.js, using a compatible version (needs internet)', async function () {
        this.timeout(600000);
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-angular-'));
        installFakeInputs(function (placeholder) {
            if (placeholder.includes('coding experience')) {
                return { labels: ['I already know how to code'] };
            }
            if (placeholder.includes('What do you want')) {
                return { labels: ['Angular'] };
            }
            if (placeholder.includes('Add a backend')) {
                return { labels: ['No backend'] };
            }
            if (placeholder.includes('libraries')) {
                return 'defaults';
            }
            if (placeholder.includes('Extras')) {
                return { labels: ['Recommended VS Code extensions'] }; // no Tailwind or Git, to go faster
            }
            if (placeholder.includes('Package manager')) {
                return { labels: ['npm'] };
            }
            if (placeholder.includes('Where should')) {
                return { labels: ['Browse…'] };
            }
            if (placeholder.includes('Ready to create')) {
                return { labels: ['Create project'] };
            }
            throw new Error(`Unexpected step: ${placeholder}`);
        }, 'ng-app');
        (vscode.window as any).showOpenDialog = async function () {
            return [vscode.Uri.file(parent)];
        };
        const output = captureTerminal();
        const messages = silenceMessages();
        // If the "Node.js too old" warning shows up, pick the compatible version
        // (we do not update Node.js during a test).
        const recoveryAnswers: string[] = [];
        (vscode.window as any).showWarningMessage = async function (message: string, ...rest: any[]) {
            messages.push(message);
            for (const option of rest) {
                if (typeof option === 'string' && option.startsWith('Use ')) {
                    recoveryAnswers.push(option);
                    return option;
                }
            }
            return undefined;
        };

        const opened = interceptOpenFolder();
        await vscode.commands.executeCommand('devstarter.newProject');
        await wait(500);
        opened.restore();

        const dir = path.join(parent, 'ng-app');
        const text = output();
        assert.ok(
            fs.existsSync(path.join(dir, 'angular.json')),
            `Angular project not created:
${text.slice(-3000)}`,
        );
        assert.ok(text.includes('is ready!'), text.slice(-3000));
        // On a machine with an older Node the latest Angular needs more: another version must have been used.
        console.log(
            recoveryAnswers.length
                ? `      recovered with: ${recoveryAnswers[0]}`
                : '      no recovery needed (Node.js is new enough)',
        );
        removeQuietly(parent);
    });

    test('end to end: an idea creates a real project with its demo (needs internet)', async function () {
        this.timeout(300000);
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-e2e-'));
        const name = 'art-demo';
        installFakeInputs(function (placeholder) {
            if (placeholder.includes('coding experience')) {
                return { labels: ["I'm new to programming"] };
            }
            if (placeholder.includes('What do you want')) {
                return { labels: ['Interactive art and drawings with code'] };
            }
            if (placeholder.includes('Where should')) {
                return { labels: ['Browse…'] };
            }
            if (placeholder.includes('Ready to create')) {
                return { labels: ['Create project'] };
            }
            return 'defaults'; // * an idea pre-fills the other steps
        }, name);
        (vscode.window as any).showOpenDialog = async function () {
            return [vscode.Uri.file(parent)];
        };
        const output = captureTerminal();
        const messages = silenceMessages();
        const opened = interceptOpenFolder();

        await vscode.commands.executeCommand('devstarter.newProject');
        await wait(500); // the project is opened right after the notification
        opened.restore();

        const dir = path.join(parent, name);
        const text = output();
        // It opens directly, without asking anything.
        assert.strictEqual(opened.calls.length, 1, 'the project should open by itself');
        assert.strictEqual(opened.calls[0].toLowerCase(), dir.toLowerCase());
        assert.ok(fs.existsSync(path.join(dir, 'package.json')), `project not created:\n${text}`);
        assert.ok(fs.existsSync(path.join(dir, 'demos', 'p5.html')), 'p5 demo missing');
        assert.ok(fs.existsSync(path.join(dir, 'demos', 'index.html')), 'demo index missing');
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        assert.ok(pkg.dependencies?.p5, 'p5 not installed');
        const guide = fs.readFileSync(path.join(dir, 'GETTING_STARTED.md'), 'utf8');
        assert.ok(guide.includes('http://localhost:5173/demos/p5.html'), 'guide should link the demo');
        assert.ok(text.includes('is ready!'), text);
        assert.ok(text.includes('/demos/'), 'summary should link the demos');
        assert.ok(
            messages.some(function (m) {
                return m.includes('is ready');
            }),
            messages.join(' | '),
        );
        removeQuietly(parent);
    });
});

/** Whether it is the database question. */
function isDatabaseQuestion(placeholder: string): boolean {
    return placeholder.includes('database integration');
}
