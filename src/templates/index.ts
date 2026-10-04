/**
 * templates/index.ts
 * ──────────────────
 * Junta todas las plantillas en un único catálogo y ofrece la validación
 * y sugerencia de nombres de proyecto.
 */
import { backendTemplates } from './backend';
import { frontendTemplates } from './frontend';
import { fullstackTemplates } from './fullstack';
import { mobileTemplates, otherTemplates } from './other';
import { Template } from './types';

export * from './types';
export * from './libraries';
export * from './presets';

/** Todas las plantillas, en el orden en que aparecen en el asistente. */
export const templates: Template[] = [
    ...frontendTemplates,
    ...fullstackTemplates,
    ...backendTemplates,
    ...mobileTemplates,
    ...otherTemplates,
];

/** ¿Es un backend que se puede añadir a un frontend? */
function isAttachableBackend(t: Template): boolean {
    return t.category === 'Backend' && !!t.port;
}

/** Backends que se pueden añadir a un frontend o a una app móvil. */
export const attachableBackends = templates.filter(isAttachableBackend);

/**
 * Busca una plantilla por id.
 * @param id identificador (puede ser undefined)
 */
export function findTemplate(id: string | undefined): Template | undefined {
    for (const t of templates) {
        if (t.id === id) {
            return t;
        }
    }
    return undefined;
}

/** Palabras reservadas de Dart (no valen como nombre de proyecto Flutter). */
// prettier-ignore
const dartKeywords = new Set([
    'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'default', 'do', 'else', 'enum', 'export', 'extends', 'false', 'final', 'for', 'if', 'import', 'in',
    'is', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'var', 'void', 'while', 'with',
]);

/**
 * Comprueba un nombre de proyecto.
 * @param name nombre escrito
 * @param nameStyle kebab (my-app) o snake (my_app)
 * @returns un mensaje de error, o undefined si está bien
 */
export function validateProjectName(name: string, nameStyle: Template['nameStyle']): string | undefined {
    if (!name) {
        return 'Give your project a name';
    }
    if (/\s/.test(name)) {
        return nameStyle === 'snake' ? 'No spaces: use underscores, e.g. my_app' : 'No spaces: use dashes, e.g. my-app';
    }
    if (nameStyle === 'snake') {
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
            return 'Use lowercase letters, numbers and underscores, starting with a letter (e.g. my_app)';
        }
        if (dartKeywords.has(name)) {
            return `"${name}" is a reserved word`;
        }
    } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
        return 'Use lowercase letters, numbers, dashes or dots (e.g. my-app)';
    }
    if (name.length > 100) {
        return 'That name is too long';
    }
    return undefined;
}

/**
 * Convierte "Mi App Chula" en "mi-app-chula" (o "mi_app_chula").
 * @param input texto escrito
 * @param nameStyle kebab o snake
 */
export function suggestName(input: string, nameStyle: Template['nameStyle']): string {
    const sep = nameStyle === 'snake' ? '_' : '-';
    return input
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // quita tildes
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, sep)
        .replace(new RegExp(`^[${sep}0-9]+|${sep}+$`, 'g'), '');
}
