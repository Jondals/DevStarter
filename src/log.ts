/**
 * log.ts
 * ──────
 * Registro de DevStarter y manejo de errores inesperados.
 *
 * Todo lo que falla "por dentro" se escribe en el canal de salida "DevStarter"
 * (Ver → Salida → DevStarter). Así, si algo explota, hay un rastro que revisar o enviar,
 * y la persona ve un mensaje claro en lugar del diálogo genérico de VS Code
 * ("Command resulted in an error").
 */
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

/** El canal de salida de DevStarter (se crea la primera vez que hace falta). */
function output(): vscode.OutputChannel {
    channel ??= vscode.window.createOutputChannel('DevStarter');
    return channel;
}

/**
 * Escribe una línea en el registro, con la hora.
 * @param message texto a guardar
 */
export function log(message: string): void {
    output().appendLine(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
}

/** Muestra el canal de salida (para el botón "Show log"). */
export function showLog(): void {
    output().show(true);
}

/**
 * Convierte cualquier error en texto legible (con la pila, si la hay, para el registro).
 * @param err lo que se haya lanzado
 */
export function describeError(err: unknown): { message: string; detail: string } {
    if (err instanceof Error) {
        return { message: err.message, detail: err.stack ?? err.message };
    }
    return { message: String(err), detail: String(err) };
}

/**
 * Registra un error y avisa a la persona con un mensaje claro y un botón para ver el detalle.
 * @param what qué se estaba haciendo ("creating the project", "updating libraries"…)
 * @param err el error
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
 * Envuelve un comando para que nunca termine en el diálogo genérico de VS Code:
 * si falla, se registra y se muestra un mensaje claro.
 * @param what qué hace el comando, para el mensaje de error
 * @param fn el comando
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
 * Lanza una tarea en segundo plano sin que un fallo se pierda en silencio:
 * se registra en el canal de DevStarter (sin molestar a la persona).
 * @param what descripción de la tarea
 * @param task la promesa en marcha
 */
export function background(what: string, task: Promise<unknown>): void {
    task.catch(function (err) {
        log(`Background task failed (${what}): ${describeError(err).detail}`);
    });
}
