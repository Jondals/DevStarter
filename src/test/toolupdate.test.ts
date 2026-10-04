/**
 * test/toolupdate.test.ts
 * ───────────────────────
 * Tests de las actualizaciones de herramientas (Node.js, pnpm…): que solo se da por buena una
 * actualización si la versión cambió de verdad, y que se explica por qué cuando no cambia.
 * Usan herramientas "falsas" (comandos de Node que simulan winget, npm…), sin tocar nada del PC.
 */
import * as assert from 'assert';
import { DevStarterTerminal } from '../terminal';
import { updaterFor } from '../tools';
import { parseShaSums, sha256, toolUpdateStep, UpdateTarget, unchangedReason, wingetCodes } from '../toolupdate';
import { captureTerminal, restoreWindow } from './helpers';

/** Comando de consola que termina con el código indicado (funciona en cualquier sistema). */
function exitWith(code: number): string {
    return `node -e "process.exit(${code})"`;
}

/**
 * Crea una herramienta falsa: la "versión instalada" va cambiando según la lista `versions`
 * (cada lectura devuelve la siguiente; la última se repite).
 * @param versions versiones que devolverá `detect`, en orden
 * @param overrides cualquier otro dato de la herramienta
 */
function fakeTool(versions: string[], overrides: Partial<UpdateTarget> = {}): UpdateTarget {
    let reads = 0;
    return {
        name: 'FakeTool',
        current: '1.0.0',
        latest: '2.0.0',
        installer: { title: 'Updating FakeTool', command: exitWith(0) },
        async detect() {
            return versions[Math.min(reads++, versions.length - 1)];
        },
        ...overrides,
    };
}

/**
 * Ejecuta el paso de actualización en un terminal de pruebas.
 * @param target herramienta falsa
 * @returns el resultado y todo lo que se escribió
 */
async function runUpdate(target: UpdateTarget): Promise<{ result: string; text: string }> {
    const output = captureTerminal();
    const term = await DevStarterTerminal.create('update test', { verbose: false, beginner: false });
    const result = await term.runSteps([toolUpdateStep(target)]);
    return { result, text: output() };
}

suite('DevStarter · tool updates', function () {
    // captureTerminal sustituye createTerminal: se restaura al terminar cada test.
    teardown(restoreWindow);

    test('an update that changes the version is reported as old → new', async function () {
        this.timeout(30000);
        const { result, text } = await runUpdate(fakeTool(['2.0.0']));
        assert.strictEqual(result, 'success', text);
        assert.ok(text.includes('FakeTool 1.0.0 → 2.0.0'), text);
    });

    test('an update that changes nothing is NOT shown as a success', async function () {
        this.timeout(30000);
        const { text } = await runUpdate(fakeTool(['1.0.0']));
        // El paso es opcional (no corta el resto), pero tiene que avisar con el motivo y no con un ✔.
        assert.ok(text.includes('(skipped)'), text);
        assert.ok(text.includes('still 1.0.0'), text);
        assert.ok(text.includes('latest release is 2.0.0'), text);
    });

    test('when winget has nothing newer, the reason is explained (and the code is not an error)', async function () {
        this.timeout(30000);
        const { text } = await runUpdate(
            fakeTool(['1.0.0'], { installer: { title: 'Updating FakeTool', command: exitWith(wingetCodes.noUpdate) } }),
        );
        assert.ok(text.includes('is the newest version winget offers'), text);
        assert.ok(!text.includes('Command failed with exit code'), text);
    });

    test('a tool not installed with winget says so', function () {
        const reason = unchangedReason(fakeTool(['1.0.0']), wingetCodes.notInstalled);
        assert.ok(reason.includes('was not installed with winget'), reason);
        // Los códigos de Windows pueden llegar con signo: se normalizan.
        assert.strictEqual(
            unchangedReason(fakeTool(['1.0.0']), wingetCodes.noUpdate | 0).includes('newest version winget offers'),
            true,
        );
    });

    test('the second way is used when the first one leaves the version unchanged', async function () {
        this.timeout(30000);
        let fallbackCalls = 0;
        const target = fakeTool(['1.0.0', '2.0.0'], {
            async fallback() {
                fallbackCalls++;
                return true;
            },
        });
        const { result, text } = await runUpdate(target);
        assert.strictEqual(fallbackCalls, 1);
        assert.strictEqual(result, 'success', text);
        assert.ok(text.includes('FakeTool 1.0.0 → 2.0.0'), text);
    });

    test('already up to date is a success, not a failure', async function () {
        this.timeout(30000);
        const { result, text } = await runUpdate(fakeTool(['1.0.0'], { latest: '1.0.0' }));
        assert.strictEqual(result, 'success', text);
        assert.ok(text.includes('Already the latest version'), text);
    });

    test('a hint is added when the updater cannot help (npm comes with Node.js)', async function () {
        this.timeout(30000);
        const { text } = await runUpdate(
            fakeTool(['1.0.0'], { hint: 'npm comes with Node.js: updating Node.js also updates npm.' }),
        );
        assert.ok(text.includes('updating Node.js also updates npm'), text);
    });

    test('checksums: SHASUMS lines are parsed and files are hashed', function () {
        const hash = 'a'.repeat(64);
        const text = `${hash}  node-v24.0.0-x64.msi\n${'b'.repeat(64)}  node-v24.0.0-arm64.msi\n`;
        assert.strictEqual(parseShaSums(text, 'node-v24.0.0-x64.msi'), hash);
        assert.strictEqual(parseShaSums(text, 'node-v24.0.0-x86.msi'), undefined);
        assert.strictEqual(
            sha256(Buffer.from('abc')),
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });

    test('nodejs.org publishes the checksum of the current LTS installer (needs internet)', async function () {
        this.timeout(30000);
        const response = await fetch('https://nodejs.org/dist/index.json');
        const index = (await response.json()) as Array<{ version: string; lts: string | false }>;
        const lts = index.find(function (r) {
            return r.lts;
        })!.version;
        const sums = await (await fetch(`https://nodejs.org/dist/${lts}/SHASUMS256.txt`)).text();
        assert.match(parseShaSums(sums, `node-${lts}-x64.msi`) ?? '', /^[0-9a-f]{64}$/);
    });

    test('Python is updated through the winget package of the installed minor version', async function () {
        if (process.platform !== 'win32') {
            return;
        }
        const installer = await updaterFor('python', '3.13.15');
        // winget puede no estar instalado en la máquina de pruebas.
        if (installer) {
            assert.ok(installer.command.includes('--id Python.Python.3.13 '), installer.command);
            assert.ok(!installer.command.includes('install'), 'must never reinstall over an existing install');
        }
    });
});
