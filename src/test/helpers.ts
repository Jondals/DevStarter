/**
 * test/helpers.ts
 * ───────────────
 * Utilidades compartidas por los tests: simulan las ventanas de VS Code (listas, campos de
 * texto, terminal, notificaciones) para ejecutar la extensión "como lo haría una persona",
 * y pequeñas ayudas (esperar, borrar carpetas temporales, memoria falsa de VS Code).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { stripAnsi } from '../ui';

// Se reexporta para que los tests lo importen desde un único sitio.
export { wait } from '../util';

/** Qué hace la "persona" en una lista. */
export type Action =
    | { labels: string[] } // elegir estas opciones (por su texto)
    | { index: number } // elegir la opción número N
    | 'defaults' // aceptar lo que ya viene marcado
    | 'back' // pulsar "atrás"
    | 'cancel'; // cerrar

/** Decide la acción a partir del texto de la lista (placeholder) y sus opciones. */
export type Script = (placeholder: string, items: readonly vscode.QuickPickItem[]) => Action;

/**
 * Texto de una opción sin el icono del principio ("$(symbol-event) React" → "React").
 * @param item opción de la lista
 */
export function plainLabel(item: vscode.QuickPickItem): string {
    return item.label.replace(/^\$\([^)]+\)\s*/, '');
}

/**
 * Opciones elegibles (sin separadores).
 * @param items opciones de la lista
 */
export function selectable(items: readonly vscode.QuickPickItem[]): vscode.QuickPickItem[] {
    return items.filter(function (i) {
        return i.kind !== vscode.QuickPickItemKind.Separator;
    });
}

/** Funciones de VS Code que sustituimos, para restaurarlas al terminar. */
const originals = {
    createQuickPick: vscode.window.createQuickPick,
    createInputBox: vscode.window.createInputBox,
    createTerminal: vscode.window.createTerminal,
    showQuickPick: vscode.window.showQuickPick,
    showOpenDialog: vscode.window.showOpenDialog,
    showInformationMessage: vscode.window.showInformationMessage,
    showWarningMessage: vscode.window.showWarningMessage,
    showErrorMessage: vscode.window.showErrorMessage,
};

/** Restaura todas las funciones originales de VS Code. */
export function restoreWindow(): void {
    Object.assign(vscode.window, originals);
}

/**
 * Sustituye createQuickPick y createInputBox por versiones guiadas por un guion.
 * @param script decide qué elegir en cada lista
 * @param name nombre que se escribe en el campo de texto
 * @returns lista de placeholders vistos, en orden (para comprobar el recorrido)
 */
export function installFakeInputs(script: Script, name: string): string[] {
    const seen: string[] = [];
    const window = vscode.window as any;

    window.createQuickPick = function () {
        const accept: Array<() => void> = [];
        const buttons: Array<(b: vscode.QuickInputButton) => void> = [];
        const hide: Array<() => void> = [];
        const qp: any = {
            items: [],
            selectedItems: [],
            activeItems: [],
            buttons: [],
            onDidAccept(cb: () => void) {
                accept.push(cb);
                return { dispose() {} };
            },
            onDidTriggerButton(cb: (b: vscode.QuickInputButton) => void) {
                buttons.push(cb);
                return { dispose() {} };
            },
            onDidHide(cb: () => void) {
                hide.push(cb);
                return { dispose() {} };
            },
            dispose() {},
            show() {
                setTimeout(function () {
                    seen.push(qp.placeholder);
                    const action = script(qp.placeholder, qp.items);
                    if (action === 'back') {
                        buttons.forEach(function (cb) {
                            cb(vscode.QuickInputButtons.Back);
                        });
                        return;
                    }
                    if (action === 'cancel') {
                        hide.forEach(function (cb) {
                            cb();
                        });
                        return;
                    }
                    if (action !== 'defaults') {
                        const options = selectable(qp.items);
                        const chosen =
                            'index' in action
                                ? [options[action.index]]
                                : options.filter(function (i) {
                                      return action.labels.includes(plainLabel(i));
                                  });
                        assert.ok(
                            chosen.length && chosen[0],
                            `Nothing to choose in "${qp.placeholder}" for ${JSON.stringify(action)}`,
                        );
                        qp.selectedItems = chosen;
                        qp.activeItems = chosen;
                    }
                    accept.forEach(function (cb) {
                        cb();
                    });
                }, 0);
            },
        };
        return qp;
    };

    window.createInputBox = function () {
        const accept: Array<() => void> = [];
        const box: any = {
            value: '',
            buttons: [],
            onDidChangeValue() {
                return { dispose() {} };
            },
            onDidTriggerButton() {
                return { dispose() {} };
            },
            onDidHide() {
                return { dispose() {} };
            },
            onDidAccept(cb: () => void) {
                accept.push(cb);
                return { dispose() {} };
            },
            dispose() {},
            show() {
                setTimeout(function () {
                    seen.push(`input: ${box.prompt}`);
                    box.value = name;
                    accept.forEach(function (cb) {
                        cb();
                    });
                }, 0);
            },
        };
        return box;
    };
    return seen;
}

/** Notificaciones capturadas (en vez de mostrarse). */
export function silenceMessages(): string[] {
    const messages: string[] = [];
    const window = vscode.window as any;
    for (const fn of ['showInformationMessage', 'showWarningMessage', 'showErrorMessage']) {
        window[fn] = async function (message: string) {
            messages.push(message);
            return undefined;
        };
    }
    return messages;
}

/**
 * Sustituye createTerminal: abre el Pseudoterminal y guarda todo lo que escribe.
 * @returns función que devuelve la salida acumulada (sin colores)
 */
export function captureTerminal(): () => string {
    let output = '';
    (vscode.window as any).createTerminal = function (options: vscode.ExtensionTerminalOptions) {
        options.pty.onDidWrite(function (data: string) {
            output += data;
        });
        setTimeout(function () {
            options.pty.open({ columns: 120, rows: 40 });
        }, 0);
        return { show() {}, dispose() {}, sendText() {} };
    };
    return function () {
        return stripAnsi(output).replace(/\r/g, '');
    };
}

/** Memento en memoria para simular el almacenamiento de VS Code. */
export function memoryMemento(): vscode.Memento {
    const data = new Map<string, unknown>();
    return {
        get(key: string, fallback?: unknown) {
            return data.has(key) ? data.get(key) : fallback;
        },
        async update(key: string, value: unknown) {
            data.set(key, value);
        },
        keys() {
            return [...data.keys()];
        },
    } as vscode.Memento;
}

/**
 * Intercepta vscode.openFolder para que los tests no abran carpetas (recargarían la ventana de pruebas).
 * @returns las carpetas que se intentó abrir y una función para restaurar el comando
 */
export function interceptOpenFolder(): { calls: string[]; restore: () => void } {
    const original = vscode.commands.executeCommand;
    const calls: string[] = [];
    (vscode.commands as any).executeCommand = async function (command: string, ...args: any[]) {
        if (command === 'vscode.openFolder') {
            calls.push((args[0] as vscode.Uri).fsPath);
            return undefined;
        }
        return original.call(vscode.commands, command, ...args);
    };
    return {
        calls,
        restore() {
            (vscode.commands as any).executeCommand = original;
        },
    };
}

/** La API que devuelve activate() (para Recent Projects). */
export async function devstarterApi(): Promise<any> {
    for (const ext of vscode.extensions.all) {
        if (ext.packageJSON.name === 'devstarter') {
            return ext.activate();
        }
    }
    throw new Error('DevStarter extension not found');
}

/**
 * Borra una carpeta temporal sin fallar: en Windows puede seguir bloqueada unos segundos
 * (el antivirus o el vigilante de ficheros de VS Code), y eso no es un fallo del test.
 * @param dir carpeta a borrar
 */
export function removeQuietly(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
        // Se quedará en la carpeta temporal del sistema, que Windows limpia solo.
    }
}
