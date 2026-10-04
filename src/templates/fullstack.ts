/**
 * templates/fullstack.ts
 * ──────────────────────
 * Plantillas full-stack: frameworks con frontend y backend en el mismo proyecto
 * (Next.js, Nuxt, SvelteKit y Astro). También contiene nodeDatabaseSteps(),
 * que conecta una base de datos en cualquier proyecto Node.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Step } from '../terminal';
import { allDatabases, nodeEnvLine, nodeModule, nodePackages } from '../scaffold/database';
import { allowPnpmBuild, appendLines, write } from '../scaffold/files';
import { configureNuxtTailwind } from '../scaffold/tailwind';
import { cmd, PartOptions, Plan, scaffold, task, Template } from './types';

/**
 * Pasos comunes para conectar una base de datos en un proyecto Node:
 * escribe los ficheros que nos pasen, añade la variable al .env e instala el driver.
 * @param o opciones del proyecto (si no hay base de datos, no hace nada)
 * @param files ficheros a escribir, {ruta relativa: contenido}
 * @param ts el proyecto usa TypeScript (para instalar los tipos)
 */
export function nodeDatabaseSteps(o: PartOptions, files: Record<string, string>, ts: boolean): Step[] {
    if (!o.database) {
        return [];
    }
    const db = o.database;
    const packages = nodePackages(db, ts);
    const steps: Step[] = [
        task(`Connecting ${db}`, function (log) {
            for (const file of Object.keys(files)) {
                write(path.join(o.dir, file), files[file]);
                log(file);
            }
            // Añadimos la conexión al .env (sin borrar lo que ya hubiera).
            const envFile = path.join(o.dir, '.env');
            const previous = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
            if (!previous.includes('DATABASE_')) {
                appendLines(envFile, nodeEnvLine(db, o.name));
                log('.env');
            }
            if (db === 'SQLite' && o.pm.id === 'pnpm') {
                allowPnpmBuild(o.dir, 'better-sqlite3');
            }
        }),
        cmd(`Installing the ${db} driver`, o.pm.add(packages.deps), o.dir),
    ];
    if (packages.devDeps.length) {
        steps.push(cmd('Installing type definitions', o.pm.add(packages.devDeps, true), o.dir));
    }
    return steps;
}

/** Nota común: dónde está la conexión y cómo probarla. */
function databaseNote(o: PartOptions): string[] {
    return o.database ? [`Your ${o.database} connection is in \`.env\`. Test it at \`/api/db\`.`] : [];
}

/** Pasos de Next.js. */
function nextPlan(o: PartOptions): Plan {
    const ext = o.typescript ? 'ts' : 'js';
    const route = `
import { checkDatabase } from '@/lib/db'

// Never cache this route: it should hit the database on every request.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return Response.json({ ok: true, result: await checkDatabase() })
  } catch (err) {
    return Response.json({ ok: false, error: ${o.typescript ? '(err as Error)' : 'err'}.message }, { status: 500 })
  }
}
`;
    return {
        steps: [
            scaffold(
                o,
                'Creating Next.js project and installing dependencies',
                'create-next-app',
                [
                    o.folder,
                    o.typescript ? '--ts' : '--js',
                    o.tailwind ? '--tailwind' : '--no-tailwind',
                    '--eslint',
                    '--app',
                    '--src-dir',
                    '--import-alias',
                    '"@/*"',
                    `--use-${o.pm.id}`,
                    '--disable-git',
                    '--yes',
                ],
                o.parentDir,
            ),
            ...nodeDatabaseSteps(
                o,
                {
                    [`src/lib/db.${ext}`]: nodeModule(o.database ?? 'SQLite', { ts: o.typescript }),
                    [`src/app/api/db/route.${ext}`]: route,
                },
                o.typescript,
            ),
        ],
        server: { command: o.pm.run('dev'), url: 'http://localhost:3000' },
        mainFiles: [`src/app/page.${o.typescript ? 'tsx' : 'js'}`],
        notes: [
            'Every folder inside `src/app` with a `page` file becomes a route (e.g. `src/app/about/page` → `/about`).',
            'Create API endpoints with `route` files, e.g. `src/app/api/hello/route`.',
            ...databaseNote(o),
        ],
    };
}

/** Pasos de Nuxt. */
function nuxtPlan(o: PartOptions): Plan {
    const steps: Step[] = [
        scaffold(
            o,
            'Creating Nuxt project and installing dependencies',
            'create-nuxt',
            [
                o.folder,
                '--template',
                'minimal',
                '--packageManager',
                o.pm.id,
                '--gitInit=false',
                '--install',
                '--no-modules',
            ],
            o.parentDir,
        ),
    ];
    if (o.tailwind) {
        steps.push(
            cmd('Installing Tailwind CSS', o.pm.add(['tailwindcss', '@tailwindcss/vite'], true), o.dir),
            task('Configuring Tailwind CSS', function () {
                configureNuxtTailwind(o.dir);
            }),
        );
    }
    steps.push(
        ...nodeDatabaseSteps(
            o,
            {
                'server/utils/db.ts': nodeModule(o.database ?? 'SQLite', { ts: true }),
                'server/api/db.get.ts': `
import { checkDatabase } from '../utils/db'

export default defineEventHandler(async () => ({ ok: true, result: await checkDatabase() }))
`,
            },
            true,
        ),
    );
    return {
        steps,
        server: { command: o.pm.run('dev'), url: 'http://localhost:3000' },
        mainFiles: ['app/app.vue'],
        notes: [
            'Files in `app/pages` become routes once you create that folder.',
            'API endpoints live in `server/api` (e.g. `server/api/hello.get.ts` → `/api/hello`).',
            ...databaseNote(o),
        ],
    };
}

/** Pasos de SvelteKit. */
function sveltekitPlan(o: PartOptions): Plan {
    const ext = o.typescript ? 'ts' : 'js';
    return {
        steps: [
            scaffold(
                o,
                'Creating SvelteKit project and installing dependencies',
                'sv',
                [
                    'create',
                    o.folder,
                    '--template',
                    'minimal',
                    '--types',
                    o.typescript ? 'ts' : 'jsdoc',
                    ...(o.tailwind ? ['--add', 'tailwindcss="plugins:none"'] : ['--no-add-ons']),
                    '--install',
                    o.pm.id,
                ],
                o.parentDir,
            ),
            // Importación relativa (y no $lib/#lib) para que funcione en SvelteKit 2 y 3.
            ...nodeDatabaseSteps(
                o,
                {
                    // SvelteKit lee las variables privadas del .env con $env/dynamic/private.
                    [`src/lib/server/db.${ext}`]: nodeModule(o.database ?? 'SQLite', {
                        ts: o.typescript,
                        env: 'env',
                        header: "import { env } from '$env/dynamic/private'",
                    }),
                    [`src/routes/api/db/+server.${ext}`]: `
import { json } from '@sveltejs/kit'
import { checkDatabase } from '../../../lib/server/db'

export async function GET() {
  return json({ ok: true, result: await checkDatabase() })
}
`,
                },
                o.typescript,
            ),
        ],
        server: { command: o.pm.run('dev'), url: 'http://localhost:5173' },
        mainFiles: ['src/routes/+page.svelte'],
        notes: [
            'Every folder in `src/routes` with a `+page.svelte` becomes a page.',
            'Server endpoints are `+server` files, e.g. `src/routes/api/hello/+server`.',
            ...databaseNote(o),
        ],
    };
}

/** Pasos de Astro. */
function astroPlan(o: PartOptions): Plan {
    const steps: Step[] = [
        scaffold(
            o,
            'Creating Astro project and installing dependencies',
            'create-astro',
            [o.folder, '--template', 'minimal', '--install', '--no-git', '--yes', '--skip-houston'],
            o.parentDir,
        ),
    ];
    if (o.tailwind) {
        steps.push(cmd('Adding Tailwind CSS', o.pm.bin('astro', ['add', 'tailwind', '--yes']), o.dir));
    }
    return {
        steps,
        server: { command: o.pm.run('dev'), url: 'http://localhost:4321' },
        mainFiles: ['src/pages/index.astro'],
        notes: [
            'Every file in `src/pages` becomes a page of your site.',
            'Write Markdown files in `src/pages` to publish blog posts.',
        ],
    };
}

const tailwindExt = 'bradlc.vscode-tailwindcss';

export const fullstackTemplates: Template[] = [
    {
        id: 'next',
        label: 'Next.js',
        icon: 'triangle-up',
        category: 'Full-stack',
        description: 'React framework',
        detail: 'React with routing, server rendering and API routes built in. Used by many companies.',
        recommended: true,
        languages: true,
        tailwind: true,
        databases: allDatabases,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://nextjs.org/learn',
        vscode: ['dbaeumer.vscode-eslint', tailwindExt],
        plan: nextPlan,
    },
    {
        id: 'nuxt',
        label: 'Nuxt',
        icon: 'symbol-color',
        category: 'Full-stack',
        description: 'Vue framework',
        detail: 'Vue with file-based routing, server API routes and great defaults.',
        tailwind: true,
        databases: allDatabases,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://nuxt.com/docs/getting-started/introduction',
        vscode: ['Vue.volar', tailwindExt],
        plan: nuxtPlan,
    },
    {
        id: 'sveltekit',
        label: 'SvelteKit',
        icon: 'flame',
        category: 'Full-stack',
        description: 'Svelte framework',
        detail: 'Svelte with routing, server-side code and API endpoints.',
        languages: true,
        tailwind: true,
        databases: allDatabases,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://svelte.dev/docs/kit/introduction',
        vscode: ['svelte.svelte-vscode', tailwindExt],
        plan: sveltekitPlan,
    },
    {
        id: 'astro',
        label: 'Astro',
        icon: 'star-full',
        category: 'Full-stack',
        description: 'Content sites',
        detail: 'Ideal for blogs, portfolios and landing pages. Very fast by default.',
        tailwind: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://docs.astro.build/en/tutorial/0-introduction/',
        vscode: ['astro-build.astro-vscode', tailwindExt],
        plan: astroPlan,
    },
];
