/**
 * scripts/smoke/run.ts
 * ────────────────────
 * Maintenance "smoke test": creates real projects with the most used generators
 * (create-vite, create-next-app, sv, create-astro, @nestjs/cli…) and checks that they still
 * work with their latest versions. If a generator changes its options and breaks,
 * this script catches it before users do.
 *
 *   pnpm smoke                    → every case
 *   pnpm smoke react next         → only the given cases
 *   SMOKE_VERBOSE=1 pnpm smoke    → show the terminal output
 *
 * It runs every week in the .github/workflows/scaffolders.yml workflow.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DevStarterTerminal } from '../../src/terminal';
import { findTemplate } from '../../src/templates';
import { detectTool, packageManager } from '../../src/tools';
import { buildProject, ProjectChoice } from '../../src/project';
import { Database } from '../../src/scaffold/database';

/** A test case: which project to create. */
interface SmokeCase {
    id: string;
    template: string;
    backend?: string;
    database?: Database;
    libraries?: string[];
    typescript?: boolean;
    /** Needs Python installed. */
    python?: boolean;
}

const cases: SmokeCase[] = [
    { id: 'vanilla-3d', template: 'vanilla', typescript: false, libraries: ['three', 'gsap'] },
    {
        id: 'react-express',
        template: 'react',
        backend: 'express',
        database: 'SQLite',
        libraries: ['zustand', 'helmet'],
    },
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
    { id: 'solid', template: 'solid' },
    { id: 'preact', template: 'preact' },
    { id: 'lit', template: 'lit' },
    { id: 'react-router', template: 'react-router' },
    { id: 'react-fastify', template: 'react', backend: 'fastify', libraries: ['recharts', 'socket-server'] },
    { id: 'hono', template: 'hono', libraries: ['anthropic'] },
    { id: 'electron', template: 'electron' },
    { id: 'wxt', template: 'wxt' },
    { id: 'discord-bot', template: 'discord-bot' },
];

/**
 * Creates a project and tells whether it worked.
 * @param c test case
 * @param parentDir folder to create it in
 * @param python Python command (if installed)
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
        extras: ['git', 'ai'],
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

/** Runs the requested cases (or all of them) and exits with code 1 if any fails. */
async function main(): Promise<void> {
    const wanted = process.argv.slice(2);
    const selected = wanted.length ? cases.filter(isWanted) : cases;
    const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devstarter-smoke-'));
    const python = (await detectTool('python')).command;
    const results: Array<[string, string]> = [];

    /** Whether this case was requested on the command line. */
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

/** Whether this result is a failure. */
function isFailed(result: [string, string]): boolean {
    return result[1] === 'FAILED';
}

void main();
