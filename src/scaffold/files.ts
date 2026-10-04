/**
 * scaffold/files.ts
 * ─────────────────
 * Pequeñas utilidades para crear y modificar ficheros de los proyectos generados:
 * escribir con carpetas, editar JSON y .env, completar .gitignore y ajustar pnpm.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Escribe un fichero creando las carpetas que falten.
 * Quita el salto de línea inicial que dejan las plantillas escritas con `...`.
 * @param file ruta completa del fichero
 * @param content contenido
 */
export function write(file: string, content: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content.replace(/^\n/, ''));
}

/**
 * Devuelve la ruta del primer candidato que exista dentro de `dir`.
 * @param dir carpeta donde buscar
 * @param candidates nombres de fichero, en orden de preferencia
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
 * Lee un JSON, deja que `change` lo modifique y lo vuelve a guardar.
 * @param file ruta del fichero JSON (si no existe, se empieza con {})
 * @param change función que modifica el objeto
 */
export function patchJson(file: string, change: (json: Record<string, any>) => void): void {
    const json = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    change(json);
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

/**
 * Cambia (o añade) `CLAVE=valor` en el contenido de un .env, aunque la línea esté comentada.
 * @param content contenido actual del .env
 * @param key nombre de la variable
 * @param value nuevo valor
 */
export function setEnvValue(content: string, key: string, value: string): string {
    const pattern = new RegExp(`^#?\\s*${key}=.*$`, 'm');
    if (pattern.test(content)) {
        return content.replace(pattern, `${key}=${value}`);
    }
    return content.replace(/\n?$/, `\n${key}=${value}\n`);
}

/**
 * Aplica varios valores a un fichero .env si existe.
 * @param file ruta del .env
 * @param values variables a cambiar
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
 * Añade líneas al final de un fichero de texto, asegurando el salto de línea anterior.
 * @param file fichero a ampliar (se crea si no existe)
 * @param text texto a añadir
 */
export function appendLines(file: string, text: string): void {
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const separator = content && !content.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(file, `${content}${separator}${text.endsWith('\n') ? text : text + '\n'}`);
}

/**
 * pnpm 10+ no ejecuta los scripts de instalación de las dependencias salvo que se aprueben.
 * Algunos paquetes nativos (como better-sqlite3) los necesitan para funcionar.
 * @param dir carpeta del proyecto
 * @param pkg paquete a aprobar
 */
export function allowPnpmBuild(dir: string, pkg: string): void {
    const file = path.join(dir, 'pnpm-workspace.yaml');
    let content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    // Quita una entrada anterior del mismo paquete (p. ej. "set this to true or false").
    content = content.replace(new RegExp(`^\\s+${pkg}:.*\\n?`, 'm'), '');
    if (/^allowBuilds:/m.test(content)) {
        content = content.replace(/^allowBuilds:.*$/m, `allowBuilds:\n  ${pkg}: true`);
    } else {
        content = `${content.trimEnd()}${content.trim() ? '\n' : ''}allowBuilds:\n  ${pkg}: true\n`;
    }
    fs.writeFileSync(file, content);
}

/**
 * pnpm 11 vuelve a comprobar las dependencias en cada "pnpm dev" y falla si alguna
 * trae scripts de build sin aprobar (esbuild, sharp…). Con esto solo avisa.
 * También evita que pnpm busque un workspace en carpetas superiores.
 * @param dir carpeta del proyecto
 */
export function relaxPnpmBuilds(dir: string): void {
    const file = path.join(dir, 'pnpm-workspace.yaml');
    const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (!/^strictDepBuilds:/m.test(content)) {
        appendLines(file, 'strictDepBuilds: false');
    }
}

/**
 * Normaliza una entrada de .gitignore: "node_modules" equivale a "/node_modules/".
 * @param entry línea del .gitignore
 */
function normalizeIgnore(entry: string): string {
    return entry.trim().replace(/^\/|\/$/g, '');
}

/**
 * Se asegura de que .gitignore contiene las entradas indicadas.
 * Algunos generadores (p. ej. Nest con --skip-git) no lo crean, y sin él
 * el primer commit incluiría node_modules entero.
 * @param dir carpeta con el .gitignore
 * @param entries entradas que deben estar
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
 * "mi-app" → "mi_app" (válido como nombre de base de datos o de paquete Python/Dart).
 * @param name nombre del proyecto
 */
export function snakeCase(name: string): string {
    const result = name
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return result || 'app';
}
