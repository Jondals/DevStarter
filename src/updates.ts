/**
 * updates.ts
 * ──────────
 * Todo lo relacionado con versiones y actualizaciones:
 *  - Comprobar si una versión cumple un rango (">=20.19.0", "^22.12.0 || >=24"…), como hace npm.
 *  - Consultar el registro de npm para saber la última versión de un paquete, o la más
 *    nueva que funciona con el Node.js instalado (para cuando un framework pide un Node más nuevo).
 *  - Saber cuál es la última versión LTS de Node.js.
 *  - Leer las versiones fijadas por la persona en los ajustes (devstarter.scaffolderVersions).
 */
import * as vscode from 'vscode';
import { fetchJson } from './net';

/** Una versión "1.2.3" como números [1, 2, 3]. */
type Version = [number, number, number];

/**
 * Convierte un texto en versión. Acepta "v1.2.3", "1.2" o "1" (lo que falta es 0).
 * @param text versión en texto
 * @returns la versión, o undefined si no es válida o es una prerelease (1.2.3-beta)
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
 * Compara dos versiones.
 * @returns negativo si a < b, 0 si son iguales, positivo si a > b
 */
function compare(a: Version, b: Version): number {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Límites de un comparador: mínimo y máximo, cada uno incluido o excluido. */
interface Bounds {
    min?: Version;
    minInclusive: boolean;
    max?: Version;
    maxInclusive: boolean;
}

/**
 * Límites "desde esta versión (incluida) hasta esta otra (excluida)".
 * @param min versión mínima
 * @param max primera versión que ya no entra
 */
function upTo(min: Version, max: Version): Bounds {
    return { min, minInclusive: true, max, maxInclusive: false };
}

/**
 * Convierte un comparador de un rango en límites [mínimo incluido, máximo excluido].
 * Ejemplos: "^22.12.0" → [22.12.0, 23.0.0); ">=24" → [24.0.0, ∞); "20.x" → [20.0.0, 21.0.0).
 * @param comparator una pieza del rango (sin espacios)
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
    // Cuántas partes se escribieron de verdad ("20" → 1, "20.1" → 2, "20.1.0" → 3).
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
            // ^1.2.3 → hasta la siguiente mayor; ^0.2.3 → hasta la siguiente menor.
            return upTo(version, major > 0 || given === 1 ? [major + 1, 0, 0] : [0, minor + 1, 0]);
        case '~':
            return upTo(version, given === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0]);
        default:
            // Versión "parcial" (20 o 20.x) = cualquier 20.*.*; completa (20.1.0) = exacta.
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
 * ¿La versión cumple el rango? Entiende los rangos habituales de npm:
 * "||" (o), espacios (y), ^, ~, >=, >, <=, <, x/* y versiones parciales.
 * @param version versión instalada, p. ej. "24.14.1"
 * @param range rango, p. ej. "^22.22.3 || ^24.15.0 || >=26.0.0"
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
        // Une "operador espacio versión" (">= 18") y separa los comparadores.
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
 * Última versión publicada de un paquete de npm, o undefined si no hay conexión.
 * @param pkg nombre del paquete
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
 * La versión más nueva de un paquete cuyo campo "engines.node" acepta el Node.js instalado.
 * Sirve para cuando la última versión de un framework pide un Node más nuevo.
 * @param pkg nombre del paquete (p. ej. "@angular/cli")
 * @param nodeVersion versión de Node.js instalada
 * @returns la versión compatible, o undefined si no hay conexión o ninguna vale
 */
export async function latestCompatibleVersion(pkg: string, nodeVersion: string): Promise<string | undefined> {
    let data: any;
    try {
        // Formato abreviado del registro: incluye "engines" y pesa una fracción del documento completo.
        // (El documento abreviado ronda los 2 MB para paquetes con muchas versiones: 10 MB de margen.)
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
            continue; // sin prereleases ni versiones retiradas
        }
        if (satisfies(nodeVersion, data.versions[text].engines?.node) && (!best || compare(v, best) > 0)) {
            best = v;
            bestText = text;
        }
    }
    return bestText;
}

/** Última versión LTS de Node.js (de nodejs.org), o undefined si no hay conexión. */
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
        // sin conexión
    }
    return undefined;
}

/**
 * ¿`latest` es más nueva que `current`?
 * @param current versión instalada
 * @param latest última versión conocida
 */
export function isNewer(current: string | undefined, latest: string | undefined): boolean {
    const a = current ? parseVersion(current) : undefined;
    const b = latest ? parseVersion(latest) : undefined;
    return !!a && !!b && compare(b, a) > 0;
}

/**
 * Versión a usar para un generador (create-vite, @angular/cli…): "latest" salvo que la
 * persona la haya fijado en el ajuste devstarter.scaffolderVersions, p. ej. { "@angular/cli": "21" }.
 * Es la salida de emergencia si una versión nueva de un generador se rompe.
 * @param pkg nombre del paquete
 */
export function scaffolderTag(pkg: string): string {
    try {
        const pinned = vscode.workspace
            .getConfiguration('devstarter')
            .get<Record<string, string>>('scaffolderVersions', {});
        const tag = pinned[pkg];
        // El valor acaba dentro de un comando de consola: solo se aceptan versiones o etiquetas
        // normales (21, 21.2.0, ^21, next, latest…). Cualquier otra cosa se ignora.
        return typeof tag === 'string' && /^[\w.^~*-]{1,40}$/.test(tag) ? tag : 'latest';
    } catch {
        return 'latest'; // fuera de VS Code (scripts de prueba)
    }
}

/**
 * Extrae los requisitos de Node.js de un mensaje de error, p. ej.
 * "requires a minimum Node.js version of v22.22.3 or v24.15.0" → "v22.22.3 or v24.15.0".
 * @param output salida del comando que falló
 */
export function requiredNodeFromOutput(output: string): string | undefined {
    const angular = output.match(/minimum Node\.js version of ([^\n.]+(?:\.\d+)*(?: or v[\d.]+)*)/i);
    if (angular) {
        return angular[1].trim().replace(/\.$/, '');
    }
    const engine = output.match(/wanted: \{"node":"([^"]+)"/);
    return engine?.[1];
}

/** ¿El error dice que el Node.js instalado es demasiado antiguo? */
export function isNodeEngineError(output: string): boolean {
    return /update your Node\.js version|minimum Node\.js version|requires? (a )?Node(\.js)? version|EBADENGINE|Unsupported engine/i.test(
        output,
    );
}
