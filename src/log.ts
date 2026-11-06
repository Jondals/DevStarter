/**
 * log.ts
 * ──────
 * DevStarter's log and handling of unexpected errors.
 *
 * Everything that fails "internally" is written to the "DevStarter" output channel
 * (View → Output → DevStarter). That way, if something blows up, there is a trail to check or
 * send, and the person sees a clear message instead of VS Code's generic dialog
 * ("Command resulted in an error").
 */
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/** DevStarter's output channel (created the first time it is needed). */
function output(): vscode.OutputChannel {
    channel ??= vscode.window.createOutputChannel('DevStarter');
    return channel;
}

/**
 * Writes a timestamped line to the log.
 * @param message text to store
 */
export function log(message: string): void {
    output().appendLine(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

/** Shows the output channel (for the "Show log" button). */
export function showLog(): void {
    output().show(true);
}

/**
 * Turns any error into readable text (with the stack, if any, for the log).
 * @param err whatever was thrown
 */
export function describeError(err: unknown): { message: string; detail: string } {
    if (err instanceof Error) {
        return { message: err.message, detail: err.stack ?? err.message };
    }
    return { message: String(err), detail: String(err) };
}

/**
 * Logs an error and tells the person with a clear message and a button to see the details.
 * @param what what was being done ("creating the project", "updating libraries"…)
 * @param err the error
 */
export async function reportError(what: string, err: unknown): Promise<void> {
    const { message, detail } = describeError(err);
    log(`ERROR while ${what}: ${detail}`);
    const choice = await vscode.window.showErrorMessage(
        `DevStarter had a problem while ${what}: ${message}`,
        'Show log',
        'Report a problem',
    );
    if (choice === 'Show log') {
        showLog();
    } else if (choice === 'Report a problem') {
        void vscode.env.openExternal(vscode.Uri.parse('https://github.com/search?q=devstarter&type=repositories'));
        showLog();
    }
}

/**
 * Wraps a command so it never ends in VS Code's generic error dialog:
 * if it fails, it is logged and a clear message is shown.
 * @param what what the command does, for the error message
 * @param fn the command
 */
export function safeCommand<A extends unknown[]>(
    what: string,
    fn: (...args: A) => Promise<unknown> | unknown,
): (...args: A) => Promise<void> {
    return async function (...args: A): Promise<void> {
        try {
            await fn(...args);
        } catch (err) {
            await reportError(what, err);
        }
    };
}

/**
 * Runs a background task without letting a failure vanish silently:
 * it is logged in DevStarter's channel (without bothering the person).
 * @param what description of the task
 * @param task the running promise
 */
export function background(what: string, task: Promise<unknown>): void {
    task.catch(function (err) {
        log(`Background task failed (${what}): ${describeError(err).detail}`);
    });
}
