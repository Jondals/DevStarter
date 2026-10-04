/**
 * scripts/smoke/vscode-mock.js
 * ────────────────────────────
 * Imitación mínima de la API "vscode" para ejecutar el terminal y las plantillas
 * de DevStarter desde Node, sin abrir VS Code. Solo implementa lo que usan.
 */

/** Imitación de vscode.EventEmitter. */
class EventEmitter {
    constructor() {
        this.listeners = [];
        const self = this;
        this.event = function (listener) {
            self.listeners.push(listener);
            return { dispose() {} };
        };
    }
    fire(value) {
        for (const listener of this.listeners) {
            listener(value);
        }
    }
    dispose() {
        this.listeners = [];
    }
}

/** Imitación de vscode.ThemeIcon. */
class ThemeIcon {
    constructor(id) {
        this.id = id;
    }
}

/** Si SMOKE_VERBOSE=1, la salida del terminal se ve en la consola. */
const verbose = process.env.SMOKE_VERBOSE === '1';

module.exports = {
    EventEmitter,
    ThemeIcon,
    window: {
        createTerminal(options) {
            if (verbose) {
                options.pty.onDidWrite(function (text) {
                    process.stdout.write(text);
                });
            }
            setTimeout(function () {
                options.pty.open({ columns: 120, rows: 40 });
            }, 0);
            return { show() {}, dispose() {} };
        },
    },
    workspace: {
        getConfiguration() {
            return {
                get(_key, fallback) {
                    return fallback;
                },
            };
        },
    },
};
