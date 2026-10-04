/**
 * templates/other.ts
 * ──────────────────
 * Plantillas móviles (Expo y Flutter) y "otros": scripts de Node.js y Python,
 * y un proyecto vacío para quien quiera montar su propio stack.
 */
import * as path from 'path';
import { snakeCase, write } from '../scaffold/files';
import { cmd, makeDir, PartOptions, Plan, scaffold, task, Template, venvPython } from './types';

/** Pasos de Expo (React Native). */
function expoPlan(o: PartOptions): Plan {
    const notes = [
        'Install **Expo Go** on your phone and scan the QR code shown in the terminal.',
        'Press `w` in the Expo terminal to open the app in your browser.',
    ];
    if (o.backendUrl) {
        notes.push(
            "On a real phone `localhost` is the phone itself: call the backend using your computer's local IP (e.g. `http://192.168.1.20:3000`).",
        );
    }
    return {
        steps: [
            scaffold(
                o,
                'Creating Expo app and installing dependencies',
                'create-expo-app',
                [o.folder, '--yes'],
                o.parentDir,
            ),
        ],
        server: { command: o.pm.bin('expo', ['start']) },
        mainFiles: ['src/app/index.tsx', 'app/(tabs)/index.tsx', 'app/index.tsx', 'App.tsx'],
        notes,
    };
}

/** Pasos de Flutter. */
function flutterPlan(o: PartOptions): Plan {
    return {
        steps: [
            // --project-name porque la carpeta puede llamarse "mobile" en un proyecto full-stack.
            cmd(
                'Creating Flutter project',
                `flutter create --org com.example --project-name ${snakeCase(o.name)} ${o.folder}`,
                o.parentDir,
            ),
        ],
        server: { command: 'flutter run' },
        mainFiles: ['lib/main.dart'],
        notes: ['Run `flutter doctor` if something is missing (Android Studio, emulators…).'],
    };
}

/**
 * Escribe un programa de Node.js (package.json, tsconfig si es TypeScript y src/index).
 * @param o opciones del proyecto
 */
function writeNodeScript(o: PartOptions): void {
    const ext = o.typescript ? 'ts' : 'js';
    const pkg = {
        name: o.packageName,
        version: '1.0.0',
        private: true,
        type: 'module',
        // tsx ejecuta TypeScript directamente, sin compilar a mano.
        scripts: o.typescript
            ? { dev: 'tsx watch src/index.ts', start: 'tsx src/index.ts', build: 'tsc' }
            : { dev: 'node --watch src/index.js', start: 'node src/index.js' },
    };
    write(path.join(o.dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    if (o.typescript) {
        const tsconfig = {
            compilerOptions: {
                target: 'ES2022',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                strict: true,
                outDir: 'dist',
                skipLibCheck: true,
            },
            include: ['src'],
        };
        write(path.join(o.dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');
    }
    write(path.join(o.dir, '.gitignore'), 'node_modules/\ndist/\n.env\n');
    write(
        path.join(o.dir, 'src', `index.${ext}`),
        `
// Edit me! This file restarts automatically when you save (npm run dev).
const name${o.typescript ? ': string' : ''} = '${o.name}'

console.log(\`Hello from \${name}!\`)
console.log(\`Today is \${new Date().toLocaleDateString()}\`)
`,
    );
}

/** Pasos del script de Node.js. */
function nodeScriptPlan(o: PartOptions): Plan {
    const ext = o.typescript ? 'ts' : 'js';
    const steps = [
        task('Writing files', function () {
            writeNodeScript(o);
        }),
    ];
    if (o.typescript) {
        steps.push(cmd('Installing TypeScript tools', o.pm.add(['typescript', 'tsx', '@types/node'], true), o.dir));
    }
    return {
        steps,
        server: { command: o.pm.run('dev') },
        mainFiles: [`src/index.${ext}`],
        notes: ['`npm run dev` re-runs your script every time you save.'],
    };
}

/**
 * Escribe un programa de Python (main.py, requirements.txt y .gitignore).
 * @param o opciones del proyecto
 */
function writePythonScript(o: PartOptions): void {
    write(path.join(o.dir, '.gitignore'), '.venv/\n__pycache__/\n.env\n');
    write(
        path.join(o.dir, 'requirements.txt'),
        '# Add the packages you need, one per line, then: pip install -r requirements.txt\n',
    );
    write(
        path.join(o.dir, 'main.py'),
        `
from datetime import date


def main():
    print("Hello from ${o.name}!")
    print(f"Today is {date.today():%A, %d %B %Y}")


if __name__ == "__main__":
    main()
`,
    );
}

/** Pasos del script de Python. */
function pythonScriptPlan(o: PartOptions): Plan {
    return {
        steps: [
            makeDir(o.dir),
            task('Writing files', function () {
                writePythonScript(o);
            }),
            cmd('Creating virtual environment (.venv)', `${o.python} -m venv .venv`, o.dir),
            cmd('Updating pip', `${venvPython()} -m pip install --upgrade pip`, o.dir, true),
        ],
        server: { command: `${venvPython()} main.py` },
        mainFiles: ['main.py'],
        notes: [`Install packages with \`${venvPython()} -m pip install <name>\` and list them in requirements.txt.`],
    };
}

/** Pasos del proyecto vacío. */
function emptyPlan(o: PartOptions): Plan {
    return {
        steps: [
            makeDir(o.dir),
            task('Writing README.md', function () {
                write(path.join(o.dir, 'README.md'), `# ${o.name}\n\nDescribe your project here.\n`);
                write(path.join(o.dir, '.gitignore'), '.env\n.DS_Store\nnode_modules/\n');
            }),
        ],
        mainFiles: ['README.md'],
        notes: [],
    };
}

export const mobileTemplates: Template[] = [
    {
        id: 'expo',
        label: 'React Native (Expo)',
        icon: 'device-mobile',
        category: 'Mobile',
        description: 'iOS & Android',
        detail: 'Build real mobile apps with React. Test them on your phone with the Expo Go app.',
        recommended: true,
        acceptsBackend: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://docs.expo.dev/tutorial/introduction/',
        vscode: ['expo.vscode-expo-tools'],
        plan: expoPlan,
    },
    {
        id: 'flutter',
        label: 'Flutter',
        icon: 'symbol-misc',
        category: 'Mobile',
        description: 'Dart',
        detail: "Google's toolkit for mobile, web and desktop apps from one codebase.",
        acceptsBackend: true,
        ci: 'flutter',
        node: false,
        requires: ['flutter'],
        nameStyle: 'snake',
        docs: 'https://docs.flutter.dev/get-started/codelab',
        vscode: ['Dart-Code.flutter'],
        plan: flutterPlan,
    },
];

export const otherTemplates: Template[] = [
    {
        id: 'node-script',
        label: 'Node.js script',
        icon: 'terminal',
        category: 'Other',
        description: 'CLI / automation',
        detail: 'A plain Node.js program: scripts, bots, command line tools…',
        languages: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://nodejs.org/en/learn/getting-started/introduction-to-nodejs',
        vscode: [],
        plan: nodeScriptPlan,
    },
    {
        id: 'python-script',
        label: 'Python script',
        icon: 'snake',
        category: 'Other',
        description: 'Scripts / data',
        detail: 'A Python program with its own virtual environment. Great for automation and data.',
        ci: 'python',
        node: false,
        requires: ['python'],
        nameStyle: 'kebab',
        docs: 'https://docs.python.org/3/tutorial/',
        vscode: ['ms-python.python'],
        plan: pythonScriptPlan,
    },
    {
        id: 'empty',
        label: 'Empty project',
        icon: 'new-folder',
        category: 'Other',
        description: 'Just a folder',
        detail: 'A clean folder with a README, .gitignore and editor settings. Bring your own stack.',
        node: false,
        requires: [],
        nameStyle: 'kebab',
        docs: 'https://code.visualstudio.com/docs',
        vscode: [],
        plan: emptyPlan,
    },
];
