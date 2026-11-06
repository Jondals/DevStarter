/**
 * toolupdate.ts
 * ─────────────
 * Updates tools (Node.js, Git, Python, pnpm…) and checks that they really got updated.
 *
 * ! The bug it fixes: winget's catalog can lag behind the official website. When an
 * update was requested and winget had nothing new, the step ended "fine" without changing
 * anything. Now every update:
 *   1. runs the updater (winget, brew, the program itself…),
 *   2. reads the installed version again,
 *   3. if it did not change, tries a second route (for Node.js: the official installer),
 *   4. and if it is still the same, explains why instead of showing a fake "✔".
 */
import * as cp from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchBuffer, fetchText } from './net';
import { CommandStep, Logger } from './terminal';
import { clearToolCache, Installer, refreshPath } from './tools';
import { isNewer } from './updates';

/** winget exit codes that mean "nothing to do", not an error. */
export const wingetCodes = {
    /** "No available upgrade found" (0x8A15002B). */
    noUpdate: 0x8a15002b,
    /** "No installed package found" with winget (0x8A150014). */
    notInstalled: 0x8a150014,
};

/** What we need to know to update a tool. */
export interface UpdateTarget {
    /** Name for messages ("Node.js"). */
    name: string;
    /** Version installed now. */
    current: string;
    /** Latest known version (may be newer than what the updater offers). */
    latest?: string;
    installer: Installer;
    /** Reads the installed version again (without cache). */
    detect: () => Promise<string | undefined>;
    /** Second route if the updater does not change the version. Returns true if it tried. */
    fallback?: (log: Logger) => Promise<boolean>;
    /** Extra advice if it could not be updated (e.g. "npm comes with Node.js"). */
    hint?: string;
}

/**
 * Explains why an update did not change the version.
 * @param t tool
 * @param exitCode exit code of the updater
 */
export function unchangedReason(t: UpdateTarget, exitCode: number): string {
    const behind = isNewer(t.current, t.latest)
        ? ` The latest release is ${t.latest}, but it is not available through this updater yet.`
        : '';
    let reason: string;
    if (exitCode >>> 0 === wingetCodes.noUpdate) {
        reason = `${t.name} ${t.current} is the newest version winget offers.${behind}`;
    } else if (exitCode >>> 0 === wingetCodes.notInstalled) {
        reason = `${t.name} was not installed with winget, so winget cannot update it.${behind}`;
    } else {
        reason = `The updater finished but ${t.name} is still ${t.current}.${behind}`;
    }
    return t.hint ? `${reason} ${t.hint}` : reason;
}

/**
 * Creates the step that updates a tool and checks the result.
 * @param t tool to update
 */
export function toolUpdateStep(t: UpdateTarget): CommandStep {
    return {
        kind: 'command',
        title: t.installer.title,
        command: t.installer.command,
        cwd: os.homedir(),
        // * If it cannot be updated, warn and carry on with the rest.
        optional: true,
        okExitCodes: [wingetCodes.noUpdate, wingetCodes.notInstalled, ...(t.installer.okExitCodes ?? [])],
        async verify(log, exitCode) {
            let now = await freshVersion(t);
            if (isNewer(t.current, now)) {
                reportChange(t, now!, log);
                return;
            }
            // No change. Was it already up to date?
            if (!isNewer(t.current, t.latest)) {
                log(`Already the latest version (${t.current})`);
                return;
            }
            // There is a newer version and the updater did not provide it: second route.
            if (t.fallback && (await t.fallback(log))) {
                now = await freshVersion(t);
                if (isNewer(t.current, now)) {
                    reportChange(t, now!, log);
                    return;
                }
            }
            throw new Error(unchangedReason(t, exitCode));
        },
    };
}

/**
 * Reads the installed version again, with an up-to-date PATH and cache.
 * @param t tool
 */
async function freshVersion(t: UpdateTarget): Promise<string | undefined> {
    await refreshPath(true);
    clearToolCache();
    return t.detect();
}

/**
 * Writes "Node.js 24.19.0 → 24.21.0" (and warns if it is still not the latest).
 * @param t tool
 * @param now new version
 * @param log where to write
 */
function reportChange(t: UpdateTarget, now: string, log: Logger): void {
    log(`${t.name} ${t.current} → ${now}`);
    if (isNewer(now, t.latest)) {
        log(`The newest release (${t.latest}) is not available through this updater yet`);
    }
}

// ─── Node.js: official installer ────────────────────────────────────

/**
 * Finds the hash of a file in the text of SHASUMS256.txt.
 * Each line is "<sha256>  <name>".
 * @param text contents of SHASUMS256.txt
 * @param fileName name of the file to look for
 */
export function parseShaSums(text: string, fileName: string): string | undefined {
    for (const line of text.split(/\r?\n/)) {
        const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
        if (match && match[2] === fileName) {
            return match[1].toLowerCase();
        }
    }
    return undefined;
}

/**
 * SHA-256 of some data, in hexadecimal.
 * @param data contents
 */
export function sha256(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/** Architecture with the name nodejs.org uses. */
function nodeArch(): string {
    return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Downloads the official Node.js installer (.msi), checks its SHA-256 against the one published by
 * nodejs.org and runs it. ! Windows will ask for administrator permission.
 * It is the second route when winget does not have the latest version yet.
 * @param version version to install, e.g. "24.21.0"
 * @param log where to write the details
 * @returns true if the installer ran
 */
export async function installNodeFromOfficialMsi(version: string, log: Logger): Promise<boolean> {
    if (process.platform !== 'win32' || !/^\d+\.\d+\.\d+$/.test(version)) {
        return false;
    }
    const base = `https://nodejs.org/dist/v${version}`;
    const file = `node-v${version}-${nodeArch()}.msi`;
    log(`Downloading the official installer (${file})…`);
    const expected = parseShaSums(await fetchText(`${base}/SHASUMS256.txt`, { timeoutMs: 30000 }), file);
    if (!expected) {
        throw new Error(`nodejs.org does not list ${file}`);
    }
    // ! The Node.js installer weighs about 30 MB: accept 100 MB at most.
    const data = await fetchBuffer(`${base}/${file}`, { timeoutMs: 300000, maxBytes: 100 * 1024 * 1024 });
    if (sha256(data) !== expected) {
        throw new Error(
            'The downloaded installer does not match the checksum published by nodejs.org. Nothing was installed.',
        );
    }
    log('Checksum verified. Starting the installer (accept the Windows permission prompt)…');
    const target = path.join(os.tmpdir(), file);
    fs.writeFileSync(target, data);
    try {
        const code = await runInstaller('msiexec', ['/i', target, '/passive', '/norestart']);
        // ? 3010 = installed, but Windows asks to restart at some point.
        if (code !== 0 && code !== 3010) {
            throw new Error(
                code === 1602 || code === 1223
                    ? 'The installation was cancelled.'
                    : `The installer failed (exit code ${code}).`,
            );
        }
    } finally {
        fs.rmSync(target, { force: true });
    }
    return true;
}

/**
 * Runs an installer (without a shell) and waits for it to finish.
 * @param program program
 * @param args arguments
 * @returns the exit code
 */
function runInstaller(program: string, args: string[]): Promise<number> {
    return new Promise(function (resolve, reject) {
        const child = cp.spawn(program, args, { windowsHide: false, stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', function (code) {
            resolve(code ?? 1);
        });
    });
}
