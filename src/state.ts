/**
 * state.ts
 * ────────
 * Lo que comparten los comandos de la extensión: las claves donde se guardan datos, los tipos
 * de esos datos y el contexto de VS Code (que solo se recibe una vez, en activate()).
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { addedPathDirs } from './tools';

export const PENDING_LAUNCH_KEY = 'devstarter.pendingLaunch';
export const WELCOMED_KEY = 'devstarter.welcomed';
export const RECENT_KEY = 'devstarter.recentProjects';

/** Un servidor de desarrollo del proyecto (frontend, backend…). */
export interface LaunchServer {
    label: string;
    cwd: string;
    command: string;
    url?: string;
}

/** Se guarda antes de abrir el proyecto para que la nueva ventana termine el trabajo. */
export interface PendingLaunch {
    root: string;
    servers: LaunchServer[];
    mainFile?: string;
    openGuide: boolean;
    createdAt: number;
    /** Los servidores ya se arrancaron desde la ventana donde se creó el proyecto. */
    serversStarted?: boolean;
}

/** Un proyecto creado con DevStarter (para "Recent Projects"). */
export interface RecentProject {
    name: string;
    root: string;
    stack: string;
    createdAt: number;
}

/** Contexto de la extensión, para poder tocar el entorno de las terminales desde cualquier función. */
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Guarda el contexto de la extensión (se llama una vez, desde activate()).
 * @param context contexto de VS Code
 */
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

/** Identificador real de la extensión ("publicador.devstarter"), para abrir su tour o sus ajustes. */
export function extensionId(): string {
    return extensionContext?.extension.id ?? 'devstarter';
}

/**
 * Hace que las terminales NUEVAS de VS Code vean las herramientas instaladas con VS Code abierto
 * (PHP, Node.js, pnpm…). VS Code solo lee el PATH del sistema al arrancar, así que sin esto
 * "php artisan serve" daría "php no se reconoce" hasta reiniciar VS Code.
 * Las terminales que ya estaban abiertas no se pueden cambiar: hay que abrir una nueva.
 * @returns lo que se añade al PATH de las terminales nuevas
 */
export function syncTerminalPath(): string | undefined {
    const collection = extensionContext?.environmentVariableCollection;
    const dirs = addedPathDirs();
    if (collection && dirs.length) {
        collection.description = 'DevStarter: tools installed while VS Code was open';
        collection.append('PATH', path.delimiter + dirs.join(path.delimiter));
    }
    return collection?.get('PATH')?.value;
}
