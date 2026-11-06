/**
 * extension.ts
 * ────────────
 * Entry point of the extension. VS Code calls activate() on startup, and this file only
 * registers the commands; each one lives in its own module inside commands/:
 *
 *   newProject    · wizard → terminal → tools → steps → open the project
 *   install       · tools a project needs (install them, fix "Node.js is too old")
 *   launch        · open the project, start the dev servers and open the app
 *   tools         · Check & Update My Tools
 *   updateProject · Update Project Libraries
 *   recent        · recent projects
 *   misc          · welcome message, experience level, guide and help
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

/** What the extension offers to other extensions (and to the tests). */
export interface DevStarterApi {
    /** Adds a project to "Recent Projects". */
    rememberProject(project: RecentProject): Promise<void>;
    /** Passes folders added to PATH on to new terminals; returns what gets added. */
    syncTerminalPath(): string | undefined;
    /** Opens one terminal per dev server (frontend, backend…) and runs its command. */
    startDevServers(launch: PendingLaunch): Promise<void>;
}

/**
 * VS Code calls this function when the extension starts.
 * @param context lets us store data and register what to clean up on shutdown
 */
export function activate(context: vscode.ExtensionContext): DevStarterApi {
    setExtensionContext(context);
    // * If something was installed while VS Code was open, make it visible without restarting
    // * (for the extension and for new terminals).
    background('refreshing the PATH', refreshPath().then(syncTerminalPath));
    log(`DevStarter ${context.extension.packageJSON.version} activated`);

    // * Every command is wrapped: if something fails, the person sees a clear message (not the generic dialog).
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

/** VS Code calls this function when the extension shuts down. There is nothing to clean up. */
export function deactivate(): void {}

/**
 * "New Project" button in the status bar (can be hidden in the settings).
 * @param context extension context
 */
function createStatusBarButton(context: vscode.ExtensionContext): void {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.text = '$(sparkle) New Project';
    item.tooltip = 'DevStarter: create a new project in a few clicks';
    item.command = 'devstarter.newProject';

    /** Shows or hides the button according to the setting. */
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
