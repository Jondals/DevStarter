/**
 * test/toolupdate.test.ts
 * ───────────────────────
 * Tests of the tool updates (Node.js, pnpm…): an update only counts as good if the version
 * really changed, and the reason is explained when it does not.
 * They use "fake" tools (Node commands that imitate winget, npm…), touching nothing on the computer.
 */
import * as assert from 'assert';
import { DevStarterTerminal } from '../terminal';
import { updaterFor } from '../tools';
import { parseShaSums, sha256, toolUpdateStep, UpdateTarget, unchangedReason, wingetCodes } from '../toolupdate';
import { captureTerminal, restoreWindow } from './helpers';

/** Shell command that exits with the given code (works on any system). */
function exitWith(code: number): string {
    return `node -e "process.exit(${code})"`;
}

/**
 * Creates a fake tool: the "installed version" changes following the `versions` list
 * (each read returns the next one; the last one repeats).
 * @param versions versions `detect` will return, in order
 * @param overrides any other tool data
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
 * Runs the update step in a test terminal.
 * @param target fake tool
 * @returns the result and everything that was written
 */
async function runUpdate(target: UpdateTarget): Promise<{ result: string; text: string }> {
    const output = captureTerminal();
    const term = await DevStarterTerminal.create('update test', { verbose: false, beginner: false });
    const result = await term.runSteps([toolUpdateStep(target)]);
    return { result, text: output() };
}

suite('DevStarter · tool updates', function () {
    // captureTerminal replaces createTerminal: it is restored after each test.
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
        // ! The step is optional (it does not stop the rest), but it must warn with the reason, not a ✔.
        assert.ok(text.includes('(skipped)'), text);
        assert.ok(text.includes('still 1.0.0'), text);
        assert.ok(text.includes('latest release is 2.0.0'), text);
    });

    test('when winget has nothing newer, the reason is explained (and the code is not an error)', async function () {
        // ! winget only exists on Windows, and other systems cut exit codes to 0-255 (2316632107 -> 43).
        if (process.platform !== 'win32') {
            this.skip();
        }
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
        // Windows codes may arrive signed: they are normalized.
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
        // winget may not be installed on the test machine.
        if (installer) {
            assert.ok(installer.command.includes('--id Python.Python.3.13 '), installer.command);
            assert.ok(!installer.command.includes('install'), 'must never reinstall over an existing install');
        }
    });
});
