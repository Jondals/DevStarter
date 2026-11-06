/**
 * scaffold/files.ts
 * ─────────────────
 * Small helpers to create and change files of the generated projects:
 * write with folders, edit JSON and .env, complete .gitignore and tweak pnpm.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Writes a file, creating any missing folders.
 * Removes the leading line break left by templates written with `...`.
 * @param file full path of the file
 * @param content contents
 */
export function write(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.replace(/^\n/, ''));
}

/**
 * Returns the path of the first candidate that exists inside `dir`.
 * @param dir folder to look in
 * @param candidates file names, in order of preference
 */
export function firstExisting(dir: string, candidates: string[]): string | undefined {
    for (const candidate of candidates) {
        const file = path.join(dir, candidate);
        if (fs.existsSync(file)) {
            return file;
        }
    }
    return undefined;
}

/**
 * Reads a JSON file, lets `change` modify it and saves it again.
 * @param file path of the JSON file (if it does not exist, starts with {})
 * @param change function that modifies the object
 */
export function patchJson(file: string, change: (json: Record<string, any>) => void): void {
    const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    change(json);
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

/**
 * Changes (or adds) `KEY=value` in the contents of a .env, even if the line is commented out.
 * @param content current contents of the .env
 * @param key variable name
 * @param value new value
 */
export function setEnvValue(content: string, key: string, value: string): string {
    const pattern = new RegExp(`^#?\\s*${key}=.*$`, 'm');
    if (pattern.test(content)) {
        return content.replace(pattern, `${key}=${value}`);
    }
    return content.replace(/\n?$/, `\n${key}=${value}\n`);
}

/**
 * Applies several values to a .env file if it exists.
 * @param file path of the .env
 * @param values variables to change
 */
export function updateEnvFile(file: string, values: Record<string, string>): void {
    if (!fs.existsSync(file)) {
        return;
    }
    let content = fs.readFileSync(file, 'utf8');
    for (const key of Object.keys(values)) {
        content = setEnvValue(content, key, values[key]);
    }
    fs.writeFileSync(file, content);
}

/**
 * Appends lines to a text file, making sure the previous line ends with a line break.
 * @param file file to extend (created if it does not exist)
 * @param text text to append
 */
export function appendLines(file: string, text: string): void {
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const separator = content && !content.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${content}${separator}${text.endsWith('\n') ? text : text + '\n'}`);
}

/**
 * ! pnpm 10+ does not run the dependencies' install scripts unless they are approved.
 * Some native packages (like better-sqlite3) need them to work.
 * @param dir project folder
 * @param pkg package to approve
 */
export function allowPnpmBuild(dir: string, pkg: string): void {
    const file = path.join(dir, 'pnpm-workspace.yaml');
    let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    // Removes a previous entry of the same package (e.g. "set this to true or false").
    content = content.replace(new RegExp(`^\\s+${pkg}:.*\\n?`, 'm'), '');
    if (/^allowBuilds:/m.test(content)) {
        content = content.replace(/^allowBuilds:.*$/m, `allowBuilds:\n  ${pkg}: true`);
    } else {
        content = `${content.trimEnd()}${content.trim() ? '\n' : ''}allowBuilds:\n  ${pkg}: true\n`;
    }
    fs.writeFileSync(file, content);
}

/**
 * ! pnpm 11 checks the dependencies again on every "pnpm dev" and fails if any of them
 * brings unapproved build scripts (esbuild, sharp…). With this it only warns.
 * It also stops pnpm from looking for a workspace in parent folders.
 * @param dir project folder
 */
export function relaxPnpmBuilds(dir: string): void {
    const file = path.join(dir, 'pnpm-workspace.yaml');
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!/^strictDepBuilds:/m.test(content)) {
        appendLines(file, 'strictDepBuilds: false');
    }
}

/**
 * Normalizes a .gitignore entry: "node_modules" is the same as "/node_modules/".
 * @param entry .gitignore line
 */
function normalizeIgnore(entry: string): string {
    return entry.trim().replace(/^\/|\/$/g, '');
}

/**
 * Makes sure .gitignore contains the given entries.
 * ! Some generators (e.g. Nest with --skip-git) do not create it, and without it
 * the first commit would include the whole node_modules.
 * @param dir folder with the .gitignore
 * @param entries entries that must be there
 */
export function ensureGitignore(dir: string, entries: string[]): void {
    const file = path.join(dir, '.gitignore');
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const present = new Set(content.split(/\r?\n/).map(normalizeIgnore));
    const missing: string[] = [];
    for (const entry of entries) {
        if (!present.has(normalizeIgnore(entry))) {
            missing.push(entry);
        }
    }
    if (missing.length) {
        appendLines(file, missing.join('\n'));
    }
}

/**
 * "my-app" → "my_app" (valid as a database name or a Python/Dart package name).
 * @param name project name
 */
export function snakeCase(name: string): string {
    const result = name
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return result || 'app';
}
