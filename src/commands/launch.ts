/**
 * commands/launch.ts
 * ──────────────────
 * What happens once the project is created: open it, start the dev servers
 * (frontend and backend, each in its own terminal) and open the app in the browser.
 *
 * ! Where the servers are started is the tricky part:
 *  - If a folder is already open, the project opens in a new window and the servers start
 *    RIGHT AWAY, from this window. Their terminals stay alive and the new window does not
 *    need DevStarter loaded (the F5 window does not have it).
 *  - If no folder is open, opening the project reloads this window and the terminals would
 *    be lost, so the reloaded window starts them (resumePendingLaunch).
 */
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { background } from '../log';
import { offerScriptsFix, scriptsBlocked, useCmdWrappers } from '../psPolicy';
import { PENDING_LAUNCH_KEY, PendingLaunch } from '../state';
import { wait } from '../util';

/**
 * What to do with the new project, according to the devstarter.afterCreate setting:
 *  - "open" (default): opens it directly and starts the servers, without asking.
 *  - "ask": shows a notification with buttons.
 *  - "none": does nothing.
 * @param context extension context
 * @param launch data to open the project
 * @param name project name
 */
export async function afterCreate(
    context: vscode.ExtensionContext,
    launch: PendingLaunch,
    name: string,
): Promise<void> {
    const config = vscode.workspace.getConfiguration('devstarter');
    const mode = config.get<string>('afterCreate', 'open');
    const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
    if (mode === 'none') {
        return;
    }
    if (mode !== 'ask') {
        // * Non-blocking notification (no buttons) and open it straight away.
        void vscode.window.showInformationMessage(`🎉 ${name} is ready! Opening it and starting the servers…`);
        if (hasWorkspace && config.get('startDevServerOnOpen', true)) {
            await startDevServers(launch);
            launch.serversStarted = true;
        }
        await openProject(context, launch, hasWorkspace);
        return;
    }
    const openHere = hasWorkspace ? 'Open Here' : 'Open Project';
    const actions = [openHere];
    if (hasWorkspace) {
        actions.push('Open in New Window');
    }
    if (launch.servers.length) {
        actions.push('Run Dev Server');
    }
    const picked = await vscode.window.showInformationMessage(`🎉 ${name} is ready! What next?`, ...actions);
    if (picked === 'Run Dev Server') {
        await startDevServers(launch);
        await openStarterFiles(launch);
    } else if (picked) {
        await openProject(context, launch, picked === 'Open in New Window');
    }
}

/**
 * Opens the project folder. If it is in this window, the window reloads: the new (or
 * reloaded) window reads PENDING_LAUNCH_KEY in activate() and finishes the job.
 * @param context extension context
 * @param launch data to open the project
 * @param newWindow open in a new window
 */
async function openProject(context: vscode.ExtensionContext, launch: PendingLaunch, newWindow: boolean): Promise<void> {
    await context.globalState.update(PENDING_LAUNCH_KEY, launch);
    // ! While debugging DevStarter (Extension Development Host), reloading this window restarts the
    // ! extension host attached to the debugger, which crashes it (exit code 134). Use a new window.
    const debugging = context.extensionMode === vscode.ExtensionMode.Development;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(launch.root), {
        forceNewWindow: newWindow || debugging,
    });
}

/**
 * In the freshly opened window: opens the starter files and, if not done yet, starts the servers.
 * @param context extension context
 */
export async function resumePendingLaunch(context: vscode.ExtensionContext): Promise<void> {
    const launch = context.globalState.get<PendingLaunch>(PENDING_LAUNCH_KEY);
    if (!launch) {
        return;
    }
    if (Date.now() - launch.createdAt > 10 * 60 * 1000) {
        await context.globalState.update(PENDING_LAUNCH_KEY, undefined);
        return;
    }
    let isThisProject = false;
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        if (path.relative(folder.uri.fsPath, launch.root) === '') {
            isThisProject = true;
        }
    }
    if (!isThisProject) {
        return; // ? A different window; leave it to the project's window.
    }
    await context.globalState.update(PENDING_LAUNCH_KEY, undefined);
    await openStarterFiles(launch);
    if (!launch.serversStarted && vscode.workspace.getConfiguration('devstarter').get('startDevServerOnOpen', true)) {
        await startDevServers(launch);
    }
}

/**
 * The current PATH as an environment variable for a new terminal. On Windows the variable is
 * called "Path" (not "PATH") and both must not be passed at once, so the real name is used.
 */
function pathEnv(): Record<string, string | null> {
    const key = Object.keys(process.env).find(isPathKey) ?? 'PATH';
    return { [key]: process.env[key] ?? null };
}

/** Whether this is the name of the PATH variable (case-insensitive). */
function isPathKey(name: string): boolean {
    return name.toLowerCase() === 'path';
}

/**
 * Port of an address ("http://localhost:5173" → 5173), or undefined if it has none.
 * @param url address
 */
function portOf(url: string | undefined): number | undefined {
    if (!url) {
        return undefined;
    }
    try {
        return Number(new URL(url).port) || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Whether we can connect to this port on this computer (i.e. whether something is listening).
 * @param host 127.0.0.1 or ::1
 * @param port port
 */
function canConnect(host: string, port: number): Promise<boolean> {
    return new Promise(function (resolve) {
        const socket = net.connect({ host, port, timeout: 500 });
        socket.once('connect', function () {
            socket.destroy();
            resolve(true);
        });
        socket.once('timeout', function () {
            socket.destroy();
            resolve(false);
        });
        socket.once('error', function () {
            resolve(false);
        });
    });
}

/**
 * Whether any program is listening on this port (over IPv4 or IPv6).
 * @param port port
 */
export async function isListening(port: number): Promise<boolean> {
    return (await canConnect('127.0.0.1', port)) || (await canConnect('::1', port));
}

/**
 * Opens one terminal per server (frontend, backend…), runs its command and, for the first one,
 * opens the app once it responds. If another program already uses the port, it warns instead
 * of opening the wrong website.
 * @param launch project data
 */
export async function startDevServers(launch: PendingLaunch): Promise<void> {
    // ! Fresh Windows installs block npm.ps1 in PowerShell terminals: use the .cmd wrappers and offer a fix.
    const blocked = await scriptsBlocked();
    if (blocked) {
        background('offering the PowerShell fix', offerScriptsFix());
    }
    for (let i = 0; i < launch.servers.length; i++) {
        const server = launch.servers[i];
        const port = portOf(server.url);
        const busy = port !== undefined && (await isListening(port));
        if (busy) {
            void vscode.window.showWarningMessage(
                `Port ${port} is already used by another program, so ${server.label} may start on a different port. Check the terminal for the real address.`,
            );
        }
        const terminal = vscode.window.createTerminal({
            name: launch.servers.length > 1 ? server.label : 'Dev server',
            cwd: server.cwd,
            // * Updated PATH: includes what was installed while VS Code was open (e.g. PHP for Laravel).
            env: pathEnv(),
            iconPath: new vscode.ThemeIcon(i === 0 ? 'play-circle' : 'server'),
        });
        terminal.sendText(blocked ? useCmdWrappers(server.command) : server.command);
        if (i === 0) {
            terminal.show();
            if (server.url && !busy) {
                background('opening the app in the browser', openWhenReady(server.url));
            }
        }
    }
}

/**
 * Waits until the dev server responds and opens the app: in the browser (default)
 * or inside VS Code (Simple Browser), according to the devstarter.openBrowser setting.
 * Exported so it can be tested.
 * @param url server address
 */
export async function openWhenReady(url: string): Promise<void> {
    const mode = vscode.workspace.getConfiguration('devstarter').get<string>('openBrowser', 'outside');
    if (mode === 'off') {
        return;
    }
    // ? Up to 3 minutes: the first time, some servers take a while to compile.
    for (let attempt = 0; attempt < 90; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (response.status < 500) {
                if (mode === 'inside') {
                    await vscode.commands.executeCommand('simpleBrowser.show', url);
                } else {
                    await vscode.env.openExternal(vscode.Uri.parse(url));
                }
                return;
            }
        } catch {
            // not responding yet
        }
        await wait(2000);
    }
}

/**
 * Opens the main file and, for beginners, the guide in preview.
 * @param launch project data
 */
async function openStarterFiles(launch: PendingLaunch): Promise<void> {
    if (launch.mainFile) {
        const doc = await vscode.workspace.openTextDocument(path.join(launch.root, launch.mainFile));
        await vscode.window.showTextDocument(doc, { preview: false });
    }
    const guide = path.join(launch.root, 'GETTING_STARTED.md');
    if (launch.openGuide && fs.existsSync(guide)) {
        await vscode.commands.executeCommand('markdown.showPreviewToSide', vscode.Uri.file(guide));
    }
}
