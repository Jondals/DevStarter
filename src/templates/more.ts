/**
 * templates/more.ts
 * ─────────────────
 * More of the most used stacks:
 *   Full-stack · React Router (formerly Remix)
 *   Backend    · Fastify and Hono (light Node.js APIs)
 *   Desktop    · Electron, Tauri and browser extensions (WXT)
 *   Other      · Discord bot
 *
 * Generators are used whenever an official one exists; the small APIs and the bot are written
 * by hand so they always come with the same /api/health endpoint and .env setup as the rest.
 */
import * as path from 'path';
import { write } from '../scaffold/files';
import { cmd, makeDir, PartOptions, Plan, scaffold, task, Template } from './types';

const nodeGitignore = 'node_modules/\ndist/\n.env\n*.log\n.DS_Store\n';

/**
 * Writes package.json, .env and .gitignore of a small Node.js project.
 * @param o project options
 * @param env lines of the .env file
 */
function writeNodeBase(o: PartOptions, env: string): void {
    const pkg = {
        name: o.packageName,
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
            // ? --watch restarts on save; --env-file loads .env.
            dev: 'node --watch --env-file=.env src/index.js',
            start: 'node --env-file=.env src/index.js',
        },
    };
    write(path.join(o.dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    write(path.join(o.dir, '.env'), env);
    write(path.join(o.dir, '.env.example'), env.replace(/=.*$/gm, '='));
    write(path.join(o.dir, '.gitignore'), nodeGitignore);
}

// ─── React Router (Remix) ───────────────────────────────────────────

function reactRouterPlan(o: PartOptions): Plan {
    return {
        steps: [
            scaffold(
                o,
                'Creating React Router app',
                'create-react-router',
                [o.folder, '--yes', '--no-git-init', '--no-install'],
                o.parentDir,
            ),
            cmd('Installing dependencies', o.pm.install(), o.dir),
        ],
        server: { command: o.pm.run('dev'), url: 'http://localhost:5173' },
        mainFiles: ['app/routes/home.tsx', 'app/root.tsx'],
        notes: [
            'Each page is a route declared in `app/routes.ts`; its code lives in `app/routes/`.',
            'Load data on the server with a `loader` function in the same file as the page.',
            'Tailwind CSS is already included.',
        ],
    };
}

// ─── Fastify ────────────────────────────────────────────────────────

function fastifyPlan(o: PartOptions): Plan {
    return {
        steps: [
            task('Writing API files', function (log) {
                writeNodeBase(o, 'PORT=3000\n');
                write(
                    path.join(o.dir, 'src', 'index.js'),
                    `
import Fastify from 'fastify'
import cors from '@fastify/cors'

const app = Fastify({ logger: true })
await app.register(cors)

app.get('/', async () => ({ message: 'Hello from ${o.name}!' }))

app.get('/api/health', async () => ({ status: 'ok', time: new Date().toISOString() }))

const todos = [{ id: 1, title: 'Try the API', done: false }]
app.get('/api/todos', async () => todos)

const port = Number(process.env.PORT ?? 3000)
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
`,
                );
                log('src/index.js and .env');
            }),
            cmd('Installing Fastify', o.pm.add(['fastify', '@fastify/cors']), o.dir),
        ],
        server: { command: o.pm.run('dev'), url: 'http://localhost:3000' },
        mainFiles: ['src/index.js'],
        notes: [
            'The server restarts automatically when you save.',
            'Try the endpoints: `/`, `/api/health` and `/api/todos`.',
        ],
    };
}

// ─── Hono ───────────────────────────────────────────────────────────

function honoPlan(o: PartOptions): Plan {
    return {
        steps: [
            task('Writing API files', function (log) {
                writeNodeBase(o, 'PORT=3000\n');
                write(
                    path.join(o.dir, 'src', 'index.js'),
                    `
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

const app = new Hono()
app.use('/api/*', cors())

app.get('/', (c) => c.json({ message: 'Hello from ${o.name}!' }))

app.get('/api/health', (c) => c.json({ status: 'ok', time: new Date().toISOString() }))

const todos = [{ id: 1, title: 'Try the API', done: false }]
app.get('/api/todos', (c) => c.json(todos))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(\`API running on http://localhost:\${info.port}\`)
})
`,
                );
                log('src/index.js and .env');
            }),
            cmd('Installing Hono', o.pm.add(['hono', '@hono/node-server']), o.dir),
        ],
        server: { command: o.pm.run('dev'), url: 'http://localhost:3000' },
        mainFiles: ['src/index.js'],
        notes: [
            'Hono runs the same code on Node.js, Bun, Deno and edge platforms like Cloudflare Workers.',
            'Try the endpoints: `/`, `/api/health` and `/api/todos`.',
        ],
    };
}

// ─── Electron ───────────────────────────────────────────────────────

function electronPlan(o: PartOptions): Plan {
    return {
        steps: [
            scaffold(
                o,
                'Creating Electron app (Electron Forge, installs dependencies)',
                'create-electron-app',
                // ! Forge 8 replaced the "vite-typescript" template with "--template vite --typescript".
                [o.folder, '--template', 'vite', ...(o.typescript ? ['--typescript'] : [])],
                o.parentDir,
            ),
        ],
        server: { command: o.pm.run('start') },
        mainFiles: [
            `src/renderer.${o.typescript ? 'ts' : 'js'}`,
            'index.html',
            `src/main.${o.typescript ? 'ts' : 'js'}`,
        ],
        notes: [
            '`src/main` runs the app window (Node.js); `index.html` and `src/renderer` are the page inside it.',
            `Build an installer with \`${o.pm.run('make')}\`.`,
        ],
    };
}

// ─── Tauri ──────────────────────────────────────────────────────────

function tauriPlan(o: PartOptions): Plan {
    const identifier = `com.devstarter.${o.packageName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'app'}`;
    return {
        steps: [
            scaffold(
                o,
                'Creating Tauri app',
                'create-tauri-app',
                [
                    o.folder,
                    '--template',
                    o.typescript ? 'react-ts' : 'react',
                    '--manager',
                    o.pm.id,
                    '--identifier',
                    identifier,
                    '--yes',
                ],
                o.parentDir,
            ),
            cmd('Installing dependencies', o.pm.install(), o.dir),
        ],
        server: { command: o.pm.run('tauri dev') },
        mainFiles: [`src/App.${o.typescript ? 'tsx' : 'jsx'}`, 'src-tauri/src/lib.rs'],
        notes: [
            'The window is a web page (`src/`); native code lives in `src-tauri/` (Rust).',
            'The first `tauri dev` compiles Rust and takes a few minutes; later runs are fast.',
            'On Windows Tauri also needs the "Desktop development with C++" build tools: https://v2.tauri.app/start/prerequisites/',
        ],
    };
}

// ─── Browser extension (WXT) ────────────────────────────────────────

function wxtPlan(o: PartOptions): Plan {
    return {
        steps: [
            scaffold(
                o,
                'Creating browser extension (WXT)',
                'wxt',
                ['init', o.folder, '-t', 'react', '--pm', o.pm.id],
                o.parentDir,
            ),
            cmd('Installing dependencies', o.pm.install(), o.dir),
        ],
        server: { command: o.pm.run('dev') },
        mainFiles: ['entrypoints/popup/App.tsx', 'entrypoints/content.ts', 'entrypoints/background.ts'],
        notes: [
            '`dev` opens a browser with your extension already loaded and reloads it on save.',
            'The popup is in `entrypoints/popup/`; code that runs on web pages goes in `entrypoints/content.ts`.',
            `Package it for the Chrome Web Store with \`${o.pm.run('zip')}\`.`,
        ],
    };
}

// ─── Discord bot ────────────────────────────────────────────────────

function discordPlan(o: PartOptions): Plan {
    return {
        steps: [
            makeDir(o.dir),
            task('Writing bot files', function (log) {
                writeNodeBase(o, 'DISCORD_TOKEN=paste-your-bot-token-here\n');
                write(
                    path.join(o.dir, 'src', 'index.js'),
                    `
import { Client, Events, GatewayIntentBits } from 'discord.js'

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
})

client.once(Events.ClientReady, (bot) => {
  console.log(\`Logged in as \${bot.user.tag}\`)
})

// Replies "pong" when someone writes "!ping"
client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return
  if (message.content === '!ping') {
    message.reply('pong 🏓')
  }
})

client.login(process.env.DISCORD_TOKEN)
`,
                );
                log('src/index.js and .env');
            }),
            cmd('Installing discord.js', o.pm.add(['discord.js']), o.dir),
        ],
        server: { command: o.pm.run('dev') },
        mainFiles: ['src/index.js', '.env'],
        notes: [
            'Create the bot at https://discord.com/developers/applications → Bot → Reset Token, and paste it in `.env`.',
            'In the same page turn on "Message Content Intent", then invite the bot with OAuth2 → URL Generator (scope: bot).',
            'Write `!ping` in your server and the bot answers `pong`.',
        ],
    };
}

// ─── Catalog ────────────────────────────────────────────────────────

const tailwindExt = 'bradlc.vscode-tailwindcss';

export const moreFullstackTemplates: Template[] = [
    {
        id: 'react-router',
        label: 'React Router',
        icon: 'git-merge',
        category: 'Full-stack',
        description: 'React framework · ex Remix',
        detail: 'Full React apps with pages, data loading and forms on the server. Tailwind included.',
        rank: 2,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://reactrouter.com/start/framework/installation',
        vscode: ['dbaeumer.vscode-eslint', tailwindExt],
        plan: reactRouterPlan,
    },
];

export const moreBackendTemplates: Template[] = [
    {
        id: 'fastify',
        label: 'Fastify',
        icon: 'rocket',
        category: 'Backend',
        description: 'Node.js · fast',
        detail: 'Like Express, but faster and with built-in validation and logging.',
        rank: 10,
        port: 3000,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://fastify.dev/docs/latest/Guides/Getting-Started/',
        vscode: [],
        plan: fastifyPlan,
    },
    {
        id: 'hono',
        label: 'Hono',
        icon: 'flame',
        category: 'Backend',
        description: 'Node.js · runs anywhere',
        detail: 'A tiny, modern API framework that also runs on Bun, Deno and Cloudflare Workers.',
        rank: 11,
        port: 3000,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://hono.dev/docs/getting-started/nodejs',
        vscode: [],
        plan: honoPlan,
    },
];

export const desktopTemplates: Template[] = [
    {
        id: 'electron',
        label: 'Electron',
        icon: 'window',
        category: 'Desktop',
        description: 'Windows, macOS & Linux',
        detail: 'Desktop apps made with web technologies. VS Code, Discord and Slack are built with it.',
        recommended: true,
        rank: 1,
        languages: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://www.electronforge.io/',
        vscode: [],
        plan: electronPlan,
    },
    {
        id: 'tauri',
        label: 'Tauri',
        icon: 'window',
        category: 'Desktop',
        description: 'Tiny & fast · Rust',
        detail: 'Desktop apps with a React interface and a Rust core. Much smaller than Electron.',
        rank: 2,
        languages: true,
        ci: 'node',
        node: true,
        requires: ['node', 'cargo'],
        nameStyle: 'kebab',
        docs: 'https://v2.tauri.app/start/',
        vscode: ['tauri-apps.tauri-vscode', 'rust-lang.rust-analyzer'],
        plan: tauriPlan,
    },
    {
        id: 'wxt',
        label: 'Browser extension',
        icon: 'extensions',
        category: 'Desktop',
        description: 'Chrome, Edge & Firefox',
        detail: 'Add your own features to the browser: a popup, buttons on web pages, and more.',
        rank: 3,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://wxt.dev/guide/introduction.html',
        vscode: [],
        plan: wxtPlan,
    },
];

export const moreOtherTemplates: Template[] = [
    {
        id: 'discord-bot',
        label: 'Discord bot',
        icon: 'comment-discussion',
        category: 'Other',
        description: 'discord.js',
        detail: 'A bot for your Discord server that answers commands. Ready to customize.',
        rank: 3,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://discordjs.guide/',
        vscode: [],
        plan: discordPlan,
    },
];
