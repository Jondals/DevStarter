# Change Log
## [1.0.0] - 2026-10-04

First stable release.

### Fixed
- **"Check & Update My Tools" did not actually update anything.** Three separate causes:
  - **Node.js:** winget's catalog lags behind nodejs.org (it offered 24.19.0 while 24.21.0 was out). DevStarter promised an update winget could not give, and its fallback (`winget install --force`) reinstalled the same version and still showed a ✔. Now every update **re-reads the installed version afterwards**. If it did not change, DevStarter says why ("winget has no newer version yet") and, for Node.js on Windows, falls back to the **official installer from nodejs.org**, verifying its SHA-256 against the checksum nodejs.org publishes before running it.
  - **pnpm:** versions were read from the open project's folder, and pnpm switches version according to that project's `packageManager` field, so the screen showed the project's pnpm (12.8.1) instead of the installed one (11.22.0). Versions are now read from a neutral folder.
  - **Python:** it always targeted winget's `Python.Python.3.13` package. It now updates the package of the minor version you actually use.
- **`LICENSE.txt` was empty.** It now contains the MIT license, and `package.json` declares `"license": "MIT"`.
- The README had lost its accents and symbols (`â­`, `â†’`) after a bad re-encoding. Restored.

### Security
- **The generated `docker-compose.yml` exposed the database on every network interface** with a development password (and MongoDB without any). Ports are now published only on `127.0.0.1`, with a comment explaining it.
- **Generated Dockerfiles no longer run as root** (Node: `node` user; Python: `app` user; Go and Rust: `nobody`).
- **Spring Boot extraction no longer goes through a shell.** The zip is opened with `execFile` (no command string, so no path can be interpreted as a command), and the download is capped at 20 MB.
- **One network layer (`net.ts`) for every download** (npm registry, nodejs.org, start.spring.io, the Node.js installer): HTTPS only, a time limit and a size limit, with the body read in chunks and cut as soon as it exceeds the limit.
- **Installers say where they come from.** Before asking permission to install a missing tool, DevStarter lists what it will run and its source (for example "a script downloaded from php.new", "Microsoft's package manager (winget)").
- The generated Express API explains that `cors()` allows any origin and must be restricted before deploying.
- **Dev dependencies updated: `pnpm audit` goes from 27 vulnerabilities (20 high) to none.** The extension has no runtime dependencies: nothing from third parties ships in the `.vsix`. Includes esbuild 0.28.2 and ESLint 10; transitive packages are pinned with `overrides`.

### Added
- **The project starts and opens in your browser as soon as it is created** (`devstarter.openBrowser` now defaults to `outside`; `inside` still opens VS Code's Simple Browser). The frontend and backend each get their own terminal.
  - With a folder already open, the servers start **right away from the current window** and the project opens in a new one. This works even if that window does not have DevStarter loaded, which is the case of the F5 test window.
  - With no folder open, opening the project reloads the window and would kill its terminals, so the reloaded window starts them.
  - If the port is already used by another program, DevStarter warns you instead of opening the wrong app.
- 13 new tests (54 in total): tool updates (version really changes, nothing changed, winget "no update" codes, second way, already up to date, checksums, Python package), the real nodejs.org checksum of the current LTS, how the project opens in both cases, port detection and the three browser modes.
- Maintenance: `pnpm package` produces a clean `.vsix` (12 files, 83 KB); `publisher` added to the manifest.

### Changed (code quality)
- **`extension.ts` went from 1,400 lines to 153.** Each command now lives in its own module: `commands/newProject`, `install`, `launch`, `tools`, `updateProject`, `recent` and `misc`, plus `state.ts` for what they share.
- **Duplicate code removed**, checked with `jscpd` (strict threshold): 5 duplicated blocks → 0. Shared test helpers moved to `test/helpers.ts`; `sleep`/`wait` unified in `util.ts`; the three near-identical package manager objects are now a data table; Tailwind and "connect to the backend" steps shared between Vite and Angular; version-range bounds, FastAPI/Flask base files and winget/Homebrew selection shared.
- Terminal command steps can now declare acceptable exit codes and a `verify` check that runs afterwards.

### Notes
- The `DEP0169 url.parse()` warning comes from VS Code itself: it also appears when running the `code` command line, before any DevStarter code runs.

## [0.6.1] - 2026-09-23

### Changed
- **Beginners can pick any framework and any option again, now with our recommendation marked.** The "See all technologies…" button of 0.6.0 is gone: the first screen shows the 11 ideas and, right below, all 24 technologies. The recommended ones go first inside each group and carry **⭐ Recommended**. The same star appears in every step:
  - technology: React, Next.js, Express API, FastAPI and React Native (Expo),
  - language: TypeScript,
  - backend: Express and FastAPI (listed first),
  - database: SQLite,
  - extras: Tailwind CSS, Git and the VS Code extensions (these are also ticked by default),
  - package manager: npm.
- Experienced users see no stars and keep the compact list.

### Tests
- The wizard test checks that a beginner sees every technology on the first screen, that FastAPI is listed before NestJS, and that all the recommendations above are marked. 41 tests in total.

### Notes
- The `DEP0169 url.parse()` warning in the debug console comes from VS Code itself, not from DevStarter: the extension has no runtime dependencies and never calls `url.parse()`.

## [0.6.0] - 2026-09-20

### Changed
- **Easier first screen for beginners.** (Replaced in 0.6.1: beginners now see every technology, with the recommended ones marked.)
- **The confirmation screen explains what will be created in plain words**, e.g. "A website made with React and TypeScript, styled with Tailwind CSS, with an Express API backend and a SQLite database, plus Zustand and GSAP. Anything missing on your computer gets installed for you." The same sentence ("In short") appears in the terminal welcome box.
- **A clearer welcome message** with three buttons: Create a project, **Take the tour** and Check my tools.
- The test window (F5) keeps loading all your installed extensions again. The `--disable-extensions` experiment of 0.5.4 was reverted.

### Added
- **`DevStarter: Help`** command: one menu with the usual needs (create a project, check tools, take the tour, update libraries, show the log, settings).
- **A DevStarter log** (View → Output → DevStarter). Every failure is written there.
- **No more raw "Command resulted in an error" dialogs.** Every command is wrapped: if something unexpected fails, you get a clear message ("DevStarter had a problem while creating the project: …") with **Show log** and **Report a problem** buttons. Background tasks (opening the app, resuming a launch, PATH refresh) also log their failures instead of losing them silently.
- Stricter compiler settings (`noUnusedLocals`, `noImplicitReturns`) so dead code and missing returns are caught automatically.
- 5 new tests: plain-language summary, safe commands, the generator version setting, **no combination of template + backend + database + libraries + extras + package manager + experience level throws (more than 1,000 combinations)** and the simplified first screen. 41 tests in total.

### Fixed (found during the code review)
- **The terminal could hang forever** if VS Code never reported it as open. DevStarter now continues after 10 seconds.
- **The generator version setting (`devstarter.scaffolderVersions`) went straight into a shell command.** It now only accepts normal versions or tags (`21`, `21.2.0`, `^21`, `next`…); anything else is ignored.
- **Update Project could fail parsing npm-check-updates output** when it printed no braces (`slice(-1)` of a missing `{`).
- Dev server terminals received both `PATH` and `Path`. On Windows they are the same variable, so only the real name is passed now.
- The extension id was hard-coded in three places (`undefined_publisher.devstarter`) and would have broken the tour and settings links the day the extension gets a publisher. It now comes from VS Code.

### Performance
- The PATH (a PowerShell call on Windows, about 1 s) is no longer re-read for every project: the result is reused for 20 seconds, and it is only forced right after installing something.
- Looking up the newest compatible framework version uses npm's abbreviated metadata: 1.8 MB instead of 3.3 MB for `@angular/cli`.
- Removed dead code (`findMainFile`, `findPreset`). The production bundle is 157 KB.

## [0.5.4] - 2026-09-18

### Changed
- **The project now opens by itself when it is ready**, with no buttons. Frontend and backend start automatically, each in its own terminal, and the app opens in VS Code as soon as the server answers. If a folder is already open, the project goes to a new window so you don't lose your work. New setting `devstarter.afterCreate`: `open` (default), `ask` (the old message with buttons) or `none`.

### Fixed
- **The test window (F5) sometimes crashed or closed on startup.** VS Code's logs show that the extension host of the test window aborts (exit code 134) about a second after starting, **before DevStarter is even loaded**, and VS Code restarts it. It happened 6 times today and 0 in the 5 previous sessions, always next to Copilot's "enables LESS API proposals" error: the test window was loading every extension you have installed (Copilot, Live Server, Claude Code…). The launch configurations now pass `--disable-extensions`, so the test window loads only DevStarter. I could not identify the exact module that crashes (the Crashpad dumps are from other hours), so if it still happens, send me the line `exited with code: 134` from `%APPDATA%\Code\logs\<session>\main.log`.

### Added
- Tests: the project opens by itself (and only once), and frontend and backend start each in their own terminal (37 tests). The tests that create projects no longer open folders in the test window.

## [0.5.3] - 2026-09-15

### Fixed
- **`pnpm dev` in a Laravel project failed with "php no se reconoce como un comando"** even though DevStarter had installed PHP and found it (`PHP v8.4.0`). VS Code reads the system PATH only when it starts, so every terminal opened afterwards (and the dev servers DevStarter starts) kept the old PATH. The root cause was the same for any tool installed while VS Code was open: Node.js, pnpm, Composer, Go, Rust…
  - DevStarter now gives the new PATH folders to **all new terminals** (`environmentVariableCollection`), and also to the dev server terminals it opens.
  - Terminals that were already open cannot be changed by an extension: open a new one (or restart VS Code once).

### Added
- Test that a tool folder added to the PATH reaches new terminals (36 tests).

## [0.5.2] - 2026-09-03

### Fixed
- **"Installing Tailwind CSS" failed on Angular projects with pnpm** (`pnpm add -D tailwindcss ...` → "El sistema no puede encontrar la ruta especificada"), although the packages were installed. Angular writes `"packageManager": "pnpm@<latest>"` into `package.json`. When that differs from the installed pnpm (e.g. 11.22), pnpm tries to download and switch to that version on every command in the folder, and on Windows that switch fails with a broken path. It would also have broken `pnpm dev` later. After any generator finishes, DevStarter now pins that field to the installed pnpm version. Verified by creating a real Angular + Express project with pnpm, Tailwind and Prettier.
- Found while investigating: just removing the field, or setting `pnpm_config_manage_package_manager_versions=false`, does not stop pnpm from switching versions; pinning the field does.

### Added
- Test for the pnpm pin (35 tests).

## [0.5.1] - 2026-09-01

### Added
- **Update Project Libraries now updates the framework with its official tool**, which also adapts your code:
  - Angular: `ng update @angular/core @angular/cli`.
  - Expo: `expo install expo@latest` (latest mode) and `expo install --fix`, so every library matches the SDK.
  - Next.js: the official `@next/codemod upgrade latest` (latest mode).
  - Nuxt: `nuxt upgrade` (latest mode). Astro: `@astrojs/upgrade` (latest mode).
  - Django, Laravel, Rust, Go and Flutter were already updated by their own package managers.
- The generic update skips the packages tied to the framework (`@angular/*`, `expo-*`, `react-native-*`, `@astrojs/*`…), so versions that must go together are never split. In safe mode only Angular and Expo are guarded. Next, Nuxt and Astro just get minor updates.
- Test: every framework is detected and routed to its official updater (34 tests).

### Fixed
- Found while testing: npm-check-updates ignores filters written as regular expressions with slashes (`/^@expo\//`), so `@expo/vector-icons` would have been upgraded alone. The filter now uses wildcards (`@expo/*`), verified against a real `package.json`.

## [0.5.0] - 2026-08-28

### Added
- **Automatic fix when a framework needs a newer Node.js.** Example: the latest Angular CLI needs Node.js 24.15+ and you have 24.14. DevStarter detects the error and offers two options, then retries the step by itself:
  - **Update Node.js** (winget or Homebrew), checking afterwards that the new version is active.
  - **Use the newest compatible version** of the tool (e.g. `@angular/cli 21.2.24`). It is calculated live from the npm registry by reading each version's `engines.node`, so it never needs hard-coded versions.
- **`DevStarter: Update Project Libraries`** command: updates the libraries of an existing project.
  - Detects every part, including `frontend/` and `backend/` subfolders: npm, pnpm or bun (from the lockfile), Python (`.venv`), Composer, Cargo, Go and Flutter.
  - **Safe update** (minor versions and fixes) or **Latest versions** (also majors), using npm-check-updates, pip, `composer update`, `cargo update`, `go get -u` and `flutter pub upgrade`.
  - Saves a Git checkpoint first and checks that the project still builds afterwards. If something breaks, `git restore .` undoes everything.
- **Check & Update My Tools** (formerly Check My Tools): shows the latest Node.js LTS, npm, pnpm and bun next to your versions, pre-selects the outdated ones and updates them. Node.js, Git, GitHub CLI, Python, Go, .NET and Java update with winget or Homebrew; Rust uses `rustup update`, Flutter `flutter upgrade` and Composer `composer self-update`.
- **Retry** button after a failed or cancelled setup: it deletes the partial folder and starts again with the same choices.
- **The app opens by itself** inside VS Code (Simple Browser) as soon as the dev server answers. Setting `devstarter.openBrowser`: `inside`, `outside` or `off`.
- Setting **`devstarter.scaffolderVersions`** to pin a generator version (e.g. `{ "@angular/cli": "21" }`) if a new release ever breaks, without waiting for a DevStarter update.
- **Maintenance tooling**, so DevStarter keeps working as frameworks evolve:
  - `pnpm smoke` creates real projects with the latest generators and reports which ones broke.
  - A weekly GitHub Actions workflow (`scaffolders.yml`) runs it on Windows and Linux.
  - A CI workflow (`ci.yml`) checks types, lint, format and tests on every push.
  - Dependabot keeps the extension's own dependencies and actions up to date.
- 10 new tests: version ranges, Node.js error detection, project parts, retry info on generators, the recovery mechanism (including "only once, no loops"), opening the browser, Update Project end to end, compatible Angular version, and **Angular created on this PC's Node.js 24.14 by falling back to `@angular/cli 21.2.24`**. 33 tests in total.

### Changed
- Every project generator (create-vite, create-next-app, sv, create-nuxt, create-astro, @angular/cli, @nestjs/cli, create-expo-app) now goes through a single `scaffold()` helper. It uses the pinned or latest version and knows how to rerun itself with another version.
- `tsconfig.json` only compiles `src/`. Maintenance scripts, workflows and Prettier files are excluded from the packaged extension.

### Fixed
- **"Creating Angular project" failed with exit code 3** when Node.js was older than the Angular CLI required. Now DevStarter offers to update Node.js or to use a compatible Angular version, and continues.
- The text of the required Node.js version kept a trailing dot ("…v26.0.0.").

## [0.4.0] - 2026-08-25

### Added
- **"Start from an idea"**: 11 ready-made projects for people who have never programmed, shown first in the wizard for beginners. You pick what you want to make and DevStarter chooses the technology, libraries and options, then jumps straight to folder and name. The ideas:
  - personal website or portfolio,
  - landing page with animations,
  - 3D website,
  - browser game,
  - interactive art with code,
  - blog,
  - web app with users and data,
  - website with its own API,
  - website with a map,
  - mobile app,
  - automating tasks with Python.
- **Creative libraries**: Three.js, React Three Fiber, p5.js, Phaser, Leaflet, AOS and Swiper. GSAP is now available in every web frontend (it was only in Vanilla, Vue and Svelte). The catalog grows from 47 to 54 libraries.
- **Live demo pages** in Vite projects for Three.js, React Three Fiber, GSAP, p5.js, Phaser and Leaflet (`demos/*.html`, with an index at `/demos/`). `GETTING_STARTED.md` and the final summary link to them.
- `activate()` returns a small API (`rememberProject`), used by the tests.
- **"Click by click" tests** that run the real extension inside VS Code. They replace its windows (QuickPick, InputBox, terminal, dialogs, notifications) with scripted ones:
  - the whole wizard, including Back and the libraries step,
  - picking an idea,
  - Check My Tools,
  - Recent Projects,
  - an end-to-end run that creates a real project from an idea (p5.js) and checks its demo, guide and notification.
- Tests for every idea and for the creative libraries. 23 tests in total.

### Changed
- Library packages are de-duplicated before installing (Three.js and React Three Fiber both need `three`).
- The beginner wizard asks "What do you want to make?" and shows ideas before technologies. Experienced users see technologies first and ideas at the end.

### Fixed (found while testing the demos in a real browser)
- The p5.js demo looked empty until you moved the mouse. The trail now draws a looping figure by itself when the mouse is still.
- The Three.js demo rendered on a black background instead of the dark blue used by the other pages.
- The end-to-end test failed while deleting its temporary folder, because Windows keeps it locked for a few seconds. Cleanup is now best-effort.

## [0.3.0] - 2026-08-20

### Added
- **Libraries step** in the wizard: 47 popular libraries chosen per stack. Examples:
  - Frontend: React Router, Zustand, TanStack Query, Motion, React Hook Form + Zod, React Icons, Vue Router, Pinia, VueUse, Lucide, Axios, Day.js, Chart.js, GSAP and Vitest.
  - Astro: MDX and React.
  - Node backends: Helmet, Morgan, JWT + bcrypt, `@nestjs/config`, class-validator, Swagger, Chalk and Commander.
  - Python: pytest, pydantic-settings, Flask-CORS, Django REST Framework, django-cors-headers, Loguru, Requests, Rich and pandas.
  - Laravel: Debugbar and Spatie Permission. Rust: Serde and tower-http. Spring Boot: Actuator, Validation and Lombok. Flutter: http, Provider and go_router.
  - Several are **wired in automatically**: Helmet and Morgan in Express, CORS in Flask and Django, DRF in `INSTALLED_APPS`, and Vitest/pytest with an example test that already passes.
- **New extras**:
  - GitHub Actions CI with a job per part, adapted to each language (Node with npm/pnpm/bun, Python, Go, Rust, .NET, Java, PHP and Flutter).
  - MIT license, using your Git name as author.
  - Publish to GitHub: creates a private repository with the GitHub CLI.
- **New commands**:
  - `DevStarter: Check My Tools`: shows every tool and its version, and installs what is missing in one go.
  - `DevStarter: Recent Projects`: reopens projects created with DevStarter, in this window or a new one, or shows them in the file explorer.
- GitHub CLI (`gh`) detection and automatic install.
- Walkthrough step "Check your tools" and a "Check my tools" link in the empty Explorer.
- Extension icon (`media/icon.png`) and a gallery banner.
- 4 new tests: libraries catalog, library steps, CI/license/publish steps and `.gitignore` merging. 16 tests in total.

### Changed
- **New visual identity**: the terminal no longer imitates Claude Code.
  - Colors: teal, indigo and fuchsia.
  - Spinner: a turning arc (`◜◠◝◞◡◟`).
  - Symbols: `◆ ✗ ▲ └`, with a `▰▱` progress bar.
  - Spinner line: `tip` label and `[v] logs [ctrl+c] cancel` hints.
  - Status bar button: `$(sparkle) New Project`.
  - Welcome pages use the same colors.
- **Code style**:
  - Every source file starts with a comment explaining what it does, and every function has a doc comment (in Spanish).
  - No arrow functions in the extension code. An ESLint rule (`no-restricted-syntax`) enforces it.
  - All code is formatted with Prettier (`pnpm format`).
- The project summary now counts the chosen libraries.

## [0.2.1] - 2026-08-15

### Fixed
- **"Command 'DevStarter: New Project' resulted in an error: Cannot read properties of undefined (reading 'databases')"**. To show "Step X of Y", the wizard checked every step before a template was chosen, and the database and package manager steps read the missing template. Added a regression test that opens and closes the real wizard.
- The editor showed **"Cannot find name 'fs' / 'path' / 'process'"** although the build passed. The TypeScript server kept a stale state from when `node_modules` was reinstalled. `tsconfig.json` now declares `"types": ["node", "mocha"]` explicitly.
- Stale compiled tests in `out/` (`templates.js`, `scaffold.js`) shadowed the new folders and made tests fail. `out/` is now cleaned before testing.
- The command test could run before the extension was activated. It now activates the extension first.

### Notes
- The `DEP0169 url.parse()` warnings in the debug console come from VS Code itself (`[AgentHost]`), not from DevStarter.
- Pressing F5 opened a browser because the parent folder (`D:\dev`) was open instead of `DevStarter`. Open the `DevStarter` folder (or use the "Run DevStarter Extension" launch configuration) to debug.

## [0.2.0] - 2026-08-03

### Added
- **Fresh PC support**:
  - Detects missing Node.js, Git, Python, PHP/Composer, Go, .NET, Rust and Java, and installs them (winget, Homebrew, php.new, rustup).
  - Installs pnpm and bun when you pick them.
  - Refreshes the PATH, so new tools work without restarting VS Code.
- **Frontend + backend projects**:
  - Add any backend to a frontend or a mobile app.
  - Creates `frontend/` (or `mobile/`) and `backend/` folders.
  - Proxies `/api` to the backend (Vite and Angular).
  - Adds a root `dev` script that starts both with `concurrently`.
- **Database integration** (SQLite, PostgreSQL, MySQL, MongoDB) for Express, NestJS, Next.js, Nuxt, SvelteKit, FastAPI, Flask, Django and Laravel. It installs the driver, writes the connection to `.env` and adds a `/api/db` test route.
- **Docker**: `docker-compose.yml` for the database and a Dockerfile for backends.
- **New templates**: Nuxt, SvelteKit, NestJS, Flask, Go, .NET Web API, Rust (Axum), Spring Boot, Node.js script, Python script and Empty project (24 in total).
- **Laravel** works on machines without PHP thanks to php.new, and supports MySQL and PostgreSQL.
- **Beginner and experienced modes**:
  - Asked the first time; change it later with `DevStarter: Change Experience Level`.
  - Beginners get tips while they wait, a welcome page and `GETTING_STARTED.md`.
  - Experienced developers see the commands as they run and get a root `README.md`.
- **Repeat last setup** in the wizard.
- Extras: Prettier, EditorConfig and recommended VS Code extensions. Python projects get the `.venv` interpreter setting.
- Every backend exposes `GET /api/health`. The welcome pages call it to show the connection.

### Changed
- Terminal redesigned with a breathing spinner, shimmering titles and live output for experienced users.
- Source split into `templates/` and `scaffold/`, and commented in Spanish.

### Fixed
- **pnpm 11** failed with `ERR_PNPM_IGNORED_BUILDS` when installing Next.js and when running `pnpm dev`. DevStarter now sets `strictDepBuilds: false` while installing and in every pnpm project, and approves `better-sqlite3`.
- **NestJS** with `--skip-git` creates no `.gitignore`, so the first commit included 10,576 files from `node_modules`. DevStarter now completes `.gitignore` before every commit.
- **SvelteKit 3** removed the `$lib` alias, which broke the database route. It now uses a relative import that works in SvelteKit 2 and 3.
- The browser tab showed "frontend" in full-stack projects. It now shows the project name.
- **Spring Boot** extraction failed with Git Bash's `tar`, which cannot open `.zip` files. DevStarter now downloads the project in-process and uses Windows' own `tar.exe` (or `unzip` on macOS/Linux).
- Generators that create their own Git repository (Expo) no longer leave nested repositories in full-stack projects.

### Known issues
- The latest Angular CLI needs Node.js 22.22+, 24.15+ or 26+. DevStarter shows a clear message explaining that Node.js must be updated.

## [0.1.0] - 2026-07-03

First real version: a complete rewrite of the original prototype.

### Added
- **Wizard** with numbered steps, a Back button, live name validation (with suggestions such as `My App` → `my-app`), a folder picker and a confirmation step.
- **Own terminal (Pseudoterminal)** that runs every command, waits for it to finish and shows a banner, spinners, a progress bar and timers. Press `v` for live logs and `Ctrl+C` to cancel (it kills the whole process tree).
- **Friendly errors**: the last output lines plus a plain-language hint (old Node.js, no network, Git not configured, permissions…).
- **Tool check** before creating anything, with download links.
- **13 templates**: React, Vue, Svelte, HTML/CSS/JS (Vite), Angular, Next.js, Astro, Express (with SQLite, PostgreSQL, MySQL or MongoDB), FastAPI, Django, Laravel, Expo and Flutter.
- Choice of TypeScript or JavaScript, Tailwind CSS v4 with a welcome page, and npm, pnpm or bun.
- Git repository with a first commit, and `GETTING_STARTED.md` with the commands to run.
- After creating: open the project with its main file and guide, and start the dev server automatically.
- Option to delete the half-created folder after a failure or cancellation.
- Status bar button, a "New Project" button in the empty Explorer and a Get Started walkthrough.
- Settings: default package manager, initial Git repository, live logs, auto-start of the dev server and status bar button.
- Tests for names, commands, error hints, templates and UI helpers.

### Changed
- The command was renamed from `devstarter.StartProyect` to `devstarter.newProject` ("DevStarter: New Project").
- The welcome message now appears only the first time, not on every start.

### Fixed (problems in the original version)
- Commands were sent to the terminal "blind" with `sendText`, without knowing when they finished.
- Tailwind setup depended on `setTimeout(15000)` and on polling for the `src` folder. It failed on slow machines and wrote files too early.
- Deprecated or abandoned generators were replaced: create-react-app → Vite, `react-native init` → Expo, express-generator → our own Express template, and Gatsby was removed.
- Generators stopped to ask questions in the terminal (create-next-app, create-vite, Angular). Now every generator runs non-interactively, with input closed so nothing can hang.
- Global installs (`npm install -g @angular/cli`, `@ionic/cli`) are no longer needed.
- Removed the unused `inquirer` dependency, the leftover `extension_old.ts` and stray compiled test files in `src/test`.
- Tailwind v3 setup replaced by Tailwind v4 (`@tailwindcss/vite`).

### Development
- `node_modules` was reinstalled with pnpm 11 (it had been installed with pnpm 10), and the invalid `"packageManager": "pnpm@10"` was changed to an exact version.

## [0.0.1]

Original prototype.

- `Start Proyect` command with QuickPick menus for Frontend, Backend, MetaFramework and Mobile.
- Created projects by sending commands to a VS Code terminal (create-react-app, Angular CLI, Vue, Vite + Svelte, Next.js, Astro, Gatsby, express-generator, Django, Laravel, Flutter, React Native, Ionic, NativeScript).
- Optional Tailwind CSS (v3) and database drivers.
