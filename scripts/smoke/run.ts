/**
 * scripts/smoke/run.ts
 * ────────────────────
 * "Smoke test" de mantenimiento: crea proyectos reales con los generadores más usados
 * (create-vite, create-next-app, sv, create-astro, @nestjs/cli…) y comprueba que siguen
 * funcionando con sus últimas versiones. Si un generador cambia sus opciones y se rompe,
 * este script lo detecta antes que los usuarios.
 *
 *   pnpm smoke                    → todos los casos
 *   pnpm smoke react next         → solo los casos indicados
 *   SMOKE_VERBOSE=1 pnpm smoke    → ver la salida del terminal
 *
 * Lo ejecuta cada semana el workflow .github/workflows/scaffolders.yml.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DevStarterTerminal } from '../../src/terminal';
import { findTemplate } from '../../src/templates';
import { detectTool, packageManager } from '../../src/tools';
import { buildProject, ProjectChoice } from '../../src/project';
import { Database } from '../../src/scaffold/database';

/** Un caso de prueba: qué proyecto crear. */
interface SmokeCase {
    id: string;
    template: string;
    backend?: string;
    database?: Database;
    libraries?: string[];
    typescript?: boolean;
    /** Necesita Python instalado. */
    python?: boolean;
}

const cases: SmokeCase[] = [
    { id: 'vanilla-3d', template: 'vanilla', typescript: false, libraries: ['three', 'gsap'] },
    { id: 'react-express', template: 'react', backend: 'express', database: 'SQLite', libraries: ['zustand', 'helmet'] },
    { id: 'vue', template: 'vue', libraries: ['pinia', 'vitest'] },
    { id: 'svelte', template: 'svelte' },
    { id: 'next', template: 'next', database: 'SQLite' },
    { id: 'sveltekit', template: 'sveltekit', database: 'SQLite' },
    { id: 'nuxt', template: 'nuxt' },
    { id: 'astro', template: 'astro', libraries: ['astro-mdx'] },
    { id: 'nest', template: 'nest', database: 'PostgreSQL' },
    { id: 'angular', template: 'angular' },
    { id: 'expo', template: 'expo' },
    { id: 'fastapi', template: 'fastapi', database: 'SQLite', libraries: ['pytest-fastapi'], python: true },
    { id: 'django', template: 'django', libraries: ['drf'], python: true },
];

/**
 * Crea un proyecto y devuelve si ha ido bien.
 * @param c caso de prueba
 * @param parentDir carpeta donde crearlo
 * @param python comando de Python (si está instalado)
 */
async function runCase(c: SmokeCase, parentDir: string, python: string | undefined): Promise<boolean> {
    const template = findTemplate(c.template);
    if (!template) {
        throw new Error(`Unknown template ${c.template}`);
    }
    const choice: ProjectChoice = {
        template,
        backend: findTemplate(c.backend),
        typescript: c.typescript ?? true,
        tailwind: !!template.tailwind,
        database: c.database,
        libraries: c.libraries ?? [],
        extras: ['git'],
        pm: packageManager('npm', 'installed'),
        name: `smoke-${c.id}`,
        parentDir,
        beginner: true,
    };
    const project = buildProject(choice, python);
    const term = await DevStarterTerminal.create(c.id, { verbose: false, beginner: true });
    const result = await term.runSteps(project.steps);
    term.finish();
    return result === 'success';
}

/** Ejecuta los casos pedidos (o todos) y termina con código 1 si alguno falla. */
async function main(): Promise<void> {
    const wanted = process.argv.slice(2);
    const selected = wanted.length ? cases.filter(isWanted) : cases;
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-smoke-'));
    const python = (await detectTool('python')).command;
    const results: Array<[string, string]> = [];

    /** ¿Se ha pedido este caso por línea de comandos? */
    function isWanted(c: SmokeCase): boolean {
        return wanted.includes(c.id);
    }

    for (const c of selected) {
        if (c.python && !python) {
            results.push([c.id, 'skipped (no Python)']);
            continue;
        }
        const started = Date.now();
        process.stdout.write(`▸ ${c.id}… `);
        let ok = false;
        try {
            ok = await runCase(c, parentDir, python);
        } catch (err) {
            console.log(err);
        }
        const secs = Math.round((Date.now() - started) / 1000);
        console.log(ok ? `ok (${secs}s)` : `FAILED (${secs}s)`);
        results.push([c.id, ok ? 'ok' : 'FAILED']);
    }

    console.log('\nSummary');
    for (const [id, status] of results) {
        console.log(`  ${status === 'ok' ? '✔' : status === 'FAILED' ? '✗' : '–'} ${id.padEnd(16)} ${status}`);
    }
    console.log(`\nProjects left in ${parentDir} for inspection.`);
    const failed = results.filter(isFailed).length;
    process.exit(failed ? 1 : 0);
}

/** ¿Este resultado es un fallo? */
function isFailed(result: [string, string]): boolean {
    return result[1] === 'FAILED';
}

void main();
