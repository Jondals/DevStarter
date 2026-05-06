import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage('DevStarter installed! Use "StartProyect" from Ctrl+Shift+P.');

    const disposable = vscode.commands.registerCommand('devstarter.StartProyect', async () => {
        await createProject();
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}

async function createProject(basePath?: string) {
    try {
        const rootPath = basePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

        const projectName = basePath ? path.basename(basePath) :
            await vscode.window.showInputBox({ placeHolder: 'Enter your project name', prompt: 'Project name' });
        if (!projectName) return vscode.window.showInformationMessage('Cancelled: project name required');

        const type = await vscode.window.showQuickPick(['Frontend', 'Backend', 'MetaFramework', 'Mobile'], { placeHolder: 'Select project type' });
        if (!type) return vscode.window.showInformationMessage('Cancelled');

        let framework: string | undefined;
        let useTailwind = false;
        let database: string | undefined;

        switch (type) {
            case 'Frontend':
                framework = await vscode.window.showQuickPick(['React', 'Angular', 'Vue', 'Svelte'], { placeHolder: 'Select frontend framework' });
                if (!framework) return vscode.window.showInformationMessage('Cancelled');
                useTailwind = (await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: 'Add Tailwind CSS?' })) === 'Yes';
                break;
            case 'MetaFramework':
                framework = await vscode.window.showQuickPick(['Next.js', 'Astro', 'Gatsby'], { placeHolder: 'Select meta-framework' });
                if (!framework) return vscode.window.showInformationMessage('Cancelled');
                useTailwind = (await vscode.window.showQuickPick(['Yes', 'No'], { placeHolder: 'Add Tailwind CSS?' })) === 'Yes';
                break;
            case 'Backend':
                framework = await vscode.window.showQuickPick(['Express', 'Django', 'Laravel', 'Next.js'], { placeHolder: 'Select backend framework' });
                if (!framework) return vscode.window.showInformationMessage('Cancelled');
                database = await vscode.window.showQuickPick(['PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'None'], { placeHolder: 'Select database (optional)' });
                if (database === 'None') database = undefined;
                break;
            case 'Mobile':
                framework = await vscode.window.showQuickPick(['Flutter', 'React Native', 'Ionic', 'NativeScript'], { placeHolder: 'Select mobile framework' });
                if (!framework) return vscode.window.showInformationMessage('Cancelled');
                break;
        }

        const confirm = await vscode.window.showQuickPick(['Yes', 'No'], {
            placeHolder: `Create ${type} project "${projectName}" with ${framework}${useTailwind ? ' + Tailwind' : ''}${database ? ` and ${database}` : ''}?`
        });
        if (confirm !== 'Yes') return vscode.window.showInformationMessage('Cancelled');

        const terminal = vscode.window.createTerminal('DevStarter');
        terminal.show();
        const send = (cmd: string) => terminal.sendText(cmd);

        let projectPath = path.join(rootPath, projectName);
        if (type === 'Frontend' || type === 'Backend') {
            projectPath = path.join(projectPath, type.toLowerCase());
        }
        if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });

        send(`echo Starting ${type} project "${projectName}" in "${projectPath}"`);

        switch (framework) {
            case 'React':
                send(`cd "${projectPath}"`);
                send(`npx create-react-app . --use-npm`);
                if (useTailwind) setupTailwindReact(projectPath, terminal);
                break;
            case 'Angular':
                send(`cd "${projectPath}"`);
                send(`npm install -g @angular/cli`);
                send(`ng new . --skip-install`);
                if (useTailwind) setupTailwind(projectPath, 'angular', terminal);
                break;
            case 'Vue':
                send(`cd "${projectPath}"`);
                send(`npm init vue@latest .`);
                if (useTailwind) setupTailwind(projectPath, 'vue', terminal);
                break;
            case 'Svelte':
                send(`cd "${projectPath}"`);
                send(`npm create vite@latest . -- --template svelte`);
                if (useTailwind) setupTailwind(projectPath, 'svelte', terminal);
                break;
            case 'Next.js':
                send(`cd "${projectPath}"`);
                send(`npx create-next-app@latest .`);
                if (useTailwind) setupTailwind(projectPath, 'next', terminal);
                break;
            case 'Astro':
                send(`cd "${projectPath}"`);
                send(`npm create astro@latest .`);
                if (useTailwind) send(`npx astro add tailwind`);
                break;
            case 'Gatsby':
                send(`cd "${projectPath}"`);
                send(`npx gatsby new .`);
                if (useTailwind) setupTailwind(projectPath, 'gatsby', terminal);
                break;
            case 'Express':
                send(`cd "${projectPath}"`);
                send(`npx express-generator .`);
                break;
            case 'Django':
                send(`cd "${projectPath}"`);
                send(`django-admin startproject .`);
                break;
            case 'Laravel':
                send(`cd "${projectPath}"`);
                send(`composer create-project laravel/laravel .`);
                break;
            case 'Flutter':
                send(`cd "${projectPath}"`);
                send(`flutter create .`);
                break;
            case 'React Native':
                send(`cd "${projectPath}"`);
                send(`npx react-native init .`);
                break;
            case 'Ionic':
                send(`cd "${projectPath}"`);
                send(`npm install -g @ionic/cli`);
                send(`ionic start .`);
                break;
            case 'NativeScript':
                send(`cd "${projectPath}"`);
                send(`ns create .`);
                break;
        }

        if (database) {
            send(`cd "${projectPath}"`);
            switch (database) {
                case 'PostgreSQL': send(`npm install pg`); break;
                case 'MySQL': send(`npm install mysql`); break;
                case 'SQLite': send(`npm install sqlite3`); break;
                case 'MongoDB': send(`npm install mongoose`); break;
            }
        }

        vscode.window.showInformationMessage('✅ Project setup commands sent to terminal!');
    } catch (err) {
        vscode.window.showErrorMessage(`Error: ${err}`);
    }
}

function setupTailwindReact(projectPath: string, terminal: vscode.Terminal) {
    terminal.show();
    terminal.sendText(`cd "${projectPath}"`);

    // 1. Instalar Tailwind y generar config
    terminal.sendText(`npm install -D tailwindcss@3`);
    terminal.sendText(`npx tailwindcss init`);

    // Función que espera hasta que exista un archivo o carpeta
    function waitForPath(targetPath: string, callback: () => void) {
        const interval = setInterval(() => {
            if (fs.existsSync(targetPath)) {
                clearInterval(interval);
                callback();
            }
        }, 500);
    }

    const srcPath = path.join(projectPath, "src");

    // 2. Espera DINÁMICA hasta que CRA cree /src
    waitForPath(srcPath, () => {
        // === CONFIGURAR TAILWIND ===

        // tailwind.config.js
        const configPath = path.join(projectPath, "tailwind.config.js");
        const configContent = `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`;
        fs.writeFileSync(configPath, configContent);

        // index.css
        const indexCssPath = path.join(srcPath, "index.css");
        fs.writeFileSync(indexCssPath, `@tailwind base;
@tailwind components;
@tailwind utilities;`);

        // index.js → importar index.css
        const indexJsPath = path.join(srcPath, "index.js");
        if (fs.existsSync(indexJsPath)) {
            let content = fs.readFileSync(indexJsPath, "utf8");
            if (!content.includes(`import './index.css';`)) {
                content = `import './index.css';\n` + content;
                fs.writeFileSync(indexJsPath, content);
            }
        }

        // App.js oficial
        const appJsPath = path.join(srcPath, "App.js");
        fs.writeFileSync(appJsPath, `export default function App() {
  return (
    <h1 className="text-3xl font-bold underline">
      Hello world!
    </h1>
  )
}
`);

        // 3. Iniciar servidor
        terminal.sendText("npm start");

        vscode.window.showInformationMessage("✅ Tailwind configurado correctamente en React (modo dinámico).");
    });
}

// === Tailwind general para otros frameworks ===
function setupTailwind(projectPath: string, type: string, terminal: vscode.Terminal) {
    const send = (cmd: string) => terminal.sendText(cmd);

    setTimeout(() => {
        const srcDir = path.join(projectPath, 'src');
        if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });

        const cssFile = path.join(srcDir, 'index.css');
        if (!fs.existsSync(cssFile)) {
            fs.writeFileSync(cssFile, `@tailwind base;\n@tailwind components;\n@tailwind utilities;`);
            send(`echo Tailwind CSS configured in ${cssFile}`);
        }

        send(`cd "${projectPath}"`);
        send(`npm install -D tailwindcss postcss autoprefixer`);
        send(`npx tailwindcss init -p`);
    }, 15000);
}
