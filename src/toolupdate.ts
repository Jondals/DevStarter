/**
 * toolupdate.ts
 * ─────────────
 * Actualizar herramientas (Node.js, Git, Python, pnpm…) comprobando que de verdad se actualizan.
 *
 * El fallo que arregla: winget puede tener un catálogo más atrasado que la web oficial. Si
 * se pedía actualizar y winget no tenía nada nuevo, el paso terminaba "bien" sin cambiar
 * nada. Ahora cada actualización:
 *   1. ejecuta el actualizador (winget, brew, el propio programa…),
 *   2. vuelve a leer la versión instalada,
 *   3. si no ha cambiado, prueba una segunda vía (en Node.js: el instalador oficial),
 *   4. y si sigue igual, explica por qué en vez de mostrar un falso "✔".
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

/** Códigos de salida de winget que significan "nada que hacer", no un error. */
export const wingetCodes = {
    /** "No se encontró ninguna actualización disponible" (0x8A15002B). */
    noUpdate: 0x8a15002b,
    /** "No se encontró un paquete instalado con winget" (0x8A150014). */
    notInstalled: 0x8a150014,
};

/** Qué hace falta saber para actualizar una herramienta. */
export interface UpdateTarget {
    /** Nombre para los mensajes ("Node.js"). */
    name: string;
    /** Versión instalada ahora. */
    current: string;
    /** Última versión conocida (puede ser más nueva de lo que ofrece el actualizador). */
    latest?: string;
    installer: Installer;
    /** Vuelve a leer la versión instalada (sin caché). */
    detect: () => Promise<string | undefined>;
    /** Segunda vía si el actualizador no cambia la versión. Devuelve true si lo intentó. */
    fallback?: (log: Logger) => Promise<boolean>;
    /** Consejo extra si no se pudo actualizar (p. ej. "npm viene con Node.js"). */
    hint?: string;
}

/**
 * Explica por qué una actualización no cambió la versión.
 * @param t herramienta
 * @param exitCode código con el que terminó el actualizador
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
 * Crea el paso que actualiza una herramienta y comprueba el resultado.
 * @param t herramienta a actualizar
 */
export function toolUpdateStep(t: UpdateTarget): CommandStep {
    return {
        kind: 'command',
        title: t.installer.title,
        command: t.installer.command,
        cwd: os.homedir(),
        // Si no se puede actualizar, se avisa y se sigue con lo demás.
        optional: true,
        okExitCodes: [wingetCodes.noUpdate, wingetCodes.notInstalled, ...(t.installer.okExitCodes ?? [])],
        async verify(log, exitCode) {
            let now = await freshVersion(t);
            if (isNewer(t.current, now)) {
                reportChange(t, now!, log);
                return;
            }
            // Sin cambios. ¿Es que ya estaba al día?
            if (!isNewer(t.current, t.latest)) {
                log(`Already the latest version (${t.current})`);
                return;
            }
            // Hay una versión más nueva y el actualizador no la dio: segunda vía.
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
 * Vuelve a leer la versión instalada, con el PATH y la caché al día.
 * @param t herramienta
 */
async function freshVersion(t: UpdateTarget): Promise<string | undefined> {
    await refreshPath(true);
    clearToolCache();
    return t.detect();
}

/**
 * Escribe "Node.js 24.19.0 → 24.21.0" (y avisa si aún no es la última).
 * @param t herramienta
 * @param now versión nueva
 * @param log dónde escribir
 */
function reportChange(t: UpdateTarget, now: string, log: Logger): void {
    log(`${t.name} ${t.current} → ${now}`);
    if (isNewer(now, t.latest)) {
        log(`The newest release (${t.latest}) is not available through this updater yet`);
    }
}

// ─── Node.js: instalador oficial ────────────────────────────────────

/**
 * Busca en el texto de SHASUMS256.txt el hash de un fichero.
 * Cada línea es "<sha256>  <nombre>".
 * @param text contenido de SHASUMS256.txt
 * @param fileName nombre del fichero a buscar
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
 * SHA-256 de unos datos, en hexadecimal.
 * @param data contenido
 */
export function sha256(data: Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/** Arquitectura con el nombre que usa nodejs.org. */
function nodeArch(): string {
    return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Descarga el instalador oficial de Node.js (.msi), comprueba su SHA-256 contra el que publica
 * nodejs.org y lo ejecuta. Windows pedirá permiso de administrador.
 * Es la segunda vía cuando winget aún no tiene la última versión.
 * @param version versión a instalar, p. ej. "24.21.0"
 * @param log dónde escribir los detalles
 * @returns true si se ejecutó el instalador
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
    // El instalador de Node.js pesa unos 30 MB: se aceptan hasta 100 MB.
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
        // 3010 = instalado, pero Windows pide reiniciar en algún momento.
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
 * Ejecuta un instalador (sin shell) y espera a que termine.
 * @param program programa
 * @param args argumentos
 * @returns el código de salida
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
