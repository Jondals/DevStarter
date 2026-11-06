/**
 * templates/index.ts
 * ──────────────────
 * Gathers every template into a single catalog and provides project-name
 * validation and suggestions.
 */
import { backendTemplates } from './backend';
import { frontendTemplates } from './frontend';
import { fullstackTemplates } from './fullstack';
import { mobileTemplates, otherTemplates } from './other';
import { Template } from './types';

export * from './types';
export * from './libraries';
export * from './presets';

/** Every template, in the order they appear in the wizard. */
export const templates: Template[] = [
    ...frontendTemplates,
    ...fullstackTemplates,
    ...backendTemplates,
    ...mobileTemplates,
    ...otherTemplates,
];

/** Whether it is a backend that can be added to a frontend. */
function isAttachableBackend(t: Template): boolean {
    return t.category === 'Backend' && !!t.port;
}

/** Backends that can be added to a frontend or a mobile app. */
export const attachableBackends = templates.filter(isAttachableBackend);

/**
 * Looks up a template by id.
 * @param id identifier (may be undefined)
 */
export function findTemplate(id: string | undefined): Template | undefined {
    for (const t of templates) {
        if (t.id === id) {
            return t;
        }
    }
    return undefined;
}

/** Dart reserved words (not valid as a Flutter project name). */
// prettier-ignore
const dartKeywords = new Set([
    'abstract', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
    'default', 'do', 'else', 'enum', 'export', 'extends', 'false', 'final', 'for', 'if', 'import', 'in',
    'is', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'var', 'void', 'while', 'with',
]);

/**
 * Checks a project name.
 * @param name typed name
 * @param nameStyle kebab (my-app) or snake (my_app)
 * @returns an error message, or undefined if it is fine
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
 * Turns "My Cool App" into "my-cool-app" (or "my_cool_app").
 * @param input typed text
 * @param nameStyle kebab or snake
 */
export function suggestName(input: string, nameStyle: Template['nameStyle']): string {
    const sep = nameStyle === 'snake' ? '_' : '-';
    return input
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // removes accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, sep)
        .replace(new RegExp(`^[${sep}0-9]+|${sep}+$`, 'g'), '');
}
