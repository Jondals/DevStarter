/**
 * templates/types.ts
 * ──────────────────
 * Types shared by every template (what a template is, what it receives
 * and what it returns) and small helpers to build terminal steps.
 */
import * as fs from 'fs';
import { CommandStep, Logger, Step } from '../terminal';
import { scaffolderTag } from '../updates';
import { PackageManager, ToolId } from '../tools';
import { Database } from '../scaffold/database';
import { CiKind } from '../scaffold/extras';

export type Category = 'Frontend' | 'Full-stack' | 'Backend' | 'Mobile' | 'Other';

/** Everything a template needs to know to create its part of the project. */
export interface PartOptions {
    /** Project name exactly as the person typed it. */
    name: string;
    /** Name for package.json, Cargo.toml… (full-stack: "name-backend"). */
    packageName: string;
    /** Folder where the part is created. */
    parentDir: string;
    /** Name of the part's folder (the project name, or "frontend" / "backend"). */
    folder: string;
    /** Full path: parentDir/folder. */
    dir: string;
    typescript: boolean;
    tailwind: boolean;
    database?: Database;
    pm: PackageManager;
    /** System Python command (python / py / python3). */
    python?: string;
    beginner: boolean;
    /** For a frontend with a backend: backend URL to forward /api to. */
    backendUrl?: string;
    /** Generate a Dockerfile (backends only). */
    dockerfile: boolean;
    /** Ids of the libraries chosen for this part. */
    libraries: string[];
}

/** What a template returns: the steps to run and how to start it afterwards. */
export interface Plan {
    steps: Step[];
    /** Command that starts the dev server, if there is one. */
    server?: { command: string; url?: string };
    /** Main file to open (relative to the part); the first one that exists wins. */
    mainFiles: string[];
    /** Tips that end up in GETTING_STARTED.md. */
    notes: string[];
}

/** A project template. */
export interface Template {
    id: string;
    label: string;
    /** VS Code icon (codicon) for the picker. */
    icon: string;
    category: Category;
    /** Short text next to the name. */
    description: string;
    /** Explanation for beginners. */
    detail: string;
    recommended?: boolean;
    /** Offers a choice between TypeScript and JavaScript. */
    languages?: boolean;
    tailwind?: boolean;
    /** Databases it knows how to integrate. */
    databases?: Database[];
    /** For a backend that can be added to a frontend: the port it listens on. */
    port?: number;
    /** Frontends and mobile apps that can get a backend. */
    acceptsBackend?: boolean;
    /** Can generate a Dockerfile. */
    docker?: boolean;
    /** Kind of project for GitHub Actions. */
    ci?: CiKind;
    /** Uses npm / pnpm / bun. */
    node: boolean;
    requires: ToolId[];
    nameStyle: 'kebab' | 'snake';
    docs: string;
    /** Recommended VS Code extensions for this stack. */
    vscode: string[];
    /** Builds the steps that create this part of the project. */
    plan(o: PartOptions): Plan;
}

export const isWindows = process.platform === 'win32';

/** Python inside the project's virtual environment (path relative to the project folder). */
export function venvPython(): string {
    return isWindows ? '.venv\\Scripts\\python' : '.venv/bin/python';
}

/**
 * pip install command with every package quoted (because of the brackets in "psycopg[binary]").
 * @param packages packages to install
 */
export function pipInstall(packages: string[]): string {
    const quoted: string[] = [];
    for (const p of packages) {
        quoted.push(`"${p}"`);
    }
    return `${venvPython()} -m pip install ${quoted.join(' ')}`;
}

/**
 * Creates a step that runs a command.
 * @param title text shown
 * @param command shell command
 * @param cwd folder it runs in
 * @param optional if it fails, only warn
 */
export function cmd(title: string, command: string, cwd: string, optional = false): Step {
    return { kind: 'command', title, command, cwd, optional };
}

/**
 * Creates a step that runs extension code.
 * @param title text shown
 * @param run function to run (gets `log` to report what it does)
 * @param optional if it fails, only warn
 */
export function task(title: string, run: (log: Logger) => void | Promise<void>, optional = false): Step {
    return { kind: 'task', title, run, optional };
}

/**
 * Step that creates the project folder.
 * @param dir folder to create
 */
export function makeDir(dir: string): Step {
    return task('Creating project folder', function () {
        fs.mkdirSync(dir, { recursive: true });
    });
}

/**
 * Step that runs a project generator published on npm (create-vite, @angular/cli…).
 * Uses the version pinned in the settings (or "latest") and remembers how to repeat the command
 * with another version, so it can be retried with a compatible one if the latest needs a newer Node.
 * @param o project options (for the package manager)
 * @param title text shown
 * @param pkg npm package of the generator
 * @param args generator arguments
 * @param cwd folder it runs in
 */
export function scaffold(o: PartOptions, title: string, pkg: string, args: string[], cwd: string): CommandStep {
    /** Full command with a specific generator version, plus the pnpm fix. */
    function withVersion(version: string): string {
        return o.pm.exec(`${pkg}@${version}`, args) + pinPnpmCommand(o);
    }
    return {
        kind: 'command',
        title,
        command: withVersion(scaffolderTag(pkg)),
        cwd,
        compat: { package: pkg, command: withVersion },
    };
}

/**
 * ! Some generators (Angular, Nuxt…) write a "packageManager": "pnpm@<latest version>" field
 * into package.json. If it does not match the installed pnpm, pnpm tries to download and
 * switch to that version every time it is used in the folder, and on Windows that fails
 * ("The system cannot find the path specified").
 * Returns a command (to chain with &&) that pins the field to the installed pnpm.
 * @param o project options
 * @returns "" if not needed (another package manager, or unknown version)
 */
export function pinPnpmCommand(o: PartOptions): string {
    if (o.pm.id !== 'pnpm' || !o.pm.version || !/^\d+\.\d+\.\d+$/.test(o.pm.version)) {
        return '';
    }
    // ? One-line Node script (no double quotes: the command itself is wrapped in double quotes).
    const script =
        "const fs=require('fs'),path=require('path');" +
        "const f=path.join(process.cwd(),process.argv[1],'package.json');" +
        'try{' +
        "const j=JSON.parse(fs.readFileSync(f,'utf8'));" +
        "if(/^pnpm@/.test(j.packageManager||'')){" +
        `j.packageManager='pnpm@${o.pm.version}';` +
        'fs.writeFileSync(f,JSON.stringify(j,null,2)+String.fromCharCode(10))}' +
        '}catch(e){}';
    return ` && node -e "${script}" "${o.folder}"`;
}
