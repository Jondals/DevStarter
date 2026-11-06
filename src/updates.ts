/**
 * updates.ts
 * ──────────
 * Everything about versions and updates:
 *  - Check whether a version satisfies a range (">=20.19.0", "^22.12.0 || >=24"…), like npm does.
 *  - Query the npm registry for the latest version of a package, or the newest one that
 *    works with the installed Node.js (for when a framework needs a newer Node).
 *  - Know the latest Node.js LTS version.
 *  - Read the versions pinned by the person in the settings (devstarter.scaffolderVersions).
 */
import * as vscode from 'vscode';
import { fetchJson } from './net';

/** A "1.2.3" version as numbers [1, 2, 3]. */
type Version = [number, number, number];

/**
 * Turns a text into a version. Accepts "v1.2.3", "1.2" or "1" (what is missing is 0).
 * @param text version as text
 * @returns the version, or undefined if invalid or a prerelease (1.2.3-beta)
 */
export function parseVersion(text: string): Version | undefined {
    const match = text
        .trim()
        .replace(/^[v=]/, '')
        .match(/^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(-\S+)?$/i);
    if (!match || match[4]) {
        return undefined;
    }
    return [Number(match[1]), Number(match[2]) || 0, Number(match[3]) || 0];
}

/**
 * Compares two versions.
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
function compare(a: Version, b: Version): number {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Bounds of a comparator: minimum and maximum, each included or excluded. */
interface Bounds {
    min?: Version;
    minInclusive: boolean;
    max?: Version;
    maxInclusive: boolean;
}

/**
 * Bounds "from this version (included) up to this other one (excluded)".
 * @param min minimum version
 * @param max first version that no longer fits
 */
function upTo(min: Version, max: Version): Bounds {
    return { min, minInclusive: true, max, maxInclusive: false };
}

/**
 * Turns one comparator of a range into bounds [minimum included, maximum excluded].
 * Examples: "^22.12.0" → [22.12.0, 23.0.0); ">=24" → [24.0.0, ∞); "20.x" → [20.0.0, 21.0.0).
 * @param comparator one piece of the range (no spaces)
 */
function bounds(comparator: string): Bounds | undefined {
    const match = comparator.match(/^(>=|<=|>|<|=|\^|~)?v?(.*)$/);
    if (!match) {
        return undefined;
    }
    const op = match[1] ?? '';
    const raw = match[2];
    if (raw === '*' || raw === '' || raw.toLowerCase() === 'x') {
        return { minInclusive: true, maxInclusive: false };
    }
    const parts = raw.split('.');
    const version = parseVersion(raw);
    if (!version) {
        return undefined;
    }
    // How many parts were really written ("20" → 1, "20.1" → 2, "20.1.0" → 3).
    let given = 0;
    for (const p of parts) {
        if (/^\d+$/.test(p)) {
            given++;
        } else {
            break;
        }
    }
    const [major, minor] = version;
    switch (op) {
        case '>=':
            return { min: version, minInclusive: true, maxInclusive: false };
        case '>':
            return { min: version, minInclusive: false, maxInclusive: false };
        case '<=':
            return { max: version, maxInclusive: true, minInclusive: true };
        case '<':
            return { max: version, maxInclusive: false, minInclusive: true };
        case '^':
            // ^1.2.3 → up to the next major; ^0.2.3 → up to the next minor.
            return upTo(version, major > 0 || given === 1 ? [major + 1, 0, 0] : [0, minor + 1, 0]);
        case '~':
            return upTo(version, given === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0]);
        default:
            // "Partial" version (20 or 20.x) = any 20.*.*; full (20.1.0) = exact.
            if (given === 1) {
                return upTo(version, [major + 1, 0, 0]);
            }
            if (given === 2) {
                return upTo(version, [major, minor + 1, 0]);
            }
            return { min: version, minInclusive: true, max: version, maxInclusive: true };
    }
}

/**
 * Whether the version satisfies the range. Understands the usual npm ranges:
 * "||" (or), spaces (and), ^, ~, >=, >, <=, <, x/* and partial versions.
 * @param version installed version, e.g. "24.14.1"
 * @param range range, e.g. "^22.22.3 || ^24.15.0 || >=26.0.0"
 */
export function satisfies(version: string, range: string | undefined): boolean {
    const v = parseVersion(version);
    if (!v) {
        return false;
    }
    if (!range || !range.trim()) {
        return true;
    }
    for (const alternative of range.split('||')) {
        // Joins "operator space version" (">= 18") and splits the comparators.
        const comparators = alternative
            .trim()
            .replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1')
            .split(/\s+/)
            .filter(Boolean);
        let ok = comparators.length > 0 || alternative.trim() === '';
        for (const c of comparators) {
            const b = bounds(c);
            if (!b) {
                ok = false;
                break;
            }
            if (b.min) {
                const cmp = compare(v, b.min);
                if (cmp < 0 || (cmp === 0 && !b.minInclusive)) {
                    ok = false;
                    break;
                }
            }
            if (b.max) {
                const cmp = compare(v, b.max);
                if (cmp > 0 || (cmp === 0 && !b.maxInclusive)) {
                    ok = false;
                    break;
                }
            }
        }
        if (ok) {
            return true;
        }
    }
    return false;
}

/**
 * Latest published version of an npm package, or undefined when offline.
 * @param pkg package name
 */
export async function latestNpmVersion(pkg: string): Promise<string | undefined> {
    try {
        const data = await fetchJson(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`);
        return typeof data.version === 'string' ? data.version : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The newest version of a package whose "engines.node" field accepts the installed Node.js.
 * Used when the latest version of a framework needs a newer Node.
 * @param pkg package name (e.g. "@angular/cli")
 * @param nodeVersion installed Node.js version
 * @returns the compatible version, or undefined when offline or if none fits
 */
export async function latestCompatibleVersion(pkg: string, nodeVersion: string): Promise<string | undefined> {
    let data: any;
    try {
        // ? Abbreviated registry format: includes "engines" and weighs a fraction of the full document.
        // ? (The abbreviated document is around 2 MB for packages with many versions: 10 MB of headroom.)
        data = await fetchJson(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`, {
            timeoutMs: 30000,
            maxBytes: 10 * 1024 * 1024,
            accept: 'application/vnd.npm.install-v1+json',
        });
    } catch {
        return undefined;
    }
    let best: Version | undefined;
    let bestText: string | undefined;
    for (const text of Object.keys(data.versions ?? {})) {
        const v = parseVersion(text);
        if (!v || data.versions[text].deprecated) {
            continue; // no prereleases or deprecated versions
        }
        if (satisfies(nodeVersion, data.versions[text].engines?.node) && (!best || compare(v, best) > 0)) {
            best = v;
            bestText = text;
        }
    }
    return bestText;
}

/** Latest Node.js LTS version (from nodejs.org), or undefined when offline. */
export async function latestNodeLts(): Promise<string | undefined> {
    try {
        const releases: Array<{ version: string; lts: string | false }> = await fetchJson(
            'https://nodejs.org/dist/index.json',
        );
        for (const release of releases) {
            if (release.lts) {
                return release.version.replace(/^v/, '');
            }
        }
    } catch {
        // offline
    }
    return undefined;
}

/**
 * Whether `latest` is newer than `current`.
 * @param current installed version
 * @param latest latest known version
 */
export function isNewer(current: string | undefined, latest: string | undefined): boolean {
    const a = current ? parseVersion(current) : undefined;
    const b = latest ? parseVersion(latest) : undefined;
    return !!a && !!b && compare(b, a) > 0;
}

/**
 * Version to use for a generator (create-vite, @angular/cli…): "latest" unless the
 * person pinned it in the devstarter.scaffolderVersions setting, e.g. { "@angular/cli": "21" }.
 * It is the emergency exit if a new version of a generator breaks.
 * @param pkg package name
 */
export function scaffolderTag(pkg: string): string {
    try {
        const pinned = vscode.workspace
            .getConfiguration('devstarter')
            .get<Record<string, string>>('scaffolderVersions', {});
        const tag = pinned[pkg];
        // ! The value ends up inside a shell command: only normal versions or tags are accepted
        // ! (21, 21.2.0, ^21, next, latest…). Anything else is ignored.
        return typeof tag === 'string' && /^[\w.^~*-]{1,40}$/.test(tag) ? tag : 'latest';
    } catch {
        return 'latest'; // outside VS Code (test scripts)
    }
}

/**
 * Extracts the Node.js requirements from an error message, e.g.
 * "requires a minimum Node.js version of v22.22.3 or v24.15.0" → "v22.22.3 or v24.15.0".
 * @param output output of the failed command
 */
export function requiredNodeFromOutput(output: string): string | undefined {
    const angular = output.match(/minimum Node\.js version of ([^\n.]+(?:\.\d+)*(?: or v[\d.]+)*)/i);
    if (angular) {
        return angular[1].trim().replace(/\.$/, '');
    }
    const engine = output.match(/wanted: \{"node":"([^"]+)"/);
    return engine?.[1];
}

/** Whether the error says the installed Node.js is too old. */
export function isNodeEngineError(output: string): boolean {
    return /update your Node\.js version|minimum Node\.js version|requires? (a )?Node(\.js)? version|EBADENGINE|Unsupported engine/i.test(
        output,
    );
}
