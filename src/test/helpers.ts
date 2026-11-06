/**
 * test/helpers.ts
 * ───────────────
 * Helpers shared by the tests: they fake VS Code's windows (lists, text fields,
 * terminal, notifications) to run the extension "the way a person would",
 * plus small aids (waiting, deleting temporary folders, a fake VS Code memento).
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { stripAnsi } from '../ui';

// Re-exported so the tests import it from a single place.
export { wait } from '../util';

/** What the "person" does in a list. */
export type Action =
    | { labels: string[] } // pick these options (by their text)
    | { index: number } // pick option number N
    | 'defaults' // accept what is already selected
    | 'back' // press "Back"
    | 'cancel'; // close

/** Decides the action from the list text (placeholder) and its options. */
export type Script = (placeholder: string, items: readonly vscode.QuickPickItem[]) => Action;

/**
 * Text of an option without its leading icon ("$(symbol-event) React" → "React").
 * @param item list option
 */
export function plainLabel(item: vscode.QuickPickItem): string {
    return item.label.replace(/^\$\([^)]+\)\s*/, '');
}

/**
 * Selectable options (no separators).
 * @param items list options
 */
export function selectable(items: readonly vscode.QuickPickItem[]): vscode.QuickPickItem[] {
    return items.filter(function (i) {
        return i.kind !== vscode.QuickPickItemKind.Separator;
    });
}

/** VS Code functions we replace, to restore them afterwards. */
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

/** Restores every original VS Code function. */
export function restoreWindow(): void {
    Object.assign(vscode.window, originals);
}

/**
 * Replaces createQuickPick and createInputBox with versions driven by a script.
 * @param script decides what to pick in each list
 * @param name name typed into the text field
 * @returns placeholders seen, in order (to check the path taken)
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

/** Captured notifications (instead of being shown). */
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
 * Replaces createTerminal: opens the Pseudoterminal and keeps everything it writes.
 * @returns function that returns the accumulated output (without colors)
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

/** In-memory Memento that fakes VS Code storage. */
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
 * Intercepts vscode.openFolder so tests do not open folders (that would reload the test window).
 * @returns the folders it tried to open and a function to restore the command
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

/** The API returned by activate() (for Recent Projects). */
export async function devstarterApi(): Promise<any> {
    for (const ext of vscode.extensions.all) {
        if (ext.packageJSON.name === 'devstarter') {
            return ext.activate();
        }
    }
    throw new Error('DevStarter extension not found');
}

/**
 * Deletes a temporary folder without failing: on Windows it may stay locked for a few seconds
 * (antivirus or VS Code's file watcher), and that is not a test failure.
 * @param dir folder to delete
 */
export function removeQuietly(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
        // It stays in the system temp folder, which Windows cleans up by itself.
    }
}
