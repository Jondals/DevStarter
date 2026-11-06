/**
 * tools.ts
 * ────────
 * Everything about the programs installed on the computer:
 *  - Detect whether Node.js, Python, PHP, Git… are there and which version they have.
 *  - Refresh the PATH on the fly after installing something (without restarting VS Code).
 *  - Know how to install each tool (winget on Windows, Homebrew on macOS, php.new…).
 *  - Build the commands of each package manager (npm, pnpm or bun).
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Tools DevStarter knows how to detect and install. */
export type ToolId =
    'node' | 'git' | 'gh' | 'python' | 'php' | 'composer' | 'flutter' | 'go' | 'dotnet' | 'cargo' | 'java';

/** Result of detecting a tool. */
export interface ToolInfo {
    id: ToolId;
    name: string;
    installUrl: string;
    /** Command used to run it (e.g. `py` instead of `python` on some Windows machines). */
    command?: string;
    /** Installed version; undefined if not installed. */
    version?: string;
}

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const home = os.homedir();

/** Fixed data of each tool: name, download page and commands to try. */
interface ToolMeta {
    name: string;
    installUrl: string;
    candidates: string[];
}

const toolMeta: Record<ToolId, ToolMeta> = {
    node: { name: 'Node.js', installUrl: 'https://nodejs.org/en/download', candidates: ['node'] },
    git: { name: 'Git', installUrl: 'https://git-scm.com/downloads', candidates: ['git'] },
    gh: { name: 'GitHub CLI', installUrl: 'https://cli.github.com', candidates: ['gh'] },
    python: {
        name: 'Python',
        installUrl: 'https://www.python.org/downloads/',
        candidates: isWindows ? ['python', 'py', 'python3'] : ['python3', 'python'],
    },
    php: { name: 'PHP', installUrl: 'https://php.new', candidates: ['php'] },
    composer: { name: 'Composer', installUrl: 'https://php.new', candidates: ['composer'] },
    flutter: { name: 'Flutter', installUrl: 'https://docs.flutter.dev/get-started/install', candidates: ['flutter'] },
    go: { name: 'Go', installUrl: 'https://go.dev/dl/', candidates: ['go'] },
    dotnet: { name: '.NET SDK', installUrl: 'https://dotnet.microsoft.com/download', candidates: ['dotnet'] },
    cargo: { name: 'Rust', installUrl: 'https://rustup.rs', candidates: ['cargo'] },
    java: { name: 'Java (JDK)', installUrl: 'https://adoptium.net', candidates: ['java'] },
};

/** Every tool, in display order. */
export const allToolIds = Object.keys(toolMeta) as ToolId[];

/** Minimum Node.js version required by current Vite, Next.js and Astro. */
export const minNodeVersion = '20.19.0';

/**
 * Command that asks a program for its version. Go does not understand `--version`.
 * @param command program name
 */
function versionCommand(command: string): string {
    return command === 'go' ? 'go version' : `${command} --version`;
}

/**
 * Runs `<command> --version` and returns the first line, or undefined if it fails.
 * @param command program to try
 * @param timeout milliseconds before giving up
 */
function readVersion(command: string, timeout = 20000): Promise<string | undefined> {
    return new Promise(function (resolve) {
        // ! From the home folder, not the open project: pnpm (and others) switch versions
        // ! according to the project's "packageManager" field and would report a version that is not the installed one.
        const options = { timeout, windowsHide: true, env: process.env, cwd: home };
        cp.exec(versionCommand(command), options, function (err, stdout, stderr) {
            const text = (stdout || stderr || '').trim();
            resolve(err || !text ? undefined : text.split(/\r?\n/)[0].trim());
        });
    });
}

/**
 * Extracts "1.2.3" from texts like "v1.2.3" or "Python 3.12.1".
 * @param text output of `--version`
 */
function extractVersion(text: string): string {
    return text.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? text;
}

/** Detection cache, so the same processes are not launched several times. */
const cache = new Map<ToolId, Promise<ToolInfo>>();

/**
 * Tries the possible commands of a tool until one works.
 * @param id tool to detect
 */
async function probeTool(id: ToolId): Promise<ToolInfo> {
    const meta = toolMeta[id];
    for (const candidate of meta.candidates) {
        // ? Flutter can take quite a while the first time it runs.
        const raw = await readVersion(candidate, id === 'flutter' ? 60000 : 20000);
        if (raw) {
            return {
                id,
                name: meta.name,
                installUrl: meta.installUrl,
                command: candidate,
                version: extractVersion(raw),
            };
        }
    }
    return { id, name: meta.name, installUrl: meta.installUrl };
}

/**
 * Detects a tool (cached).
 * @param id tool to detect
 */
export function detectTool(id: ToolId): Promise<ToolInfo> {
    let pending = cache.get(id);
    if (!pending) {
        pending = probeTool(id);
        cache.set(id, pending);
    }
    return pending;
}

/** Detects every tool at once (for the "Check My Tools" command). */
export function detectAllTools(): Promise<ToolInfo[]> {
    return Promise.all(allToolIds.map(detectTool));
}

/**
 * Readable name of a tool.
 * @param id tool
 */
export function toolName(id: ToolId): string {
    return toolMeta[id].name;
}

/** Forgets what was detected, e.g. after installing something. */
export function clearToolCache(): void {
    cache.clear();
    pmCache = undefined;
}

/**
 * Compares "a.b.c" versions.
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

// ─── PATH ───────────────────────────────────────────────────────────
//
// * When something is installed, the installer adds its folder to the system PATH,
// * but VS Code (and this extension) keep the old PATH until they restart.
// * These functions refresh it on the fly so the tool can be used right away.

/** Folders where tools usually end up even if VS Code cannot see them yet. */
function knownToolDirs(): string[] {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const dirs = isWindows
        ? [
              'C:\\Program Files\\nodejs',
              path.join(roaming, 'npm'),
              path.join(local, 'pnpm'),
              path.join(home, '.bun', 'bin'),
              path.join(home, '.config', 'herd-lite', 'bin'),
              path.join(home, '.cargo', 'bin'),
              'C:\\Program Files\\Go\\bin',
              'C:\\Program Files\\dotnet',
              'C:\\Program Files\\Git\\cmd',
              'C:\\Program Files\\GitHub CLI',
          ]
        : [
              '/opt/homebrew/bin',
              '/usr/local/bin',
              path.join(home, '.bun', 'bin'),
              path.join(home, '.local', 'share', 'pnpm'),
              path.join(home, 'Library', 'pnpm'),
              path.join(home, '.config', 'herd-lite', 'bin'),
              path.join(home, '.cargo', 'bin'),
              '/usr/local/go/bin',
              path.join(home, '.dotnet'),
          ];
    return dirs.filter(fs.existsSync);
}

/**
 * Adds folders to the process PATH, skipping those already there.
 * @param extra folders to add
 */
function mergePath(extra: string[]): void {
    const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const seen = new Set(current.map(toLower));
    for (const dir of extra) {
        if (dir && !seen.has(dir.toLowerCase())) {
            seen.add(dir.toLowerCase());
            current.push(dir);
        }
    }
    process.env.PATH = current.join(path.delimiter);
}

/** Lowercases a text (to compare paths case-insensitively). */
function toLower(s: string): string {
    return s.toLowerCase();
}

/** Reads the current Windows PATH from the registry (system + user). */
function readWindowsPath(): Promise<string> {
    const script =
        "[Environment]::GetEnvironmentVariable('Path','Machine'); [Environment]::GetEnvironmentVariable('Path','User')";
    return new Promise(function (resolve) {
        cp.exec(
            `powershell -NoProfile -Command "${script}"`,
            { windowsHide: true, timeout: 15000 },
            function (_err, stdout) {
                resolve(stdout ?? '');
            },
        );
    });
}

/** PATH VS Code had at startup (to know which folders were added later). */
const startupPath = (process.env.PATH ?? '').split(path.delimiter);

/**
 * Folders refreshPath() added to the PATH (tools installed while VS Code was open).
 * They are also handed to new terminals.
 */
export function addedPathDirs(): string[] {
    const before = new Set(startupPath.map(toLower));
    const added: string[] = [];
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (dir && !before.has(dir.toLowerCase()) && fs.existsSync(dir)) {
            added.push(dir);
        }
    }
    return added;
}

/** When the PATH was last read (to avoid re-reading it needlessly). */
let lastPathRefresh = 0;

/**
 * Adds the known folders and, on Windows, the current registry PATH to the process PATH.
 * ? Reading the registry launches PowerShell (~1 s), so the result is reused for 20 s
 * unless `force` is passed (right after installing something).
 * @param force read again even if it is recent
 */
export async function refreshPath(force = false): Promise<void> {
    if (!force && Date.now() - lastPathRefresh < 20000) {
        return;
    }
    lastPathRefresh = Date.now();
    const extra = knownToolDirs();
    if (isWindows) {
        const fromRegistry = await readWindowsPath();
        for (const dir of fromRegistry.split(/[\r\n;]+/)) {
            if (dir.trim()) {
                extra.unshift(dir.trim());
            }
        }
    }
    mergePath(extra);
}

// ─── Automatic installers ───────────────────────────────────────────

/** How to install a tool. */
export interface Installer {
    /** What the terminal shows while it installs. */
    title: string;
    command: string;
    /** Exit codes (besides 0) that are not an error. */
    okExitCodes?: number[];
}

let wingetAvailable: Promise<boolean> | undefined;
let brewAvailable: Promise<boolean> | undefined;

/**
 * Whether this command exists on the system.
 * @param command program to check
 */
async function hasCommand(command: string): Promise<boolean> {
    return !!(await readVersion(command, 10000));
}

/**
 * Install with winget (ships with Windows 11 and updated Windows 10).
 * @param id winget package id
 * @param name readable name
 */
function winget(id: string, name: string): Installer {
    return {
        title: `Installing ${name} (accept the Windows permission prompt if it appears)`,
        command: `winget install --id ${id} -e --silent --disable-interactivity --accept-package-agreements --accept-source-agreements`,
    };
}

/** Official Laravel installer: brings PHP, Composer and the Laravel installer. */
function phpNew(): Installer {
    const version = '8.4';
    const windowsScript =
        '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; ' +
        `iex ((New-Object System.Net.WebClient).DownloadString('https://php.new/install/windows/${version}'))`;
    return {
        title: 'Installing PHP and Composer (php.new, the official Laravel installer)',
        command: isWindows
            ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "${windowsScript}"`
            : `/bin/bash -c "$(curl -fsSL https://php.new/install/${isMac ? 'mac' : 'linux'}/${version})"`,
    };
}

/** winget packages for each tool. */
const wingetIds: Partial<Record<ToolId, string>> = {
    node: 'OpenJS.NodeJS.LTS',
    git: 'Git.Git',
    gh: 'GitHub.cli',
    python: 'Python.Python.3.13',
    go: 'GoLang.Go',
    dotnet: 'Microsoft.DotNet.SDK.10',
    cargo: 'Rustlang.Rustup',
    java: 'EclipseAdoptium.Temurin.21.JDK',
};

/** Homebrew formulas for each tool. */
const brewFormulas: Partial<Record<ToolId, string>> = {
    node: 'node',
    git: 'git',
    gh: 'gh',
    python: 'python',
    go: 'go',
    dotnet: '--cask dotnet-sdk',
    java: '--cask temurin@21',
    flutter: '--cask flutter',
};

/**
 * Install or update with the system package manager: winget on Windows, Homebrew on macOS.
 * Linux has no common one, so it returns undefined.
 * @param id tool
 * @param action install or update
 * @param version installed version (Python: decides which winget package to use)
 */
async function viaSystemManager(
    id: ToolId,
    action: 'install' | 'upgrade',
    version?: string,
): Promise<Installer | undefined> {
    if (isWindows) {
        wingetAvailable ??= hasCommand('winget');
        // ! Python: there is one package per version (Python.Python.3.13, 3.14…); the one in use is updated.
        const pythonMinor = action === 'upgrade' && id === 'python' ? version?.match(/^(\d+\.\d+)/)?.[1] : undefined;
        const wingetId = pythonMinor ? `Python.Python.${pythonMinor}` : wingetIds[id];
        if (!(await wingetAvailable) || !wingetId) {
            return undefined;
        }
        return action === 'install' ? winget(wingetId, toolName(id)) : wingetUpgrade(wingetId, toolName(id));
    }
    if (isMac) {
        brewAvailable ??= hasCommand('brew');
        const formula = brewFormulas[id];
        if ((await brewAvailable) && formula) {
            const verb = action === 'install' ? 'Installing' : 'Updating';
            return { title: `${verb} ${toolName(id)} with Homebrew`, command: `brew ${action} ${formula}` };
        }
    }
    // ? Every Linux distribution has its own manager; better to follow the official guide.
    return undefined;
}

/**
 * Returns how to install a tool on this system, or undefined if it must be done by hand.
 * @param id tool to install
 */
export async function installerFor(id: ToolId): Promise<Installer | undefined> {
    if (id === 'php' || id === 'composer') {
        return phpNew();
    }
    if (id === 'cargo' && !isWindows) {
        return {
            title: 'Installing Rust (rustup)',
            command: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
        };
    }
    return viaSystemManager(id, 'install');
}

// ─── Package managers ───────────────────────────────────────────────

export type PackageManagerId = 'npm' | 'pnpm' | 'bun';

/** Commands of a JavaScript package manager. */
export interface PackageManager {
    id: PackageManagerId;
    /** Installed version; undefined if not installed. */
    version?: string;
    /** Runs a package without installing it globally (npx / pnpm dlx / bunx). */
    exec(spec: string, args: string[]): string;
    /** Installs the dependencies from package.json. */
    install(): string;
    /** Adds packages (`dev` = development only). */
    add(packages: string[], dev?: boolean): string;
    /** Runs a package.json script. */
    run(script: string): string;
    /** Runs a binary from the project's node_modules. */
    bin(name: string, args: string[]): string;
}

/**
 * Joins arguments with spaces, with a leading space if there are any.
 * @param args command arguments
 */
function joinArgs(args: string[]): string {
    return args.length ? ' ' + args.join(' ') : '';
}

/** How each command is spelled in each package manager (only the texts change). */
interface PackageManagerSyntax {
    /** Run a package without installing it (npx / pnpm dlx / bunx). */
    exec: string;
    install: string;
    add: string;
    /** "Development dependency" flag. */
    dev: string;
    run: string;
    /** Run a binary from node_modules. */
    bin: string;
}

const packageManagerSyntax: Record<PackageManagerId, PackageManagerSyntax> = {
    npm: { exec: 'npx -y', install: 'npm install', add: 'npm install', dev: '-D', run: 'npm run', bin: 'npx' },
    pnpm: { exec: 'pnpm dlx', install: 'pnpm install', add: 'pnpm add', dev: '-D', run: 'pnpm', bin: 'pnpm exec' },
    bun: { exec: 'bunx', install: 'bun install', add: 'bun add', dev: '-d', run: 'bun run', bin: 'bunx' },
};

/**
 * Builds the object with the commands of the given package manager.
 * @param id npm, pnpm or bun
 * @param version installed version (if any)
 */
export function packageManager(id: PackageManagerId, version?: string): PackageManager {
    const x = packageManagerSyntax[id];
    return {
        id,
        version,
        exec(spec, args) {
            return `${x.exec} ${spec}${joinArgs(args)}`;
        },
        install() {
            return x.install;
        },
        add(pkgs, dev) {
            return `${x.add} ${dev ? x.dev + ' ' : ''}${pkgs.join(' ')}`;
        },
        run(script) {
            return `${x.run} ${script}`;
        },
        bin(name, args) {
            return `${x.bin} ${name}${joinArgs(args)}`;
        },
    };
}

/**
 * How to install pnpm or bun if they are missing (npm comes with Node.js).
 * @param id package manager to install
 */
export function packageManagerInstaller(id: PackageManagerId): Installer | undefined {
    if (id === 'pnpm') {
        return {
            title: 'Installing pnpm',
            command: isWindows ? 'npm install -g pnpm' : 'curl -fsSL https://get.pnpm.io/install.sh | sh -',
        };
    }
    if (id === 'bun') {
        return {
            title: 'Installing bun',
            command: isWindows
                ? 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"'
                : 'curl -fsSL https://bun.sh/install | bash',
        };
    }
    return undefined;
}

let pmCache: Promise<PackageManager[]> | undefined;

/** Detects the three package managers and their version (if installed). */
async function probePackageManagers(): Promise<PackageManager[]> {
    const ids: PackageManagerId[] = ['npm', 'pnpm', 'bun'];
    const versions = await Promise.all(ids.map(readVersionOf));
    const result: PackageManager[] = [];
    for (let i = 0; i < ids.length; i++) {
        const raw = versions[i];
        result.push(packageManager(ids[i], raw ? extractVersion(raw) : undefined));
    }
    return result;
}

/** Version of a command with the default timeout (to use with `map`). */
function readVersionOf(command: string): Promise<string | undefined> {
    return readVersion(command);
}

/** The three package managers, with a version if installed (npm first). */
export function detectPackageManagers(): Promise<PackageManager[]> {
    pmCache ??= probePackageManagers();
    return pmCache;
}

// ─── Updaters ───────────────────────────────────────────────────────

/**
 * Update with winget. If winget has nothing newer or did not install it,
 * it ends with a special code that toolupdate.ts explains (and that is NOT an error).
 * @param id winget package id
 * @param name readable name
 */
function wingetUpgrade(id: string, name: string): Installer {
    const flags = '-e --silent --disable-interactivity --accept-package-agreements --accept-source-agreements';
    return {
        title: `Updating ${name} (accept the Windows permission prompt if it appears)`,
        command: `winget upgrade --id ${id} ${flags}`,
    };
}

/**
 * How to update an installed tool, or undefined if it cannot be done automatically.
 * @param id tool
 * @param version installed version (Python: decides which winget package to update)
 */
export async function updaterFor(id: ToolId, version?: string): Promise<Installer | undefined> {
    // * Tools that update themselves, on any system.
    const selfUpdaters: Partial<Record<ToolId, string>> = {
        composer: 'composer self-update',
        cargo: 'rustup update',
        flutter: 'flutter upgrade',
    };
    const selfUpdate = selfUpdaters[id];
    if (selfUpdate) {
        return { title: `Updating ${toolName(id)}`, command: selfUpdate };
    }
    return viaSystemManager(id, 'upgrade', version);
}

/**
 * How to update npm, pnpm or bun.
 * @param id package manager
 */
export function packageManagerUpdater(id: PackageManagerId): Installer {
    switch (id) {
        case 'pnpm':
            return { title: 'Updating pnpm', command: 'pnpm self-update || npm install -g pnpm@latest' };
        case 'bun':
            return { title: 'Updating bun', command: 'bun upgrade' };
        default:
            return { title: 'Updating npm', command: 'npm install -g npm@latest' };
    }
}

/**
 * Where what an installer runs comes from, to tell the person before asking for
 * permission. Deduced from the command: the download addresses it contains or, if there
 * are none, the program that runs it (winget, brew, npm…).
 * @param installer installer
 */
export function installSource(installer: Installer): string {
    const hosts = new Set<string>();
    for (const url of installer.command.match(/https?:\/\/[^\s'")|]+/g) ?? []) {
        hosts.add(new URL(url).host);
    }
    if (hosts.size) {
        return `a script downloaded from ${[...hosts].join(', ')}`;
    }
    const program = installer.command.trim().split(/\s+/)[0];
    const names: Record<string, string> = {
        winget: "Microsoft's package manager (winget)",
        brew: 'Homebrew',
        npm: 'npm (npmjs.com)',
        pnpm: 'pnpm',
        bun: 'bun',
        composer: 'Composer',
        rustup: 'rustup',
        flutter: 'Flutter',
    };
    return names[program] ?? program;
}
