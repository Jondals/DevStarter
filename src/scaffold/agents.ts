/**
 * scaffold/agents.ts
 * ──────────────────
 * "AI agent ready" extra: files that let coding agents (Claude Code, GitHub Copilot, Cursor,
 * Codex, Windsurf, Gemini…) understand the project from the first prompt.
 *
 *   AGENTS.md                              the shared, tool-neutral brief (stack, commands,
 *                                          folder map, where new things go, rules)
 *   CLAUDE.md / GEMINI.md                  one-line pointers to AGENTS.md
 *   .github/copilot-instructions.md        same, for GitHub Copilot
 *   .claude/commands/*.md                  reusable prompts: /new-feature, /review, /explain
 *   .github/prompts/*.prompt.md            the same prompts for Copilot Chat
 *
 * Written at the end of the build, so the folder map shows what the generators really created.
 */
import * as fs from 'fs';
import * as path from 'path';
import { PackageManager } from '../tools';
import { write } from './files';
import { DevServer } from './extras';

/** One part of the project (the whole project, or frontend / backend of a full-stack one). */
export interface AgentPart {
    label: string;
    /** Folder relative to the root ('' for the root itself). */
    folder: string;
    templateId: string;
    templateLabel: string;
    docs: string;
}

/** What the agent files need to know about the project. */
export interface AgentInfo {
    name: string;
    stack: string;
    typescript: boolean;
    beginner: boolean;
    pm: PackageManager;
    parts: AgentPart[];
    servers: DevServer[];
    devAll?: string;
    database?: string;
    libraries: string[];
    notes: string[];
}

/** Folders never worth showing (dependencies, caches, build output). */
const SKIP = new Set([
    'node_modules',
    '.git',
    '.venv',
    'venv',
    '__pycache__',
    'dist',
    'build',
    'out',
    'coverage',
    '.next',
    '.nuxt',
    '.output',
    '.svelte-kit',
    '.astro',
    '.angular',
    '.expo',
    '.dart_tool',
    'vendor',
    'target',
    'bin',
    'obj',
    '.idea',
    '.gradle',
]);

/**
 * Draws a folder tree (folders first, a few levels deep, long lists cut short).
 * @param dir folder to draw
 * @param depth levels still allowed
 * @param prefix indentation of this level
 */
function tree(dir: string, depth: number, prefix = ''): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
    const visible = entries.filter(function (e) {
        return !SKIP.has(e.name) && e.name !== '.DS_Store';
    });
    visible.sort(function (a, b) {
        if (a.isDirectory() !== b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
    const limit = 14;
    const lines: string[] = [];
    visible.slice(0, limit).forEach(function (e, i) {
        const last = i === Math.min(visible.length, limit) - 1 && visible.length <= limit;
        lines.push(`${prefix}${last ? '└── ' : '├── '}${e.name}${e.isDirectory() ? '/' : ''}`);
        if (e.isDirectory() && depth > 1) {
            lines.push(...tree(path.join(dir, e.name), depth - 1, prefix + (last ? '    ' : '│   ')));
        }
    });
    if (visible.length > limit) {
        lines.push(`${prefix}└── … ${visible.length - limit} more`);
    }
    return lines;
}

/**
 * Scripts of a package.json, turned into the commands to type ("pnpm build").
 * @param dir folder of the package.json
 * @param pm package manager
 */
function scripts(dir: string, pm: PackageManager): Array<[string, string]> {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
            scripts?: Record<string, string>;
        };
        const result: Array<[string, string]> = [];
        for (const name of Object.keys(pkg.scripts ?? {})) {
            result.push([pm.run(name), pkg.scripts![name]]);
        }
        return result;
    } catch {
        return [];
    }
}

/** Where new code goes, per template. The agent follows this instead of inventing a layout. */
const placement: Record<string, string[]> = {
    react: [
        'UI components → `src/components/<Name>.tsx` (one component per file, PascalCase)',
        'Pages / screens → `src/pages/`',
        'Custom hooks → `src/hooks/useSomething.ts`',
        'Helpers, API clients and shared logic → `src/lib/`',
        'Images and fonts → `src/assets/` (imported) or `public/` (served as-is)',
    ],
    vue: [
        'UI components → `src/components/<Name>.vue` (PascalCase)',
        'Pages / screens → `src/views/`',
        'Composables → `src/composables/useSomething.ts`',
        'Helpers and API clients → `src/lib/`',
    ],
    svelte: [
        'UI components → `src/lib/components/<Name>.svelte`',
        'Shared logic and stores → `src/lib/`',
        'The root component is `src/App.svelte`',
    ],
    vanilla: [
        'JavaScript modules → `src/` (import them from `src/main`)',
        'Styles → `src/style.css`',
        'Static files served as-is → `public/`',
    ],
    angular: [
        'Generate code with the CLI instead of writing files by hand:',
        '`ng generate component <name>` · `ng generate service <name>` · `ng generate guard <name>`',
        'Group each feature in its own folder under `src/app/<feature>/`',
    ],
    next: [
        'Routes are folders under `app/` (or `src/app/`): `app/about/page.tsx` → `/about`',
        'API endpoints → `app/api/<name>/route.ts`',
        'Reusable components → `components/` · helpers and data access → `lib/`',
        'Components are Server Components by default; add `"use client"` only when they need state or events',
    ],
    nuxt: [
        'Pages → `pages/` (file-based routing) · components → `components/` (auto-imported)',
        'Composables → `composables/` · API endpoints → `server/api/<name>.ts`',
    ],
    sveltekit: [
        'Pages → `src/routes/<path>/+page.svelte` · data loading → `+page.server.ts`',
        'API endpoints → `src/routes/api/<name>/+server.ts`',
        'Components and shared code → `src/lib/` (import with `$lib/...`)',
    ],
    astro: [
        'Pages → `src/pages/` (file-based routing) · layouts → `src/layouts/`',
        'Components → `src/components/` · Markdown / MDX content → `src/content/`',
    ],
    express: [
        'Keep the app setup in the main file; put each group of endpoints in `routes/<name>.js` as an `express.Router()`',
        'Database access and business logic → `services/` or `lib/`, never inside route handlers',
        'All endpoints live under `/api`',
    ],
    nest: [
        'Generate a full feature with `nest g resource <name>` (module, controller, service, DTOs)',
        'Keep business logic in services, HTTP details in controllers',
    ],
    fastapi: [
        'Group endpoints in `APIRouter` modules under `routers/<name>.py` and include them in `main.py`',
        'Request / response models → `schemas.py` (Pydantic) · database models → `models.py`',
    ],
    flask: [
        'Group endpoints in Blueprints under `routes/<name>.py` and register them in the app',
        'Templates → `templates/` · static files → `static/`',
    ],
    django: [
        'Create each feature as an app: `python manage.py startapp <name>` and add it to `INSTALLED_APPS`',
        'After changing models: `python manage.py makemigrations` then `python manage.py migrate`',
    ],
    laravel: [
        'Generate code with artisan: `php artisan make:model <Name> -mcr` (model, migration, controller)',
        'Web routes → `routes/web.php` · API routes → `routes/api.php` · views → `resources/views/`',
    ],
    go: [
        'Entry point in `main.go`; put packages under `internal/<name>/`',
        'Handlers → `internal/handlers/` · data access → `internal/store/`',
    ],
    dotnet: [
        'Endpoints are declared in `Program.cs`; move groups of them to `Endpoints/<Name>Endpoints.cs` as extension methods',
        'Models → `Models/` · services → `Services/` (register them in the DI container)',
    ],
    rust: ['Entry point in `src/main.rs`; split code into modules under `src/<name>.rs`'],
    spring: [
        'Code lives in the base package under `src/main/java/`',
        'Controllers (`@RestController`), services (`@Service`) and repositories in their own sub-packages',
    ],
    expo: [
        'Screens are files under `app/` (Expo Router): `app/settings.tsx` → `/settings`',
        'Reusable components → `components/` · hooks → `hooks/` · constants and theme → `constants/`',
    ],
    flutter: [
        'Code lives in `lib/`: screens → `lib/screens/`, reusable widgets → `lib/widgets/`, models → `lib/models/`',
        'Run `flutter analyze` before finishing',
    ],
    solid: [
        'Components → `src/components/<Name>.tsx`; shared state with signals/stores in `src/lib/`',
        'Remember: Solid components run once; use signals (`createSignal`) for anything that changes',
    ],
    preact: ['Components → `src/components/<Name>.tsx` · helpers → `src/lib/`', 'Use hooks from `preact/hooks`'],
    lit: ['Each custom element in its own file under `src/` (`<my-thing>` → `src/my-thing.ts`)'],
    'react-router': [
        'Declare every page in `app/routes.ts`; its code goes in `app/routes/<name>.tsx`',
        'Load data with a `loader` and handle forms with an `action` in the same route file',
        'Reusable components → `app/components/`',
    ],
    fastify: [
        'Group endpoints in plugins under `src/routes/<name>.js` and register them with `app.register()`',
        'Validate request bodies with JSON schemas in the route options',
    ],
    hono: ['Group endpoints in `src/routes/<name>.js` as `new Hono()` apps and mount them with `app.route()`'],
    electron: [
        '`src/main` runs the window (Node.js); the page lives in `index.html` + `src/renderer`',
        'Expose Node features to the page only through `src/preload` (contextBridge), never by enabling nodeIntegration',
    ],
    tauri: [
        'The interface is a React app in `src/`; native features are Rust commands in `src-tauri/src/lib.rs`',
        'Call Rust from the page with `invoke("command_name")` from `@tauri-apps/api/core`',
    ],
    wxt: [
        'Each part is an entrypoint: popup → `entrypoints/popup/`, page scripts → `entrypoints/<name>.content.ts`, background → `entrypoints/background.ts`',
        'Permissions go in `wxt.config.ts` (manifest)',
    ],
    'discord-bot': [
        'Keep the client setup in `src/index.js`; put each command in `src/commands/<name>.js`',
        'The bot token lives only in `.env` (DISCORD_TOKEN)',
    ],
    'node-script': ['Main file in the project root; split helpers into their own modules next to it'],
    'python-script': ['Main script in the project root; split helpers into their own modules next to it'],
};

/**
 * Commands section of AGENTS.md.
 * @param root project root
 * @param info project data
 */
function commandsSection(root: string, info: AgentInfo): string {
    const lines: string[] = [];
    if (info.devAll) {
        lines.push(`- \`${info.devAll}\` (from the root): starts every part at once`);
    }
    for (const s of info.servers) {
        const where = s.folder ? ` (in \`${s.folder}/\`)` : '';
        lines.push(
            `- \`${s.command}\`${where}: starts the ${s.label.toLowerCase()} dev server${s.url ? ` on ${s.url}` : ''}`,
        );
    }
    for (const part of info.parts) {
        const dir = path.join(root, part.folder);
        const found = scripts(dir, info.pm).filter(function (s) {
            return !/^(dev|start)$/.test(s[0].split(' ').pop() ?? '');
        });
        for (const [command, raw] of found) {
            const where = part.folder ? ` (in \`${part.folder}/\`)` : '';
            lines.push(`- \`${command}\`${where}: runs \`${raw}\``);
        }
        if (fs.existsSync(path.join(dir, '.venv'))) {
            const activate = process.platform === 'win32' ? '.venv\\Scripts\\activate' : 'source .venv/bin/activate';
            const where = part.folder ? ` in \`${part.folder}/\`` : '';
            lines.push(
                `- Python uses a virtual environment${where}: activate it with \`${activate}\` before running Python commands`,
            );
        }
    }
    return lines.length ? lines.join('\n') : '- No build step: open the files and edit them.';
}

/**
 * AGENTS.md content.
 * @param root project root
 * @param info project data
 */
function agentsMd(root: string, info: AgentInfo): string {
    const placementLines: string[] = [];
    for (const part of info.parts) {
        const rules = placement[part.templateId];
        if (!rules) {
            continue;
        }
        if (info.parts.length > 1) {
            placementLines.push(`**${part.label}** (\`${part.folder}/\`, ${part.templateLabel})`, '');
        }
        for (const r of rules) {
            placementLines.push(`- ${r}`);
        }
        placementLines.push('');
    }
    const facts: string[] = [`- Stack: ${info.stack}`];
    facts.push(
        `- Language: ${info.typescript ? 'TypeScript (strict types, no `any`)' : 'JavaScript / the stack default'}`,
    );
    if (info.database) {
        facts.push(`- Database: ${info.database} (connection settings in \`.env\`, never hard-coded)`);
    }
    if (info.libraries.length) {
        facts.push(`- Libraries already installed: ${info.libraries.join(', ')}. Prefer them over adding new ones.`);
    }
    facts.push(`- Package manager: \`${info.pm.id}\` (do not mix in another one; it would create a second lockfile)`);
    const docs = info.parts.map(function (p) {
        return `- ${p.templateLabel}: ${p.docs}`;
    });
    const beginnerRule = info.beginner
        ? [
              '- The owner of this project is learning to code. Explain each change in plain words, keep',
              '  changes small, and suggest what to try next. Never apply large refactors without asking.',
          ]
        : [];
    return [
        `# ${info.name}`,
        '',
        'Instructions for AI coding agents (Claude Code, GitHub Copilot, Cursor, Codex, Windsurf, Gemini…).',
        'Humans: see README.md or GETTING_STARTED.md.',
        '',
        '## Project',
        '',
        ...facts,
        '',
        '## Commands',
        '',
        commandsSection(root, info),
        '',
        '## Folder map',
        '',
        '```',
        `${info.name}/`,
        ...tree(root, 3),
        '```',
        '',
        '## Where new code goes',
        '',
        ...(placementLines.length ? placementLines : ['- Follow the layout above; keep related files together.', '']),
        '## Rules',
        '',
        '- Match the existing style, naming and folder layout before inventing new ones.',
        '- Secrets and URLs go in `.env` (git-ignored). Add every new variable to `.env.example` too.',
        '- Do not edit lockfiles, generated folders or files under `node_modules/`, `.venv/`, `dist/` by hand.',
        '- Install packages with the package manager, never by editing the dependency list by hand.',
        '- After a change, run the build / type check / tests listed above and fix what fails before finishing.',
        '- Keep changes focused: one feature or fix at a time, with a short summary of what changed and why.',
        ...beginnerRule,
        ...(info.notes.length
            ? [
                  '',
                  '## Notes',
                  '',
                  ...info.notes.map(function (n) {
                      return `- ${n}`;
                  }),
              ]
            : []),
        '',
        '## Docs',
        '',
        ...docs,
        '',
    ].join('\n');
}

/** Reusable prompts, shared by Claude Code (`/name`) and Copilot Chat (`/name`). */
const prompts: Array<{ name: string; description: string; body: string }> = [
    {
        name: 'new-feature',
        description: 'Plan and build a new feature following the project layout',
        body: [
            'Build this feature: $ARGUMENTS',
            '',
            '1. Read AGENTS.md (stack, commands, folder map and "Where new code goes").',
            '2. Before writing code, list the files you will create or change and why. Reuse existing components, helpers and libraries.',
            '3. Create the structure in the places AGENTS.md defines (components, pages / routes, API endpoints, types, styles).',
            '4. Wire it in: routes, navigation, exports and, if it needs data, the API and database.',
            '5. Run the build / type check / tests from AGENTS.md and fix every error.',
            '6. Finish with a short summary and how to try the feature in the browser or app.',
        ].join('\n'),
    },
    {
        name: 'review',
        description: 'Review the current changes for bugs and clean-ups',
        body: [
            'Review the uncommitted changes (`git diff`) of this project. $ARGUMENTS',
            '',
            '- Look for bugs, missing error handling, security issues (secrets, injections) and broken types first.',
            '- Then point out duplicated code and anything that does not follow AGENTS.md.',
            '- For each finding give the file and line, what is wrong and the fix. Do not change files unless asked.',
        ].join('\n'),
    },
    {
        name: 'explain',
        description: 'Explain a file or concept of this project in plain words',
        body: [
            'Explain $ARGUMENTS in this project, for someone who is still learning.',
            '',
            '- Start with what it does in one sentence, then walk through it step by step.',
            '- Link each idea to the real files of this project.',
            '- End with one small exercise to practise it.',
        ].join('\n'),
    },
];

/**
 * Writes AGENTS.md, the per-tool pointers and the reusable prompts.
 * Existing files are left alone (a generator may have written its own).
 * @param root project root
 * @param info project data
 * @returns paths written, relative to the root
 */
export function writeAgentFiles(root: string, info: AgentInfo): string[] {
    const written: string[] = [];
    /** Writes a file only if it does not exist yet. */
    function put(relative: string, content: string): void {
        const file = path.join(root, relative);
        if (fs.existsSync(file)) {
            return;
        }
        write(file, content);
        written.push(relative.split(path.sep).join('/'));
    }

    put('AGENTS.md', agentsMd(root, info));
    put('CLAUDE.md', '@AGENTS.md\n');
    put('GEMINI.md', '@AGENTS.md\n');
    put(
        path.join('.github', 'copilot-instructions.md'),
        'Follow the project instructions in [AGENTS.md](../AGENTS.md): stack, commands, folder map and rules.\n',
    );
    for (const p of prompts) {
        put(path.join('.claude', 'commands', `${p.name}.md`), `---\ndescription: ${p.description}\n---\n\n${p.body}\n`);
        put(
            path.join('.github', 'prompts', `${p.name}.prompt.md`),
            `---\nmode: agent\ndescription: ${p.description}\n---\n\n${p.body.replace(/\$ARGUMENTS/g, '${input:details}')}\n`,
        );
    }
    return written;
}
