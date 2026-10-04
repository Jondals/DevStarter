/**
 * commands/launch.ts
 * ──────────────────
 * Lo que pasa cuando el proyecto está creado: abrirlo, levantar los servidores de desarrollo
 * (frontend y backend, cada uno en su terminal) y abrir la web en el navegador.
 *
 * Dónde se arrancan los servidores es lo delicado:
 *  - Si ya hay una carpeta abierta, el proyecto se abre en una ventana nueva y los servidores
 *    se arrancan YA, desde esta ventana. Sus terminales siguen vivos y no hace falta que la
 *    ventana nueva tenga DevStarter cargado (en la ventana de F5 no lo tiene).
 *  - Si no hay carpeta abierta, abrir el proyecto recarga esta ventana y los terminales se
 *    perderían, así que los arranca la ventana recargada (resumePendingLaunch).
 */
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { background } from '../log';
import { PENDING_LAUNCH_KEY, PendingLaunch } from '../state';
import { wait } from '../util';

/**
 * Qué hacer con el proyecto recién creado, según el ajuste devstarter.afterCreate:
 *  - "open" (por defecto): lo abre directamente y levanta los servidores, sin preguntar.
 *  - "ask": muestra un aviso con botones.
 *  - "none": no hace nada.
 * @param context contexto de la extensión
 * @param launch datos para abrir el proyecto
 * @param name nombre del proyecto
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
        // Aviso que no bloquea (sin botones) y apertura directa.
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
 * Abre la carpeta del proyecto. Si es en esta ventana, se recarga: la ventana nueva (o la
 * recargada) lee PENDING_LAUNCH_KEY en activate() y termina el trabajo.
 * @param context contexto de la extensión
 * @param launch datos para abrir el proyecto
 * @param newWindow abrir en una ventana nueva
 */
async function openProject(context: vscode.ExtensionContext, launch: PendingLaunch, newWindow: boolean): Promise<void> {
    await context.globalState.update(PENDING_LAUNCH_KEY, launch);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(launch.root), {
        forceNewWindow: newWindow,
    });
}

/**
 * En la ventana recién abierta: abre los ficheros de inicio y, si no se hizo ya, arranca los servidores.
 * @param context contexto de la extensión
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
        return; // Es otra ventana; lo dejamos para la del proyecto.
    }
    await context.globalState.update(PENDING_LAUNCH_KEY, undefined);
    await openStarterFiles(launch);
    if (!launch.serversStarted && vscode.workspace.getConfiguration('devstarter').get('startDevServerOnOpen', true)) {
        await startDevServers(launch);
    }
}

/**
 * El PATH actual como variable de entorno para una terminal nueva. En Windows la variable se
 * llama "Path" (no "PATH") y no hay que pasar las dos a la vez, así que se usa el nombre real.
 */
function pathEnv(): Record<string, string | null> {
    const key = Object.keys(process.env).find(isPathKey) ?? 'PATH';
    return { [key]: process.env[key] ?? null };
}

/** ¿Es este el nombre de la variable PATH (sin distinguir mayúsculas)? */
function isPathKey(name: string): boolean {
    return name.toLowerCase() === 'path';
}

/**
 * Puerto de una dirección ("http://localhost:5173" → 5173), o undefined si no lo lleva.
 * @param url dirección
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
 * ¿Se puede conectar a este puerto de este ordenador? (es decir, ¿hay algo escuchando?)
 * @param host 127.0.0.1 o ::1
 * @param port puerto
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
 * ¿Hay algún programa escuchando en este puerto (en IPv4 o IPv6)?
 * @param port puerto
 */
export async function isListening(port: number): Promise<boolean> {
    return (await canConnect('127.0.0.1', port)) || (await canConnect('::1', port));
}

/**
 * Abre un terminal por servidor (frontend, backend…), lanza su comando y, para el primero,
 * abre la web cuando responda. Si el puerto ya lo usa otro programa, avisa en vez de abrir
 * una web equivocada.
 * @param launch datos del proyecto
 */
export async function startDevServers(launch: PendingLaunch): Promise<void> {
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
            // PATH actualizado: incluye lo instalado con VS Code abierto (p. ej. PHP para Laravel).
            env: pathEnv(),
            iconPath: new vscode.ThemeIcon(i === 0 ? 'play-circle' : 'server'),
        });
        terminal.sendText(server.command);
        if (i === 0) {
            terminal.show();
            if (server.url && !busy) {
                background('opening the app in the browser', openWhenReady(server.url));
            }
        }
    }
}

/**
 * Espera a que el servidor de desarrollo responda y abre la web: en el navegador
 * (por defecto) o dentro de VS Code (Simple Browser), según el ajuste devstarter.openBrowser.
 * Se exporta para poder probarla.
 * @param url dirección del servidor
 */
export async function openWhenReady(url: string): Promise<void> {
    const mode = vscode.workspace.getConfiguration('devstarter').get<string>('openBrowser', 'outside');
    if (mode === 'off') {
        return;
    }
    // Hasta 3 minutos: la primera vez algunos servidores tardan en compilar.
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
            // todavía no responde
        }
        await wait(2000);
    }
}

/**
 * Abre el fichero principal y, para principiantes, la guía en vista previa.
 * @param launch datos del proyecto
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
