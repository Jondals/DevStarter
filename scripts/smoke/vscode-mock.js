/**
 * scripts/smoke/vscode-mock.js
 * ────────────────────────────
 * Minimal imitation of the "vscode" API to run DevStarter's terminal and templates
 * from Node, without opening VS Code. It only implements what they use.
 */

/** Imitation of vscode.EventEmitter. */
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

/** Imitation of vscode.ThemeIcon. */
class ThemeIcon {
    constructor(id) {
        this.id = id;
    }
}

/** With SMOKE_VERBOSE=1 the terminal output is shown in the console. */
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
