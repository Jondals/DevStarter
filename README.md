<h1 align="center">DevStarter</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.2-818cf8" alt="version 1.0.2">
  <img src="https://img.shields.io/badge/VS%20Code-%5E1.105-2dd4bf" alt="VS Code ^1.105">
  <img src="https://img.shields.io/badge/templates-24-e879f9" alt="24 templates">
  <img src="https://img.shields.io/badge/libraries-54-38bdf8" alt="54 libraries">
</p>

**Start any project in a few clicks, from a brand-new PC to a running app, even if you have never programmed.**
Just say what you want to make ("a 3D website", "a game", "a blog"…). Developers can also pick the exact stack and skip the boilerplate.

Pick what you want to build. You can add a backend, a database and popular libraries, and DevStarter does the rest:

- installs the tools you're missing,
- runs every command in its own animated terminal,
- connects frontend and backend,
- opens the project with the dev servers already running.

> **Current version: 1.0.2**. See the **Changelog** tab for the full history.

## Features

- **Start from an idea.** No need to know what React or Vite are. Pick one of 11 ideas and DevStarter chooses everything for you:
  - portfolio, landing page with animations, 3D website,
  - browser game, interactive art, blog,
  - web app with a database, website with its own API, website with a map,
  - mobile app, Python automation.
- **Live demos.** Three.js, React Three Fiber, GSAP, p5.js, Phaser and Leaflet come with a demo page that works right away (`http://localhost:5173/demos/`). Look at its code and copy what you like.
- **Works on a fresh machine.** Missing Node.js, Git, Python, PHP, Go, .NET, Rust, Java or the GitHub CLI? DevStarter detects it and installs it for you: winget on Windows, Homebrew on macOS, [php.new](https://php.new) for PHP and Composer. It installs pnpm and bun too. Run **Check My Tools** anytime.
- **Any project.** 24 templates: frontend, full-stack, backend, mobile, scripts or an empty folder.
- **Frontend + backend in one go.** Add any backend to a frontend or mobile app. You get:
  - `frontend/` and `backend/` folders,
  - `/api` requests proxied to the backend,
  - a single `npm run dev` that starts both.
- **Database integration.** SQLite, PostgreSQL, MySQL or MongoDB. DevStarter installs the driver, writes the connection to `.env`, adds a `/api/db` test route and can add a `docker-compose.yml` to start the database.
- **54 popular libraries.** Three.js, GSAP, Phaser, Zustand, TanStack Query, Pinia, Zod, Helmet, Django REST Framework, pytest and more. Many are configured in the code automatically, and the test libraries include an example test that already passes.
- **A terminal you'll enjoy watching.**
  - A spinning arc, shimmering step titles and a progress bar.
  - Tips while you wait (beginners) or live output (experienced).
  - `◆` results with details underneath.
  - Press `v` for full logs and `Ctrl+C` to cancel.
- **Friendly errors that fix themselves.** When something fails, you see the last lines of output and a 💡 explanation. If a framework needs a newer Node.js, DevStarter offers to update Node.js or to use the newest compatible version of the framework, and retries on its own. There's also a **Retry** button.
- **Everything is available, with a recommendation.** Beginners see all frameworks and options, and the best choice for them is marked **⭐ Recommended** (and preselected) in every step.
- **Beginner or experienced mode.**
  - Beginners get explanations, a welcome page and a `GETTING_STARTED.md` guide.
  - Experienced developers get a compact wizard, the exact commands and a root `README.md`.
- **Extras:**
  - Tailwind CSS v4 and Prettier.
  - Git with a first commit, or publish to a private GitHub repository.
  - GitHub Actions CI, Dockerfile and Docker Compose.
  - MIT license, EditorConfig and recommended VS Code extensions.
- **Always up to date.**
  - **Update Project Libraries** updates npm/pnpm/bun, pip, Composer, Cargo, Go and Flutter dependencies, safely or to the latest versions, with a Git checkpoint and a build check. **Frameworks use their official upgrader** (`ng update`, `expo install --fix`, Next.js codemod, `nuxt upgrade`, `@astrojs/upgrade`), which also adapts your code.
  - **Check & Update My Tools** keeps Node.js, npm, pnpm, bun, Git, Python and friends current.
- **Your project starts and opens in your browser by itself.** Frontend and backend each run in their own terminal, and the web opens as soon as the server answers.
- **Repeat last setup** and **Recent Projects** for your everyday workflow.

## Templates

| Category | Templates | Options |
| --- | --- | --- |
| Frontend | React, Vue, Svelte, HTML/CSS/JS (all with Vite), Angular | TypeScript/JavaScript, Tailwind CSS, libraries, **+ any backend** |
| Full-stack | Next.js, Nuxt, SvelteKit, Astro | Tailwind CSS, database (except Astro), libraries |
| Backend | Express, NestJS, FastAPI, Flask, Django, Laravel, Go, .NET Web API, Rust (Axum), Spring Boot | Database, Dockerfile, libraries |
| Mobile | React Native (Expo), Flutter | Libraries, **+ any backend** |
| Other | Node.js script, Python script, Empty project | Libraries |

Databases: SQLite, PostgreSQL, MySQL and MongoDB (Django and Laravel: SQL databases only).
Package managers: npm, pnpm or bun.

<details>
<summary><b>Libraries by stack</b></summary>

| Stack | Libraries |
| --- | --- |
| React / Next.js | Three.js 🎮, React Three Fiber 🎮, GSAP 🎮, p5.js 🎮, Phaser 🎮, Leaflet 🎮, AOS, Swiper, React Router, Zustand, TanStack Query, Motion, React Hook Form + Zod, React Icons, Axios, Day.js, Vitest |
| Vue / Nuxt | Three.js 🎮, GSAP 🎮, p5.js 🎮, Phaser 🎮, Leaflet 🎮, AOS, Swiper, Vue Router, Pinia, VueUse, Axios, Zod, Day.js, Chart.js, Vitest |
| Svelte / SvelteKit | Three.js 🎮, GSAP 🎮, p5.js 🎮, Phaser 🎮, Leaflet 🎮, AOS, Swiper, Lucide icons, Axios, Zod, Day.js, Chart.js, Vitest |
| HTML/CSS/JS | Three.js 🎮, GSAP 🎮, p5.js 🎮, Phaser 🎮, Leaflet 🎮, AOS, Swiper, Axios, Zod, Day.js, Chart.js, Vitest |
| Angular | Three.js, GSAP, Leaflet, AOS, Swiper, Zod, Day.js, Chart.js |
| Astro | Three.js, GSAP, Leaflet, AOS, Swiper, MDX, React components |
| Expo | Zustand, TanStack Query, Axios, Zod |
| Express | Helmet ⚙️, Morgan ⚙️, JWT + bcrypt, Zod |
| NestJS | @nestjs/config, class-validator, Swagger |
| FastAPI | pytest ⚙️, pydantic-settings, Loguru |
| Flask | Flask-CORS ⚙️, pytest ⚙️, Loguru |
| Django | Django REST Framework ⚙️, django-cors-headers ⚙️ |
| Laravel | Laravel Debugbar, Spatie Permission |
| Rust | Serde, tower-http CORS |
| Spring Boot | Actuator, Validation, Lombok |
| Flutter | http, Provider, go_router |
| Node.js script | Chalk, Commander, Zod, Vitest |
| Python script | Requests, Rich, pandas, Loguru, pytest ⚙️ |

⚙️ = configured in the code automatically (Vitest also adds an example test).
🎮 = includes a demo page in Vite projects (React, Vue, Svelte, HTML/CSS/JS). p5.js and Phaser are only offered for those Vite templates.
</details>

## Usage

1. Click **✨ New Project** in the status bar (or `Ctrl+Shift+P` → **DevStarter: New Project**).
2. The first time, tell DevStarter whether you are new to programming or experienced.
3. Pick an idea and just choose the folder and name. Or answer the full wizard: technology, backend, database, libraries, extras and package manager.
4. Watch the DevStarter terminal, then choose **Open Project**. The dev servers start by themselves.

### Commands

| Command | What it does |
| --- | --- |
| `DevStarter: New Project` | Opens the wizard |
| `DevStarter: Check & Update My Tools` | Shows installed tools and their latest versions, installs missing ones and updates outdated ones |
| `DevStarter: Update Project Libraries` | Updates the libraries of the open project (safe or latest), with a Git checkpoint and a build check |
| `DevStarter: Recent Projects` | Reopens a project created with DevStarter |
| `DevStarter: Open Getting Started Guide` | Shows `GETTING_STARTED.md` of the open project |
| `DevStarter: Change Experience Level` | Switch between beginner and experienced mode |
| `DevStarter: Help` | One menu with everything: new project, tools, tour, updates, log and settings |

## Requirements

Only **VS Code**. DevStarter offers to install everything else:

| Tool | Needed for | Automatic install |
| --- | --- | --- |
| Node.js 20.19+ | JavaScript templates | winget / Homebrew |
| pnpm, bun | if you pick them | yes |
| Git | the Git extra | winget / Homebrew |
| GitHub CLI | "Publish to GitHub" (run `gh auth login` once) | winget / Homebrew |
| Python | FastAPI, Flask, Django, Python script | winget / Homebrew |
| PHP + Composer | Laravel | php.new (all systems) |
| Go, .NET SDK, Rust, Java 21 | their templates | winget / Homebrew (Rust also via rustup) |
| Flutter | Flutter | manual ([guide](https://docs.flutter.dev/get-started/install)) |

On Linux, tools other than PHP, Rust, pnpm and bun must be installed with your distribution's package manager. DevStarter shows the link.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `devstarter.experienceLevel` | *(ask)* | `beginner` or `experienced` |
| `devstarter.defaultPackageManager` | `npm` | Package manager selected by default |
| `devstarter.initGit` | `true` | Create a Git repository by default |
| `devstarter.showLiveLogs` | `false` | Show full command output while creating |
| `devstarter.startDevServerOnOpen` | `true` | Start the dev servers when the new project opens |
| `devstarter.showStatusBarButton` | `true` | Show the status bar button |
| `devstarter.afterCreate` | `open` | When the project is ready: `open` it and start the servers, `ask` with buttons, or do `none` |
| `devstarter.openBrowser` | `outside` | Open the app when the dev server is ready: `outside` in your browser, `inside` VS Code, or `off` |
| `devstarter.scaffolderVersions` | `{}` | Pin a generator version if a new release breaks, e.g. `{ "@angular/cli": "21" }` |

## Development

```bash
pnpm install
pnpm watch      # then press F5 ("Run Extension") to open the Extension Development Host
pnpm test       # 55 tests inside VS Code, including click-by-click and end-to-end ones
pnpm test:min   # the same tests inside the minimum VS Code version (1.90)
pnpm smoke      # create real projects with the latest generators (pnpm smoke react next to pick cases)
pnpm format     # format the code with Prettier
pnpm lint       # ESLint (the project style forbids arrow functions)
pnpm package    # production build
pnpm publish:check # check everything and build the .vsix without publishing
```

Every source file starts with a comment that explains what it does, and every function is documented. The comments are in Spanish.

| Path | Purpose |
| --- | --- |
| `src/extension.ts` | Activation: registers the commands (153 lines) |
| `src/commands/` | One module per command: `newProject`, `install` (missing tools), `launch` (open the project, start the servers, open the browser), `tools`, `updateProject`, `recent`, `misc` |
| `src/state.ts` | What the commands share: storage keys, saved data types, VS Code context |
| `src/log.ts` | The DevStarter log and the error handling that replaces VS Code's generic dialog |
| `src/net.ts` | Every download: HTTPS only, time and size limits |
| `src/wizard.ts` | The multi-step QuickPick wizard |
| `src/project.ts` | Combines template + backend + database + libraries + extras into one list of steps |
| `src/templates/` | Template catalog (`frontend`, `fullstack`, `backend`, `other`), `libraries` and `presets` (ideas) |
| `src/scaffold/` | Files DevStarter writes: database, Docker, Tailwind, welcome pages, library demos, CI, license, extras |
| `src/terminal.ts` | The Pseudoterminal: runs steps with animations and error hints |
| `src/tools.ts` | Tool detection, PATH refresh, automatic installers and updaters, npm/pnpm/bun commands |
| `src/updates.ts` | npm-style version ranges, latest and compatible versions from the npm registry, latest Node.js LTS |
| `src/toolupdate.ts` | Updates tools and **checks the version really changed**; official Node.js installer with checksum |
| `src/updater.ts` | The Update Project Libraries command |
| `scripts/smoke/` | Maintenance smoke test (`pnpm smoke`), run weekly by `.github/workflows/scaffolders.yml` |
| `src/ui.ts` | ANSI colors, gradients, shimmer, boxes and the banner |

## Install

Search for **DevStarter** (or *devstarter*, any case) in the Extensions view of **VS Code, Cursor, Windsurf, VSCodium, Trae** or any IDE based on VS Code. It is published in the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Jondals.devstarter) and in [Open VSX](https://open-vsx.org/extension/Jondals/devstarter). It needs VS Code **1.90** or newer (or the equivalent in your IDE).

Or build it yourself and install the `.vsix`:

```bash
pnpm install
pnpm package:vsix
code --install-extension devstarter-1.0.2.vsix
```

The package is tiny (12 files, about 85 KB) and has **no runtime dependencies**.

## Publishing (for maintainers)

One action publishes the same `.vsix` to the **Microsoft Marketplace** and to **Open VSX** (the store of Cursor, Windsurf, VSCodium and others):

1. Bump `version` in `package.json` and add its `## [x.y.z]` entry to `CHANGELOG.md` (the script refuses to publish without it).
2. In VS Code: **Terminal → Run Task → DevStarter: Publish everywhere**. First try **DevStarter: Publish (ensayo)**, which checks and packages without publishing.
3. Paste the two tokens when asked (the input is hidden and never saved):
   - **Microsoft:** an Azure DevOps personal access token with *Marketplace → Manage* (organization: *All accessible organizations*).
   - **Open VSX:** a token from open-vsx.org → your profile → *Access Tokens*. The namespace must exist once: `pnpm exec ovsx create-namespace Jondals -p <token>`.

From a terminal: `pnpm publish:all` (or `publish:marketplace` / `publish:openvsx` for one store). To keep the tokens yourself, define the user environment variables `VSCE_PAT` and `OVSX_PAT` and use the task *DevStarter: Publish (tokens del sistema)*. There is also a GitHub Actions workflow (`publish.yml`) that publishes when you push a version tag.

## Security

- **Nothing from third parties ships in the extension** (no runtime dependencies), and `pnpm audit` is clean.
- **Every download goes through one place** (`src/net.ts`): HTTPS only, with time and size limits.
- **Installing a missing tool asks for permission and tells you where it comes from** (winget, Homebrew, or the official script of php.new / rustup / pnpm / bun).
- **The Node.js installer is verified** against the SHA-256 published by nodejs.org before it runs.
- **Generated projects are safe by default:** database ports only listen on `127.0.0.1`, Dockerfiles don't run as root, `.env` is git-ignored, and the generated Express API reminds you to restrict CORS before deploying.
- Generated development passwords (`postgres`, `password`) are for local use only: change them before deploying.
- Project names are validated (lowercase letters, numbers, dashes and dots), so they can never inject anything into a command.

## If something goes wrong

- Run **DevStarter: Help** for a menu with the usual fixes.
- Failures show a clear message with **Show log**. The technical details are in *View → Output → DevStarter*.
- If a project generator breaks after an update, pin the previous version in `devstarter.scaffolderVersions`.

## Keeping DevStarter working over time

Frameworks release new versions all the time. DevStarter is built so that this doesn't break it:

- **Generators always run at their latest version.** If one ever breaks, users can pin it with `devstarter.scaffolderVersions` while it gets fixed.
- **Libraries are installed at their latest version** (no hard-coded versions in the templates).
- **If the latest version needs a newer Node.js**, DevStarter finds the newest compatible version from the npm registry, or offers to update Node.js.
- **Every Monday** a GitHub Actions workflow creates real projects with all the main generators on Windows and Linux (`pnpm smoke`). If something changed upstream, the workflow fails and you get an email.
- **Dependabot** opens weekly pull requests for the extension's own dependencies.

## Release notes

| Version | Highlights |
| --- | --- |
| **1.0.2** | Better search visibility (also "Dev Starter"), works from VS Code 1.90 (more IDEs), one-click publishing to Microsoft + Open VSX, Workspace Trust |
| 1.0.0 | First stable release: tool updates that really update (Node.js official installer with checksum), the project starts and opens in your browser, security review, modular code, no duplicated code, packaged `.vsix` |
| 0.6.1 | Beginners can choose every technology and option, with ⭐ Recommended marked in each step |
| 0.6.0 | Simpler first screen and plain-language summary for beginners, Help command, DevStarter log, clear error messages everywhere, code review fixes |
| 0.5.4 | The project opens by itself and starts frontend and backend; safer F5 test window |
| 0.5.3 | Fix: tools installed by DevStarter (PHP, Node.js…) are visible in new terminals without restarting VS Code |
| 0.5.2 | Fix: pnpm failed right after creating Angular projects (version switch) |
| 0.5.1 | Update Project Libraries upgrades Angular, Expo, Next.js, Nuxt and Astro with their official tools |
| 0.5.0 | Automatic fix for "needs a newer Node.js" (update Node.js or use a compatible version), Update Project Libraries, Check & Update My Tools, Retry, auto-open browser, pinned generator versions, weekly smoke tests, CI and Dependabot |
| 0.4.0 | "Start from an idea" for non-programmers, Three.js / R3F / p5.js / Phaser / Leaflet / AOS / Swiper, GSAP everywhere, live demo pages, click-by-click and end-to-end tests |
| 0.3.0 | Own visual identity and icon, 47 libraries, GitHub Actions CI, MIT license, publish to GitHub, Check My Tools, Recent Projects, documented and formatted code |
| 0.2.1 | Wizard crash fix (`reading 'databases'`), TypeScript editor errors fix |
| 0.2.0 | Fresh-PC installs, frontend + backend projects, databases everywhere, 24 templates, beginner/experienced modes |
| 0.1.0 | Complete rewrite: wizard, animated terminal, 13 templates |
| 0.0.1 | Original prototype |

Full details in the **Changelog** tab.
