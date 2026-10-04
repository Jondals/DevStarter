/**
 * extension.ts
 * ────────────
 * Punto de entrada de la extensión. VS Code llama a activate() al arrancar y aquí solo se
 * registran los comandos; cada uno vive en su propio módulo dentro de commands/:
 *
 *   newProject    · asistente → terminal → herramientas → pasos → abrir el proyecto
 *   install       · herramientas que hacen falta (instalar, arreglar "Node.js demasiado antiguo")
 *   launch        · abrir el proyecto, levantar los servidores y abrir la web
 *   tools         · Check & Update My Tools
 *   updateProject · Update Project Libraries
 *   recent        · proyectos recientes
 *   misc          · bienvenida, nivel de experiencia, guía y ayuda
 */
import * as vscode from 'vscode';
import { background, log, safeCommand } from './log';
import { PendingLaunch, RecentProject, setExtensionContext, syncTerminalPath } from './state';
import { refreshPath } from './tools';
import { resumePendingLaunch, startDevServers } from './commands/launch';
import { changeExperience, greetOnce, openGuide, showHelp } from './commands/misc';
import { newProject } from './commands/newProject';
import { recentProjects, rememberProject } from './commands/recent';
import { checkTools } from './commands/tools';
import { updateProject } from './commands/updateProject';

/** Lo que la extensión ofrece a otras extensiones (y a los tests). */
export interface DevStarterApi {
    /** Añade un proyecto a "Recent Projects". */
    rememberProject(project: RecentProject): Promise<void>;
    /** Pasa a las terminales nuevas las carpetas añadidas al PATH; devuelve lo que se les añade. */
    syncTerminalPath(): string | undefined;
    /** Abre un terminal por servidor de desarrollo (frontend, backend…) y lanza su comando. */
    startDevServers(launch: PendingLaunch): Promise<void>;
}

/**
 * VS Code llama a esta función al arrancar la extensión.
 * @param context permite guardar datos y registrar lo que hay que limpiar al cerrar
 */
export function activate(context: vscode.ExtensionContext): DevStarterApi {
    setExtensionContext(context);
    // Si se instaló algo con VS Code abierto, lo hacemos visible sin reiniciar
    // (en la extensión y en las terminales nuevas).
    background('refreshing the PATH', refreshPath().then(syncTerminalPath));
    log(`DevStarter ${context.extension.packageJSON.version} activated`);

    // Cada comando va envuelto: si algo falla, la persona ve un mensaje claro (no el diálogo genérico).
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'devstarter.newProject',
            safeCommand('creating the project', function (templateId?: string) {
                return newProject(context, templateId);
            }),
        ),
        vscode.commands.registerCommand('devstarter.checkTools', safeCommand('checking your tools', checkTools)),
        vscode.commands.registerCommand(
            'devstarter.recentProjects',
            safeCommand('listing recent projects', function () {
                return recentProjects(context);
            }),
        ),
        vscode.commands.registerCommand('devstarter.updateProject', safeCommand('updating the project', updateProject)),
        vscode.commands.registerCommand('devstarter.openGuide', safeCommand('opening the guide', openGuide)),
        vscode.commands.registerCommand(
            'devstarter.changeExperience',
            safeCommand('changing the experience level', changeExperience),
        ),
        vscode.commands.registerCommand('devstarter.help', safeCommand('opening help', showHelp)),
    );

    createStatusBarButton(context);
    background('resuming a pending launch', resumePendingLaunch(context));
    background('showing the welcome message', greetOnce(context));

    return {
        rememberProject(project: RecentProject) {
            return rememberProject(context, project);
        },
        startDevServers(launch: PendingLaunch) {
            return startDevServers(launch);
        },
        syncTerminalPath,
    };
}

/** VS Code llama a esta función al cerrar la extensión. No hay nada que limpiar. */
export function deactivate(): void {}

/**
 * Botón "New Project" en la barra de estado (se puede ocultar en los ajustes).
 * @param context contexto de la extensión
 */
function createStatusBarButton(context: vscode.ExtensionContext): void {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.text = '$(sparkle) New Project';
    item.tooltip = 'DevStarter: create a new project in a few clicks';
    item.command = 'devstarter.newProject';

    /** Muestra u oculta el botón según el ajuste. */
    function update(): void {
        if (vscode.workspace.getConfiguration('devstarter').get('showStatusBarButton', true)) {
            item.show();
        } else {
            item.hide();
        }
    }

    update();
    context.subscriptions.push(
        item,
        vscode.workspace.onDidChangeConfiguration(function (e) {
            if (e.affectsConfiguration('devstarter.showStatusBarButton')) {
                update();
            }
        }),
    );
}
