/**
 * state.ts
 * ────────
 * What the extension's commands share: the keys where data is stored, the types of that
 * data and the VS Code context (which is only received once, in activate()).
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { addedPathDirs } from './tools';

export const PENDING_LAUNCH_KEY = 'devstarter.pendingLaunch';
export const WELCOMED_KEY = 'devstarter.welcomed';
export const RECENT_KEY = 'devstarter.recentProjects';

/** A dev server of the project (frontend, backend…). */
export interface LaunchServer {
    label: string;
    cwd: string;
    command: string;
    url?: string;
}

/** Stored before opening the project so the new window can finish the job. */
export interface PendingLaunch {
    root: string;
    servers: LaunchServer[];
    mainFile?: string;
    openGuide: boolean;
    createdAt: number;
    /** The servers were already started from the window where the project was created. */
    serversStarted?: boolean;
}

/** A project created with DevStarter (for "Recent Projects"). */
export interface RecentProject {
    name: string;
    root: string;
    stack: string;
    createdAt: number;
}

/** Extension context, so the terminals' environment can be changed from any function. */
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Stores the extension context (called once, from activate()).
 * @param context VS Code context
 */
export function setExtensionContext(context: vscode.ExtensionContext): void {
    extensionContext = context;
}

/** Real id of the extension ("publisher.devstarter"), to open its tour or its settings. */
export function extensionId(): string {
    return extensionContext?.extension.id ?? 'devstarter';
}

/**
 * Makes NEW VS Code terminals see the tools installed while VS Code was open
 * (PHP, Node.js, pnpm…). VS Code only reads the system PATH on startup, so without this
 * "php artisan serve" would say "php is not recognized" until VS Code is restarted.
 * ! Terminals that were already open cannot be changed: a new one must be opened.
 * @returns what gets added to the PATH of new terminals
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
