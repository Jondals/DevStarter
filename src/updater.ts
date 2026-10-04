/**
 * updater.ts
 * ──────────
 * Comando "Update Project": actualiza las librerías de un proyecto existente.
 *
 *  1. Busca las partes del proyecto (la raíz y subcarpetas como frontend/ y backend/):
 *     Node (npm, pnpm o bun según el lockfile), Python (.venv), Composer, Cargo, Go y Flutter.
 *  2. Dos modos:
 *       - safe:   solo versiones menores y parches (no deberían romper nada).
 *       - latest: también versiones mayores (pueden necesitar cambios en el código).
 *  3. Opcionalmente hace un commit de seguridad antes y comprueba que sigue compilando después.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Logger, Step } from './terminal';
import { packageManager, PackageManagerId } from './tools';

export type UpdateMode = 'safe' | 'latest';

/** Tipos de proyecto que sabemos actualizar. */
export type PartKind = 'node' | 'python' | 'composer' | 'cargo' | 'go' | 'flutter';

/** Una parte del proyecto (una carpeta con su gestor de dependencias). */
export interface ProjectPart {
    dir: string;
    /** Carpeta relativa a la raíz ('.' si es la propia raíz). */
    label: string;
    kind: PartKind;
    /** Gestor de paquetes (solo Node). */
    pm?: PackageManagerId;
    /** Framework con herramienta oficial de actualización (solo Node). */
    framework?: Framework;
}

/** Frameworks que se actualizan con su propia herramienta oficial. */
export type Framework = 'angular' | 'expo' | 'next' | 'nuxt' | 'astro';

/**
 * Framework de un proyecto Node según sus dependencias.
 * @param dir carpeta del proyecto
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
 * Paquetes del framework que NO debe tocar la actualización genérica (los gestiona su herramienta).
 * Con comodines (@expo/*): npm-check-updates no entiende bien las expresiones con barras.
 */
const frameworkPackages: Record<Framework, string> = {
    angular: '@angular/*,@angular-devkit/*,typescript,zone.js,rxjs',
    expo: 'expo,expo-*,react,react-dom,react-native,react-native-*,@react-native/*,@expo/*,typescript,@types/react',
    next: 'next,react,react-dom,eslint-config-next,@types/react,@types/react-dom',
    nuxt: 'nuxt,vue,vue-router',
    astro: 'astro,@astrojs/*',
};

/** Carpetas que nunca hay que recorrer. */
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
 * Gestor de paquetes de un proyecto Node según su lockfile.
 * @param dir carpeta del proyecto
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
 * Qué tipo de proyecto hay en una carpeta (puede haber varios, p. ej. Laravel = Composer + Node).
 * @param dir carpeta a mirar
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
 * Busca las partes del proyecto en la raíz y hasta dos niveles de subcarpetas.
 * @param root carpeta del proyecto
 */
export function detectParts(root: string): ProjectPart[] {
    const parts: ProjectPart[] = [];

    /** Mira una carpeta y, si no es demasiado profunda, sus subcarpetas. */
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

/** Nombre legible de cada tipo de proyecto. */
export const kindNames: Record<PartKind, string> = {
    node: 'JavaScript',
    python: 'Python',
    composer: 'PHP (Composer)',
    cargo: 'Rust (Cargo)',
    go: 'Go',
    flutter: 'Flutter',
};

/**
 * Ejecuta un comando y devuelve su salida (para pasos que necesitan leer el resultado).
 * @param command comando de consola
 * @param cwd carpeta donde se ejecuta
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
 * Resume una lista de cambios en una línea, p. ej. "react ^18.2.0 → ^19.1.0, vite …".
 * @param changes nombre → nueva versión
 * @param max cuántos mostrar como mucho
 */
function summarize(changes: Array<[string, string]>, max = 6): string {
    const shown: string[] = [];
    for (const [name, version] of changes.slice(0, max)) {
        shown.push(`${name} → ${version}`);
    }
    return shown.join(', ') + (changes.length > max ? ` and ${changes.length - max} more` : '');
}

/**
 * Pasos para un proyecto Node: ver qué se puede actualizar, actualizar package.json
 * con npm-check-updates e instalar.
 * @param part parte del proyecto
 * @param mode safe o latest
 */
function nodeSteps(part: ProjectPart, mode: UpdateMode): Step[] {
    const pm = packageManager(part.pm ?? 'npm');
    const fw = part.framework;
    // "minor" = solo versiones compatibles; "latest" = también las mayores.
    const target = mode === 'safe' ? 'minor' : 'latest';
    // El framework y lo que va ligado a él lo actualiza su herramienta oficial, no ncu.
    // Angular y Expo siempre (sus versiones van ligadas); el resto solo al subir de versión mayor.
    const guarded = fw === 'angular' || fw === 'expo' || (fw && mode === 'latest');
    const reject = fw && guarded ? ` --reject "${frameworkPackages[fw]}"` : '';
    const ncu = `npx -y npm-check-updates@latest --target ${target}${reject}`;
    const steps: Step[] = [
        {
            kind: 'task',
            title: `Checking ${part.label} for updates`,
            async run(log: Logger) {
                const json = await run(`${ncu} --jsonUpgraded`, part.dir);
                // ncu puede escribir avisos antes del JSON; si no hay llaves, no hay nada que actualizar.
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
 * Pasos que actualizan el framework con su herramienta oficial (la que también adapta el código).
 * @param part parte del proyecto
 * @param fw framework detectado
 * @param mode safe o latest
 */
function frameworkSteps(part: ProjectPart, fw: Framework, mode: UpdateMode): Step[] {
    const pm = packageManager(part.pm ?? 'npm');
    const latest = mode === 'latest';
    /** Paso de comando del framework (si falla, se avisa y se sigue: el resto ya está actualizado). */
    function step(title: string, command: string): Step {
        return { kind: 'command', title: `${title} in ${part.label}`, command, cwd: part.dir, optional: true };
    }
    switch (fw) {
        case 'angular':
            // ng update sube una versión mayor cada vez y modifica el código si hace falta.
            return [
                step(
                    latest ? 'Migrating Angular to the next major (ng update)' : 'Updating Angular within its version',
                    pm.bin('ng', ['update', '@angular/core', '@angular/cli', '--allow-dirty', '--force']),
                ),
            ];
        case 'expo':
            return [
                ...(latest ? [step('Updating Expo SDK', pm.bin('expo', ['install', 'expo@latest']))] : []),
                // Deja cada librería en la versión que el SDK de Expo espera.
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
 * Python del entorno virtual de una carpeta.
 * @param dir carpeta del proyecto
 */
function venvPythonIn(dir: string): string {
    return process.platform === 'win32'
        ? path.join(dir, '.venv', 'Scripts', 'python.exe')
        : path.join(dir, '.venv', 'bin', 'python');
}

/**
 * Paso para un proyecto Python: actualiza los paquetes desactualizados del .venv
 * (en modo seguro, solo si no cambia la versión mayor) y regenera requirements.txt.
 * @param part parte del proyecto
 * @param mode safe o latest
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
 * Pasos de actualización de una parte del proyecto.
 * @param part parte del proyecto
 * @param mode safe o latest
 */
function partSteps(part: ProjectPart, mode: UpdateMode): Step[] {
    /** Paso que ejecuta un comando en la carpeta de la parte. */
    function command(title: string, cmd: string): Step {
        return { kind: 'command', title: `${title} in ${part.label}`, command: cmd, cwd: part.dir };
    }
    switch (part.kind) {
        case 'node':
            return nodeSteps(part, mode);
        case 'python':
            return pythonSteps(part, mode);
        case 'composer':
            // Composer respeta las restricciones de composer.json (^): ya es una actualización segura.
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
 * ¿El package.json tiene este script?
 * @param dir carpeta del proyecto
 * @param script nombre del script
 */
function hasScript(dir: string, script: string): boolean {
    try {
        return !!JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts?.[script];
    } catch {
        return false;
    }
}

/** Opciones del comando Update Project. */
export interface UpdateOptions {
    root: string;
    mode: UpdateMode;
    /** Hacer un commit de seguridad antes de actualizar. */
    checkpoint: boolean;
    /** Comprobar después que el proyecto sigue compilando. */
    verify: boolean;
}

/**
 * Todos los pasos de la actualización.
 * @param parts partes del proyecto a actualizar
 * @param opts modo y opciones
 */
export function updateSteps(parts: ProjectPart[], opts: UpdateOptions): Step[] {
    const steps: Step[] = [];
    if (opts.checkpoint) {
        steps.push({
            kind: 'command',
            title: 'Saving a Git checkpoint',
            // Si no hay cambios pendientes, el último commit ya es el punto de vuelta.
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
