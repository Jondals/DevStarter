/**
 * tools.ts
 * ────────
 * Todo lo relacionado con los programas instalados en el ordenador:
 *  - Detectar si están Node.js, Python, PHP, Git… y qué versión tienen.
 *  - Actualizar el PATH en caliente después de instalar algo (sin reiniciar VS Code).
 *  - Saber cómo instalar cada herramienta (winget en Windows, Homebrew en macOS, php.new…).
 *  - Construir los comandos de cada gestor de paquetes (npm, pnpm o bun).
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Herramientas que DevStarter sabe detectar e instalar. */
export type ToolId =
    'node' | 'git' | 'gh' | 'python' | 'php' | 'composer' | 'flutter' | 'go' | 'dotnet' | 'cargo' | 'java';

/** Resultado de detectar una herramienta. */
export interface ToolInfo {
    id: ToolId;
    name: string;
    installUrl: string;
    /** Comando con el que se ejecuta (p. ej. `py` en vez de `python` en algunos Windows). */
    command?: string;
    /** Versión instalada; undefined si no está instalada. */
    version?: string;
}

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const home = os.homedir();

/** Datos fijos de cada herramienta: nombre, web de descarga y comandos a probar. */
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

/** Todas las herramientas, en el orden en que se muestran. */
export const allToolIds = Object.keys(toolMeta) as ToolId[];

/** Versión mínima de Node.js que piden las versiones actuales de Vite, Next.js y Astro. */
export const minNodeVersion = '20.19.0';

/**
 * Comando para pedir la versión de un programa. Go no entiende `--version`.
 * @param command nombre del programa
 */
function versionCommand(command: string): string {
    return command === 'go' ? 'go version' : `${command} --version`;
}

/**
 * Ejecuta `<comando> --version` y devuelve la primera línea, o undefined si falla.
 * @param command programa a probar
 * @param timeout milisegundos antes de rendirse
 */
function readVersion(command: string, timeout = 20000): Promise<string | undefined> {
    return new Promise(function (resolve) {
        // Desde la carpeta personal, no la del proyecto abierto: pnpm (y otros) cambian de versión
        // según el campo "packageManager" del proyecto y darían un número que no es el instalado.
        const options = { timeout, windowsHide: true, env: process.env, cwd: home };
        cp.exec(versionCommand(command), options, function (err, stdout, stderr) {
            const text = (stdout || stderr || '').trim();
            resolve(err || !text ? undefined : text.split(/\r?\n/)[0].trim());
        });
    });
}

/**
 * Extrae "1.2.3" de textos como "v1.2.3" o "Python 3.12.1".
 * @param text salida de `--version`
 */
function extractVersion(text: string): string {
    return text.match(/\d+\.\d+(\.\d+)?/)?.[0] ?? text;
}

/** Caché de detecciones, para no lanzar los mismos procesos varias veces. */
const cache = new Map<ToolId, Promise<ToolInfo>>();

/**
 * Prueba los comandos posibles de una herramienta hasta encontrar uno que funcione.
 * @param id herramienta a detectar
 */
async function probeTool(id: ToolId): Promise<ToolInfo> {
    const meta = toolMeta[id];
    for (const candidate of meta.candidates) {
        // Flutter puede tardar bastante la primera vez que se ejecuta.
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
 * Detecta una herramienta (con caché).
 * @param id herramienta a detectar
 */
export function detectTool(id: ToolId): Promise<ToolInfo> {
    let pending = cache.get(id);
    if (!pending) {
        pending = probeTool(id);
        cache.set(id, pending);
    }
    return pending;
}

/** Detecta todas las herramientas a la vez (para el comando "Check My Tools"). */
export function detectAllTools(): Promise<ToolInfo[]> {
    return Promise.all(allToolIds.map(detectTool));
}

/**
 * Nombre legible de una herramienta.
 * @param id herramienta
 */
export function toolName(id: ToolId): string {
    return toolMeta[id].name;
}

/** Olvida lo detectado, por ejemplo después de instalar algo. */
export function clearToolCache(): void {
    cache.clear();
    pmCache = undefined;
}

/**
 * Compara versiones "a.b.c".
 * @returns negativo si a < b, 0 si son iguales, positivo si a > b
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
// Cuando se instala algo, el instalador añade su carpeta al PATH del sistema,
// pero VS Code (y esta extensión) siguen con el PATH antiguo hasta reiniciarse.
// Estas funciones lo actualizan en caliente para poder usar la herramienta al momento.

/** Carpetas donde suelen acabar las herramientas aunque VS Code aún no las vea. */
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
 * Añade carpetas al PATH del proceso, sin repetir las que ya estén.
 * @param extra carpetas a añadir
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

/** Pasa un texto a minúsculas (para comparar rutas sin distinguir mayúsculas). */
function toLower(s: string): string {
    return s.toLowerCase();
}

/** Lee el PATH actual de Windows desde el registro (sistema + usuario). */
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

/** PATH que tenía VS Code al arrancar (para saber qué carpetas se han añadido después). */
const startupPath = (process.env.PATH ?? '').split(path.delimiter);

/**
 * Carpetas que refreshPath() ha añadido al PATH (herramientas instaladas con VS Code abierto).
 * Sirven para dárselas también a las terminales nuevas.
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

/** Momento de la última lectura del PATH (para no repetirla sin necesidad). */
let lastPathRefresh = 0;

/**
 * Añade al PATH del proceso las carpetas conocidas y, en Windows, el PATH actual del registro.
 * Leer el registro lanza PowerShell (~1 s), así que se reutiliza el resultado durante 20 s,
 * salvo que se pida `force` (justo después de instalar algo).
 * @param force leer de nuevo aunque sea reciente
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

// ─── Instaladores automáticos ───────────────────────────────────────

/** Cómo instalar una herramienta. */
export interface Installer {
    /** Lo que se muestra en el terminal mientras se instala. */
    title: string;
    command: string;
    /** Códigos de salida (además del 0) que no son un error. */
    okExitCodes?: number[];
}

let wingetAvailable: Promise<boolean> | undefined;
let brewAvailable: Promise<boolean> | undefined;

/**
 * ¿Existe este comando en el sistema?
 * @param command programa a comprobar
 */
async function hasCommand(command: string): Promise<boolean> {
    return !!(await readVersion(command, 10000));
}

/**
 * Instalación con winget (viene con Windows 11 y Windows 10 actualizado).
 * @param id identificador del paquete en winget
 * @param name nombre legible
 */
function winget(id: string, name: string): Installer {
    return {
        title: `Installing ${name} (accept the Windows permission prompt if it appears)`,
        command: `winget install --id ${id} -e --silent --disable-interactivity --accept-package-agreements --accept-source-agreements`,
    };
}

/** Instalador oficial de Laravel: trae PHP, Composer y el instalador de Laravel. */
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

/** Paquetes de winget para cada herramienta. */
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

/** Fórmulas de Homebrew para cada herramienta. */
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
 * Instalar o actualizar con el gestor del sistema: winget en Windows, Homebrew en macOS.
 * En Linux no hay uno común, así que devuelve undefined.
 * @param id herramienta
 * @param action instalar o actualizar
 * @param version versión instalada (Python: decide qué paquete de winget usar)
 */
async function viaSystemManager(
    id: ToolId,
    action: 'install' | 'upgrade',
    version?: string,
): Promise<Installer | undefined> {
    if (isWindows) {
        wingetAvailable ??= hasCommand('winget');
        // Python: hay un paquete por cada versión (Python.Python.3.13, 3.14…); se actualiza la que se usa.
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
    // En Linux cada distribución usa su gestor; mejor que la persona siga la guía oficial.
    return undefined;
}

/**
 * Devuelve cómo instalar una herramienta en este sistema, o undefined si hay que hacerlo a mano.
 * @param id herramienta a instalar
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

// ─── Gestores de paquetes ───────────────────────────────────────────

export type PackageManagerId = 'npm' | 'pnpm' | 'bun';

/** Comandos de un gestor de paquetes de JavaScript. */
export interface PackageManager {
    id: PackageManagerId;
    /** Versión instalada; undefined si no está instalado. */
    version?: string;
    /** Ejecuta un paquete sin instalarlo de forma global (npx / pnpm dlx / bunx). */
    exec(spec: string, args: string[]): string;
    /** Instala las dependencias del package.json. */
    install(): string;
    /** Añade paquetes (`dev` = solo para desarrollo). */
    add(packages: string[], dev?: boolean): string;
    /** Ejecuta un script del package.json. */
    run(script: string): string;
    /** Ejecuta un binario de node_modules del proyecto. */
    bin(name: string, args: string[]): string;
}

/**
 * Junta argumentos con espacios, con un espacio delante si hay alguno.
 * @param args argumentos del comando
 */
function joinArgs(args: string[]): string {
    return args.length ? ' ' + args.join(' ') : '';
}

/** Cómo se escribe cada comando en un gestor de paquetes (solo cambian los textos). */
interface PackageManagerSyntax {
    /** Ejecutar un paquete sin instalarlo (npx / pnpm dlx / bunx). */
    exec: string;
    install: string;
    add: string;
    /** Opción de "dependencia de desarrollo". */
    dev: string;
    run: string;
    /** Ejecutar un binario de node_modules. */
    bin: string;
}

const packageManagerSyntax: Record<PackageManagerId, PackageManagerSyntax> = {
    npm: { exec: 'npx -y', install: 'npm install', add: 'npm install', dev: '-D', run: 'npm run', bin: 'npx' },
    pnpm: { exec: 'pnpm dlx', install: 'pnpm install', add: 'pnpm add', dev: '-D', run: 'pnpm', bin: 'pnpm exec' },
    bun: { exec: 'bunx', install: 'bun install', add: 'bun add', dev: '-d', run: 'bun run', bin: 'bunx' },
};

/**
 * Crea el objeto con los comandos del gestor de paquetes indicado.
 * @param id npm, pnpm o bun
 * @param version versión instalada (si la hay)
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
 * Cómo instalar pnpm o bun si no están (npm viene con Node.js).
 * @param id gestor a instalar
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

/** Detecta los tres gestores de paquetes y su versión (si están instalados). */
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

/** Versión de un comando con el tiempo de espera por defecto (para usar con `map`). */
function readVersionOf(command: string): Promise<string | undefined> {
    return readVersion(command);
}

/** Los tres gestores de paquetes, con versión si están instalados (npm primero). */
export function detectPackageManagers(): Promise<PackageManager[]> {
    pmCache ??= probePackageManagers();
    return pmCache;
}

// ─── Actualizadores ─────────────────────────────────────────────────

/**
 * Actualización con winget. Si winget no tiene nada más nuevo o no es quien la instaló,
 * termina con un código especial que toolupdate.ts explica (y que NO es un error).
 * @param id identificador del paquete en winget
 * @param name nombre legible
 */
function wingetUpgrade(id: string, name: string): Installer {
    const flags = '-e --silent --disable-interactivity --accept-package-agreements --accept-source-agreements';
    return {
        title: `Updating ${name} (accept the Windows permission prompt if it appears)`,
        command: `winget upgrade --id ${id} ${flags}`,
    };
}

/**
 * Cómo actualizar una herramienta ya instalada, o undefined si no se sabe hacerlo solo.
 * @param id herramienta
 * @param version versión instalada (Python: decide qué paquete de winget actualizar)
 */
export async function updaterFor(id: ToolId, version?: string): Promise<Installer | undefined> {
    // Herramientas que se actualizan a sí mismas, en cualquier sistema.
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
 * Cómo actualizar npm, pnpm o bun.
 * @param id gestor de paquetes
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
 * De dónde viene lo que va a ejecutar un instalador, para decírselo a la persona antes de
 * pedirle permiso. Se deduce del comando: las direcciones de descarga que contiene o, si no
 * hay ninguna, el programa que lo ejecuta (winget, brew, npm…).
 * @param installer instalador
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
