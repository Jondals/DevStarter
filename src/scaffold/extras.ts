/**
 * scaffold/extras.ts
 * ──────────────────
 * Extras that can be added to any project:
 *  - GETTING_STARTED.md (beginners) or a root README.md (full-stack projects).
 *  - A root package.json in full-stack projects to start everything with one command.
 *  - Recommended VS Code extensions, EditorConfig and Prettier.
 *  - Continuous integration with GitHub Actions and an MIT license.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PackageManager } from '../tools';
import { patchJson, write } from './files';

/** A process that must be running while you code (e.g. the frontend server). */
export interface DevServer {
    label: string;
    /** Folder relative to the project root ('' for the root itself). */
    folder: string;
    command: string;
    url?: string;
}

// ─── Beginner guide and README ──────────────────────────────────────

/** Data to write the guide or the README. */
export interface GuideInfo {
    name: string;
    stack: string;
    servers: DevServer[];
    /** Single command that starts everything (full-stack projects only). */
    devAll?: string;
    mainFile?: string;
    docs: string[];
    notes: string[];
    extras: string[];
    /** Added libraries, with their docs and (if any) the URL of their demo. */
    libraries: Array<{ label: string; docs: string; demo?: string }>;
}

/**
 * "How to start it" block, shared by the guide and the README.
 * @param info project data
 */
function runSection(info: GuideInfo): string {
    if (info.devAll) {
        const list: string[] = [];
        const separate: string[] = [];
        for (const s of info.servers) {
            list.push(`- **${s.label}**${s.url ? `: ${s.url}` : ''}`);
            separate.push('```bash\ncd ' + s.folder + '\n' + s.command + '\n```');
        }
        return [
            '```bash',
            info.devAll,
            '```',
            '',
            'This starts everything at once:',
            '',
            list.join('\n'),
            '',
            'Prefer separate terminals? Run each part on its own:',
            '',
            separate.join('\n\n'),
        ].join('\n');
    }
    const server = info.servers[0];
    if (!server) {
        return 'This project has no dev server. Open the files and start writing!';
    }
    return (
        '```bash\n' +
        server.command +
        '\n```\n' +
        (server.url ? `\nThen open **${server.url}** in your browser.\n` : '')
    );
}

/**
 * Turns a list into Markdown bullets.
 * @param items items
 */
function bullets(items: string[]): string {
    const lines: string[] = [];
    for (const item of items) {
        lines.push(`- ${item}`);
    }
    return lines.join('\n');
}

/**
 * Writes GETTING_STARTED.md: the first steps explained for beginners.
 * @param root project root folder
 * @param info project data
 */
export function writeGettingStarted(root: string, info: GuideInfo): void {
    const libraryLines: string[] = [];
    const demoLines: string[] = [];
    for (const lib of info.libraries) {
        libraryLines.push(`[${lib.label}](${lib.docs})${lib.demo ? ` · demo: ${lib.demo}` : ''}`);
        if (lib.demo) {
            demoLines.push(`**${lib.label}**: ${lib.demo}`);
        }
    }
    const docLines: string[] = [];
    for (const d of info.docs) {
        docLines.push(`📚 ${d}`);
    }
    const sections = [
        `# 🚀 ${info.name}`,
        '',
        `Your **${info.stack}** project is ready. This file explains the first steps. You can delete it whenever you want.`,
        '',
        '## 1. Start the development server',
        '',
        'Open a terminal in VS Code (`Ctrl+Ñ` or ``Ctrl+` ``) and run:',
        '',
        runSection(info),
        '',
        'Leave it running while you code. Stop it with `Ctrl+C`.',
        '',
        '## 2. Make your first change',
        '',
        (info.mainFile ? `Open \`${info.mainFile}\`, change some text and save the file. ` : '') +
            "Most setups reload automatically, so you'll see the change right away.",
        '',
    ];
    if (info.notes.length) {
        sections.push('## 3. Good to know', '', bullets(info.notes), '');
    }
    if (demoLines.length) {
        sections.push(
            '## 🎮 Try the demos',
            '',
            'With the dev server running, open these pages to see your libraries in action. Their code is in the `demos` folder: copy what you like into your own pages.',
            '',
            bullets(demoLines),
            '',
        );
    }
    if (libraryLines.length) {
        sections.push('## Libraries included', '', bullets(libraryLines), '');
    }
    sections.push(
        '## What DevStarter set up',
        '',
        bullets([info.stack, ...info.extras]),
        '',
        '## Learn more',
        '',
        bullets([
            ...docLines,
            'Stuck? Copy the error message into a search engine or ask an AI assistant. Every developer does it!',
        ]),
        '',
        '---',
        '*Generated by DevStarter.*',
        '',
    );
    write(path.join(root, 'GETTING_STARTED.md'), sections.join('\n'));
}

/**
 * Root README of a full-stack project (for people who already code).
 * @param root project root folder
 * @param info project data
 */
export function writeRootReadme(root: string, info: GuideInfo): void {
    const structure: string[] = [];
    for (const s of info.servers) {
        structure.push(`\`${s.folder}/\`: ${s.label}`);
    }
    write(
        path.join(root, 'README.md'),
        [
            `# ${info.name}`,
            '',
            info.stack,
            '',
            '## Development',
            '',
            runSection(info),
            '',
            '## Structure',
            '',
            bullets(structure),
            '',
        ].join('\n'),
    );
}

// ─── Full-stack project ─────────────────────────────────────────────

/**
 * Root package.json with a "dev" script that starts frontend and backend together
 * thanks to `concurrently` (each one with its own color in the terminal).
 * @param root root folder
 * @param name project name
 * @param servers servers to start
 */
export function writeFullstackRoot(root: string, name: string, servers: DevServer[]): void {
    const names: string[] = [];
    const commands: string[] = [];
    for (const s of servers) {
        names.push(s.label.toLowerCase().split(' ')[0]);
        commands.push(JSON.stringify(`cd ${s.folder} && ${s.command}`));
    }
    const pkg = {
        name,
        private: true,
        scripts: { dev: `concurrently -k -n ${names.join(',')} -c cyan,magenta ${commands.join(' ')}` },
    };
    write(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    write(path.join(root, '.gitignore'), 'node_modules/\n.env\n.DS_Store\n');
}

// ─── VS Code ────────────────────────────────────────────────────────

/**
 * .vscode/extensions.json (VS Code offers to install these extensions when opening the project)
 * and, optionally, .vscode/settings.json.
 * @param root root folder
 * @param extensions extension ids
 * @param settings workspace settings
 */
export function writeVscodeRecommendations(
    root: string,
    extensions: string[],
    settings: Record<string, unknown> = {},
): void {
    const unique = [...new Set(extensions)];
    if (unique.length) {
        write(
            path.join(root, '.vscode', 'extensions.json'),
            JSON.stringify({ recommendations: unique }, null, 2) + '\n',
        );
    }
    if (Object.keys(settings).length) {
        write(path.join(root, '.vscode', 'settings.json'), JSON.stringify(settings, null, 2) + '\n');
    }
}

// ─── Code formatting ────────────────────────────────────────────────

/**
 * .editorconfig: same indentation and line endings in any editor.
 * @param root root folder
 */
export function writeEditorConfig(root: string): void {
    write(
        path.join(root, '.editorconfig'),
        `
# Keeps indentation and line endings consistent in every editor. https://editorconfig.org
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.{py,php,go,rs,cs,java}]
indent_size = 4

[*.go]
indent_style = tab

[*.md]
trim_trailing_whitespace = false
`,
    );
}

/**
 * Configures Prettier (code formatter) in a project with a package.json.
 * @param dir project folder
 */
export function configurePrettier(dir: string): void {
    write(path.join(dir, '.prettierrc'), JSON.stringify({ semi: false, singleQuote: true }, null, 2) + '\n');
    write(path.join(dir, '.prettierignore'), 'node_modules\ndist\nbuild\n.next\n.nuxt\n.output\ncoverage\n');
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
        patchJson(pkg, function (json) {
            json.scripts = { ...json.scripts, format: 'prettier --write .' };
        });
    }
}

// ─── GitHub Actions ─────────────────────────────────────────────────

/** Kind of project, to choose the CI steps. */
export type CiKind = 'node' | 'python' | 'go' | 'rust' | 'dotnet' | 'java' | 'php' | 'flutter';

/** A part of the project that CI must build/test. */
export interface CiPart {
    /** Job name (frontend, backend, app…). */
    job: string;
    /** Folder relative to the root ('' = root). */
    folder: string;
    kind: CiKind;
}

/**
 * CI steps of a Node project for the given package manager.
 * Build and test only run if package.json has those scripts.
 * @param pm package manager
 */
function nodeCiSteps(pm: PackageManager): string[] {
    const setup: string[] = [];
    if (pm.id === 'pnpm') {
        setup.push('      - uses: pnpm/action-setup@v4', '        with:', '          version: 10');
    } else if (pm.id === 'bun') {
        setup.push('      - uses: oven-sh/setup-bun@v2');
    }
    return [
        ...setup,
        '      - uses: actions/setup-node@v4',
        '        with:',
        '          node-version: 22',
        `      - run: ${pm.install()}`,
        '      - name: Build',
        `        run: if grep -q '"build":' package.json; then ${pm.run('build')}; fi`,
        '      - name: Test',
        `        run: if grep -q '"test":' package.json; then ${pm.run('test')}; fi`,
    ];
}

/**
 * CI steps for each kind of project.
 * @param kind kind of project
 * @param pm package manager (for Node projects)
 */
function ciSteps(kind: CiKind, pm: PackageManager): string[] {
    switch (kind) {
        case 'node':
            return nodeCiSteps(pm);
        case 'python':
            return [
                '      - uses: actions/setup-python@v5',
                '        with:',
                "          python-version: '3.13'",
                '      - run: pip install -r requirements.txt',
                '      - name: Check',
                '        run: if [ -f manage.py ]; then python manage.py check; fi',
                '      - name: Test',
                '        run: if [ -d tests ]; then python -m pytest; fi',
            ];
        case 'go':
            return [
                '      - uses: actions/setup-go@v5',
                '        with:',
                '          go-version: stable',
                '      - run: go build ./...',
                '      - run: go test ./...',
            ];
        case 'rust':
            return [
                '      - uses: dtolnay/rust-toolchain@stable',
                '      - run: cargo build',
                '      - run: cargo test',
            ];
        case 'dotnet':
            return [
                '      - uses: actions/setup-dotnet@v4',
                '        with:',
                "          dotnet-version: '10.0.x'",
                '      - run: dotnet build',
            ];
        case 'java':
            return [
                '      - uses: actions/setup-java@v4',
                '        with:',
                '          distribution: temurin',
                '          java-version: 21',
                '      - run: chmod +x mvnw && ./mvnw -B package',
            ];
        case 'php':
            return [
                '      - uses: shivammathur/setup-php@v2',
                '        with:',
                "          php-version: '8.4'",
                '      - run: composer install --no-interaction --prefer-dist',
                '      - run: cp .env.example .env && php artisan key:generate',
                '      - run: php artisan test',
            ];
        case 'flutter':
            return [
                '      - uses: subosito/flutter-action@v2',
                '        with:',
                '          channel: stable',
                '      - run: flutter pub get',
                '      - run: flutter test',
            ];
    }
}

/**
 * Writes .github/workflows/ci.yml with one job per part of the project.
 * GitHub runs it on every push and pull request.
 * @param root root folder
 * @param parts parts to build
 * @param pm package manager
 */
export function writeGithubActions(root: string, parts: CiPart[], pm: PackageManager): void {
    if (!parts.length) {
        return;
    }
    const jobs: string[] = [];
    for (const part of parts) {
        const lines = [`  ${part.job}:`, '    runs-on: ubuntu-latest'];
        if (part.folder) {
            lines.push('    defaults:', '      run:', `        working-directory: ${part.folder}`);
        }
        lines.push('    steps:', '      - uses: actions/checkout@v4', ...ciSteps(part.kind, pm));
        jobs.push(lines.join('\n'));
    }
    const yaml = [
        '# Builds and tests the project on every push. https://docs.github.com/actions',
        'name: CI',
        '',
        'on:',
        '  push:',
        '  pull_request:',
        '',
        'jobs:',
        jobs.join('\n\n'),
        '',
    ];
    write(path.join(root, '.github', 'workflows', 'ci.yml'), yaml.join('\n'));
}

// ─── License ────────────────────────────────────────────────────────

/** Name configured in Git (git config user.name), or a generic text. */
function gitUserName(): string {
    try {
        const name = cp.execSync('git config user.name', { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim();
        return name || 'The authors';
    } catch {
        return 'The authors';
    }
}

/**
 * Writes LICENSE with the MIT license (lets anyone use the code for almost anything).
 * @param root root folder
 */
export function writeMitLicense(root: string): void {
    const year = new Date().getFullYear();
    write(
        path.join(root, 'LICENSE'),
        `
MIT License

Copyright (c) ${year} ${gitUserName()}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
    );
}
