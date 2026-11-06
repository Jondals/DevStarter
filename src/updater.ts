/**
 * updater.ts
 * ──────────
 * "Update Project" command: updates the libraries of an existing project.
 *
 *  1. Finds the parts of the project (the root and subfolders like frontend/ and backend/):
 *     Node (npm, pnpm or bun depending on the lockfile), Python (.venv), Composer, Cargo, Go and Flutter.
 *  2. Two modes:
 *       - safe:   only minor and patch versions (should not break anything).
 *       - latest: major versions too (may need code changes).
 *  3. Optionally makes a safety commit first and checks that it still builds afterwards.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, Step } from './terminal';
import { packageManager, PackageManagerId } from './tools';

export type UpdateMode = 'safe' | 'latest';

/** Kinds of project we know how to update. */
export type PartKind = 'node' | 'python' | 'composer' | 'cargo' | 'go' | 'flutter';

/** A part of the project (a folder with its dependency manager). */
export interface ProjectPart {
    dir: string;
    /** Folder relative to the root ('.' for the root itself). */
    label: string;
    kind: PartKind;
    /** Package manager (Node only). */
    pm?: PackageManagerId;
    /** Framework with an official update tool (Node only). */
    framework?: Framework;
}

/** Frameworks that are updated with their own official tool. */
export type Framework = 'angular' | 'expo' | 'next' | 'nuxt' | 'astro';

/**
 * Framework of a Node project according to its dependencies.
 * @param dir project folder
 */
export function detectFramework(dir: string): Framework | undefined {
    let deps: Record<string, string> = {};
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        deps = { ...pkg.devDependencies, ...pkg.dependencies };
    } catch {
        return undefined;
    }
    if (deps['@angular/core']) {
        return 'angular';
    }
    if (deps['expo']) {
        return 'expo';
    }
    if (deps['next']) {
        return 'next';
    }
    if (deps['nuxt']) {
        return 'nuxt';
    }
    if (deps['astro']) {
        return 'astro';
    }
    return undefined;
}

/**
 * Framework packages the generic update must NOT touch (their own tool handles them).
 * ? With wildcards (@expo/*): npm-check-updates does not handle expressions with slashes well.
 */
const frameworkPackages: Record<Framework, string> = {
    angular: '@angular/*,@angular-devkit/*,typescript,zone.js,rxjs',
    expo: 'expo,expo-*,react,react-dom,react-native,react-native-*,@react-native/*,@expo/*,typescript,@types/react',
    next: 'next,react,react-dom,eslint-config-next,@types/react,@types/react-dom',
    nuxt: 'nuxt,vue,vue-router',
    astro: 'astro,@astrojs/*',
};

/** Folders that must never be walked. */
const ignoredDirs = new Set([
    'node_modules',
    '.venv',
    'venv',
    '.git',
    'dist',
    'build',
    'vendor',
    'target',
    '.next',
    '.nuxt',
    '.output',
    '.svelte-kit',
    'bin',
    'obj',
]);

/**
 * Package manager of a Node project according to its lockfile.
 * @param dir project folder
 */
function detectPm(dir: string): PackageManagerId {
    if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) {
        return 'bun';
    }
    return 'npm';
}

/**
 * Which kind of project a folder holds (there may be several, e.g. Laravel = Composer + Node).
 * @param dir folder to look at
 */
function kindsIn(dir: string): PartKind[] {
    const kinds: PartKind[] = [];
    const has = function (file: string): boolean {
        return fs.existsSync(path.join(dir, file));
    };
    if (has('package.json')) {
        kinds.push('node');
    }
    if (has('.venv') && (has('requirements.txt') || has('pyproject.toml'))) {
        kinds.push('python');
    }
    if (has('composer.json')) {
        kinds.push('composer');
    }
    if (has('Cargo.toml')) {
        kinds.push('cargo');
    }
    if (has('go.mod')) {
        kinds.push('go');
    }
    if (has('pubspec.yaml')) {
        kinds.push('flutter');
    }
    return kinds;
}

/**
 * Finds the parts of the project at the root and up to two levels of subfolders.
 * @param root project folder
 */
export function detectParts(root: string): ProjectPart[] {
    const parts: ProjectPart[] = [];

    /** Looks at a folder and, if it is not too deep, at its subfolders. */
    function visit(dir: string, depth: number): void {
        for (const kind of kindsIn(dir)) {
            const label = path.relative(root, dir) || '.';
            parts.push({
                dir,
                label,
                kind,
                pm: kind === 'node' ? detectPm(dir) : undefined,
                framework: kind === 'node' ? detectFramework(dir) : undefined,
            });
        }
        if (depth >= 2) {
            return;
        }
        let entries: fs.Dirent[] = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && !ignoredDirs.has(entry.name) && !entry.name.startsWith('.')) {
                visit(path.join(dir, entry.name), depth + 1);
            }
        }
    }

    visit(root, 0);
    return parts;
}

/** Readable name of each kind of project. */
export const kindNames: Record<PartKind, string> = {
    node: 'JavaScript',
    python: 'Python',
    composer: 'PHP (Composer)',
    cargo: 'Rust (Cargo)',
    go: 'Go',
    flutter: 'Flutter',
};

/**
 * Runs a command and returns its output (for steps that need to read the result).
 * @param command shell command
 * @param cwd folder it runs in
 */
function run(command: string, cwd: string): Promise<string> {
    return new Promise(function (resolve, reject) {
        const options = {
            cwd,
            windowsHide: true,
            maxBuffer: 20 * 1024 * 1024,
            env: { ...process.env, npm_config_yes: 'true' },
        };
        cp.exec(command, options, function (err, stdout, stderr) {
            if (err) {
                reject(new Error((stderr || stdout || err.message).trim().split(/\r?\n/).slice(-5).join('\n')));
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * Summarizes a list of changes in one line, e.g. "react ^18.2.0 → ^19.1.0, vite …".
 * @param changes name → new version
 * @param max how many to show at most
 */
function summarize(changes: Array<[string, string]>, max = 6): string {
    const shown: string[] = [];
    for (const [name, version] of changes.slice(0, max)) {
        shown.push(`${name} → ${version}`);
    }
    return shown.join(', ') + (changes.length > max ? ` and ${changes.length - max} more` : '');
}

/**
 * Steps for a Node project: see what can be updated, update package.json
 * with npm-check-updates and install.
 * @param part part of the project
 * @param mode safe or latest
 */
function nodeSteps(part: ProjectPart, mode: UpdateMode): Step[] {
    const pm = packageManager(part.pm ?? 'npm');
    const fw = part.framework;
    // "minor" = compatible versions only; "latest" = majors too.
    const target = mode === 'safe' ? 'minor' : 'latest';
    // ! The framework and what is tied to it are updated by its official tool, not ncu.
    // ! Angular and Expo always (their versions are tied); the rest only on a major upgrade.
    const guarded = fw === 'angular' || fw === 'expo' || (fw && mode === 'latest');
    const reject = fw && guarded ? ` --reject "${frameworkPackages[fw]}"` : '';
    const ncu = `npx -y npm-check-updates@latest --target ${target}${reject}`;
    const steps: Step[] = [
        {
            kind: 'task',
            title: `Checking ${part.label} for updates`,
            async run(log: Logger) {
                const json = await run(`${ncu} --jsonUpgraded`, part.dir);
                // ? ncu may print warnings before the JSON; no braces means nothing to update.
                const start = json.indexOf('{');
                const upgraded: Record<string, string> = JSON.parse(start >= 0 ? json.slice(start) : '{}');
                const changes = Object.entries(upgraded);
                log(
                    changes.length
                        ? `${changes.length} to update: ${summarize(changes)}`
                        : 'Everything is already up to date',
                );
            },
        },
        { kind: 'command', title: `Updating package.json in ${part.label}`, command: `${ncu} -u`, cwd: part.dir },
        {
            kind: 'command',
            title: `Installing updated packages in ${part.label}`,
            command: pm.install(),
            cwd: part.dir,
        },
    ];
    if (fw) {
        steps.push(...frameworkSteps(part, fw, mode));
    }
    return steps;
}

/**
 * Steps that update the framework with its official tool (the one that also migrates the code).
 * @param part part of the project
 * @param fw detected framework
 * @param mode safe or latest
 */
function frameworkSteps(part: ProjectPart, fw: Framework, mode: UpdateMode): Step[] {
    const pm = packageManager(part.pm ?? 'npm');
    const latest = mode === 'latest';
    /** Framework command step (if it fails, warn and go on: everything else is already updated). */
    function step(title: string, command: string): Step {
        return { kind: 'command', title: `${title} in ${part.label}`, command, cwd: part.dir, optional: true };
    }
    switch (fw) {
        case 'angular':
            // ? ng update raises one major version at a time and changes the code if needed.
            return [
                step(
                    latest ? 'Migrating Angular to the next major (ng update)' : 'Updating Angular within its version',
                    pm.bin('ng', ['update', '@angular/core', '@angular/cli', '--allow-dirty', '--force']),
                ),
            ];
        case 'expo':
            return [
                ...(latest ? [step('Updating Expo SDK', pm.bin('expo', ['install', 'expo@latest']))] : []),
                // * Puts each library on the version the Expo SDK expects.
                step('Aligning packages with the Expo SDK', pm.bin('expo', ['install', '--fix'])),
            ];
        case 'next':
            return latest
                ? [step('Upgrading Next.js (official codemod)', pm.exec('@next/codemod@canary', ['upgrade', 'latest']))]
                : [];
        case 'nuxt':
            return latest ? [step('Upgrading Nuxt (nuxt upgrade)', pm.bin('nuxt', ['upgrade']))] : [];
        case 'astro':
            return latest ? [step('Upgrading Astro (official upgrader)', pm.exec('@astrojs/upgrade', ['--yes']))] : [];
    }
}

/**
 * Python of a folder's virtual environment.
 * @param dir project folder
 */
function venvPythonIn(dir: string): string {
    return process.platform === 'win32'
        ? path.join(dir, '.venv', 'Scripts', 'python.exe')
        : path.join(dir, '.venv', 'bin', 'python');
}

/**
 * Step for a Python project: updates the outdated packages of the .venv
 * (in safe mode, only if the major version does not change) and regenerates requirements.txt.
 * @param part part of the project
 * @param mode safe or latest
 */
function pythonSteps(part: ProjectPart, mode: UpdateMode): Step[] {
    const python = `"${venvPythonIn(part.dir)}"`;
    return [
        {
            kind: 'task',
            title: `Updating Python packages in ${part.label}`,
            async run(log: Logger) {
                const outdated: Array<{ name: string; version: string; latest_version: string }> = JSON.parse(
                    (await run(
                        `${python} -m pip list --outdated --format=json --disable-pip-version-check`,
                        part.dir,
                    )) || '[]',
                );
                const chosen: Array<[string, string]> = [];
                for (const pkg of outdated) {
                    const sameMajor = pkg.version.split('.')[0] === pkg.latest_version.split('.')[0];
                    if (pkg.name !== 'pip' && (mode === 'latest' || sameMajor)) {
                        chosen.push([pkg.name, pkg.latest_version]);
                    }
                }
                if (!chosen.length) {
                    log('Everything is already up to date');
                    return;
                }
                const names: string[] = [];
                for (const [name] of chosen) {
                    names.push(`"${name}"`);
                }
                await run(
                    `${python} -m pip install --upgrade --disable-pip-version-check ${names.join(' ')}`,
                    part.dir,
                );
                log(`${chosen.length} updated: ${summarize(chosen)}`);
                if (fs.existsSync(path.join(part.dir, 'requirements.txt'))) {
                    fs.writeFileSync(
                        path.join(part.dir, 'requirements.txt'),
                        await run(`${python} -m pip freeze`, part.dir),
                    );
                    log('requirements.txt updated');
                }
            },
        },
    ];
}

/**
 * Update steps of one part of the project.
 * @param part part of the project
 * @param mode safe or latest
 */
function partSteps(part: ProjectPart, mode: UpdateMode): Step[] {
    /** Step that runs a command in the part's folder. */
    function command(title: string, cmd: string): Step {
        return { kind: 'command', title: `${title} in ${part.label}`, command: cmd, cwd: part.dir };
    }
    switch (part.kind) {
        case 'node':
            return nodeSteps(part, mode);
        case 'python':
            return pythonSteps(part, mode);
        case 'composer':
            // ? Composer respects the composer.json constraints (^): it is already a safe update.
            return [command('Updating PHP packages', 'composer update --no-interaction')];
        case 'cargo':
            return [command('Updating Rust crates', 'cargo update')];
        case 'go':
            return [
                command('Updating Go modules', mode === 'safe' ? 'go get -u=patch ./...' : 'go get -u ./...'),
                command('Tidying go.mod', 'go mod tidy'),
            ];
        case 'flutter':
            return [
                command(
                    'Updating Flutter packages',
                    mode === 'safe' ? 'flutter pub upgrade' : 'flutter pub upgrade --major-versions',
                ),
            ];
    }
}

/**
 * Whether package.json has this script.
 * @param dir project folder
 * @param script script name
 */
function hasScript(dir: string, script: string): boolean {
    try {
        return !!JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts?.[script];
    } catch {
        return false;
    }
}

/** Options of the Update Project command. */
export interface UpdateOptions {
    root: string;
    mode: UpdateMode;
    /** Make a safety commit before updating. */
    checkpoint: boolean;
    /** Check afterwards that the project still builds. */
    verify: boolean;
}

/**
 * Every step of the update.
 * @param parts parts of the project to update
 * @param opts mode and options
 */
export function updateSteps(parts: ProjectPart[], opts: UpdateOptions): Step[] {
    const steps: Step[] = [];
    if (opts.checkpoint) {
        steps.push({
            kind: 'command',
            title: 'Saving a Git checkpoint',
            // ? With no pending changes, the last commit already is the restore point.
            command:
                'git add -A && git commit -q -m "Checkpoint before updating dependencies" || echo nothing to commit',
            cwd: opts.root,
            optional: true,
        });
    }
    for (const part of parts) {
        steps.push(...partSteps(part, opts.mode));
    }
    if (opts.verify) {
        for (const part of parts) {
            if (part.kind === 'node' && hasScript(part.dir, 'build')) {
                const pm = packageManager(part.pm ?? 'npm');
                steps.push({
                    kind: 'command',
                    title: `Checking that ${part.label} still builds`,
                    command: pm.run('build'),
                    cwd: part.dir,
                    optional: true,
                });
            }
            if (part.kind === 'python') {
                steps.push({
                    kind: 'command',
                    title: `Checking that ${part.label} still compiles`,
                    command: `"${venvPythonIn(part.dir)}" -m compileall -q -x .venv .`,
                    cwd: part.dir,
                    optional: true,
                });
            }
        }
    }
    return steps;
}
