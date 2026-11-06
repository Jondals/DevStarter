/**
 * terminal.ts
 * ───────────
 * DevStarter's own terminal (a VS Code "Pseudoterminal").
 *
 * Instead of sending commands to a normal terminal without knowing when they finish,
 * we launch each command ourselves (child_process), wait for it to end
 * and draw the progress with animations:
 *
 *   ◝ Installing dependencies…  3/9 · 12s ▰▰▰▱▱▱▱▱▱▱   [v] logs  [ctrl+c] cancel
 *     └ tip  Ctrl+P lets you jump to any file by name.
 *
 *   ◆ Installing dependencies  7.9s
 *     └ $ npm install
 *
 * It also translates common errors into advice a beginner can follow.
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';
import { wait } from './util';
import {
    banner,
    box,
    cursor,
    palette,
    progressBar,
    shimmer,
    spinnerFrames,
    stripAnsi,
    style,
    symbols,
    truncate,
} from './ui';

/** A step that runs a shell command. */
export interface CommandStep {
    kind: 'command';
    title: string;
    command: string;
    cwd: string;
    /** If an optional step fails, only a warning is shown and we move on. */
    optional?: boolean;
    env?: Record<string, string>;
    /** Exit codes (besides 0) that are not an error, e.g. "there is no newer version". */
    okExitCodes?: number[];
    /**
     * Runs when the command ends well: used to check it did what it should
     * (e.g. that the version changed). If it throws, the step fails with that message.
     * @param log writes a detail under the step
     * @param exitCode exit code of the command
     */
    verify?: (log: Logger, exitCode: number) => Promise<void> | void;
    /**
     * npm package this command runs (e.g. "@angular/cli") and how to rebuild the
     * command with another version. Lets us retry with a compatible version
     * if the latest one needs a newer Node.js.
     */
    compat?: { package: string; command: (version: string) => string };
}

/** Function an internal step receives to report what it is doing. */
export type Logger = (message: string) => void;

/** A step that runs the extension's own code (write files, etc.). */
export interface TaskStep {
    kind: 'task';
    title: string;
    run: (log: Logger) => Promise<void> | void;
    optional?: boolean;
}

export type Step = CommandStep | TaskStep;

export type StepsResult = 'success' | 'failed' | 'cancelled';

/** Plan to fix a failed step: steps to run first and the step to retry. */
export interface Recovery {
    /** Message shown before attempting the fix. */
    message: string;
    before: Step[];
    retry: Step;
}

/**
 * Function that receives a failed step and its output, and returns how to fix it (or nothing).
 * Set by the extension with setRecovery().
 */
export type RecoveryHandler = (step: Step, output: string) => Promise<Recovery | undefined>;

/** Internal error to tell "the person cancelled" from "it failed". */
class CancelledError extends Error {}

/** Environment variables that stop generators from asking questions or sending telemetry. */
const quietEnv: Record<string, string> = {
    FORCE_COLOR: '1',
    npm_config_yes: 'true',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    // ! pnpm 11 fails the install if a dependency brings unapproved build scripts.
    pnpm_config_strict_dep_builds: 'false',
    NG_CLI_ANALYTICS: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
    ASTRO_TELEMETRY_DISABLED: '1',
    NUXT_TELEMETRY_DISABLED: '1',
    EXPO_NO_TELEMETRY: '1',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    COMPOSER_NO_INTERACTION: '1',
    GH_PROMPT_DISABLED: '1',
};

/** Tips that rotate under the spinner while waiting (beginner mode). */
const tips = [
    'Ctrl+P lets you jump to any file by typing its name.',
    'Save with Ctrl+S. Most dev servers reload the browser by themselves.',
    'Ctrl+` opens and closes the terminal.',
    'Ctrl+Shift+P finds any VS Code command.',
    'Never commit your .env file. It holds passwords and secrets.',
    'Git lets you undo mistakes. Commit often!',
    'Error messages are clues. Read them from the top.',
    'Alt+↑ / Alt+↓ moves the current line up or down.',
    'Ctrl+D selects the next match so you can edit several at once.',
    'Press v to see what is happening under the hood.',
    'Shift+Alt+F formats the whole file.',
    'F2 renames a variable everywhere it is used.',
    'Ctrl+/ comments or uncomments the selected lines.',
    'F12 jumps to where a function or variable is defined.',
];

/** Error pattern → advice. */
type Hint = [RegExp, string];

const hints: Hint[] = [
    [
        /running scripts is disabled|execution of scripts is disabled|ejecución de scripts está deshabilitada|PSSecurityException|UnauthorizedAccess.*\.ps1/i,
        'PowerShell is blocking scripts. Run "DevStarter: Check & Update My Tools" and click "Fix it for me", or run:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned',
    ],
    [
        /update your Node\.js version|EBADENGINE|requires? (a )?Node(\.js)? version|Unsupported engine/i,
        'Your Node.js version is too old for this tool. Install the latest LTS from https://nodejs.org and restart VS Code.',
    ],
    [
        /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo|network (is )?unreachable|Could not resolve host/i,
        'Looks like a network problem. Check your internet connection (or proxy/VPN) and try again.',
    ],
    [
        /Please tell me who you are|user\.email|user\.name/i,
        'Git does not know who you are yet. Run:  git config --global user.name "Your Name"  and  git config --global user.email "you@example.com"',
    ],
    [
        /gh auth login|not logged into any GitHub hosts|authentication required/i,
        'Log in to GitHub first: run  gh auth login  in a terminal.',
    ],
    [/Name already exists on this account/i, 'You already have a GitHub repository with that name.'],
    [
        /winget.*(not recognized|no se reconoce)|0x8a15/i,
        'Automatic install failed. Install the tool from its website, restart VS Code and try again.',
    ],
    [
        /is not recognized as an internal or external command|no se reconoce como un comando|command not found|ENOENT.*spawn/i,
        'A required program is not installed or not in your PATH. Install it and restart VS Code.',
    ],
    [
        /linker `link\.exe` not found|link\.exe/i,
        'Rust on Windows needs the "Desktop development with C++" workload from Visual Studio Build Tools.',
    ],
    [
        /EACCES|EPERM|operation not permitted|Access is denied|Acceso denegado/i,
        'Permission problem. Pick a folder you own (e.g. inside Documents) and close programs that may be using it.',
    ],
    [/ENOSPC|no space left/i, 'Your disk is full. Free some space and try again.'],
    [
        /gyp ERR|MSBuild|node-gyp/i,
        'A native module failed to compile. On Windows, install "Desktop development with C++" from Visual Studio Build Tools.',
    ],
    [
        /JAVA_HOME|UnsupportedClassVersionError|release version \d+ not supported/i,
        'Your Java version is not compatible. Install JDK 21 (https://adoptium.net) and restart VS Code.',
    ],
    [
        /already exists|is not empty|not an empty directory/i,
        'The target folder already exists. Choose another project name.',
    ],
    [/ERESOLVE|peer dep/i, 'Dependency conflict. Try again, or switch package manager (npm/pnpm) in the wizard.'],
];

/**
 * Translates the most common errors into advice a beginner can follow.
 * @param output output of the failed command
 * @returns the advice, or undefined if the error is not recognized
 */
export function explainError(output: string): string | undefined {
    for (const [pattern, advice] of hints) {
        if (pattern.test(output)) {
            return advice;
        }
    }
    return undefined;
}

/** Options when creating the terminal. */
export interface TerminalOptions {
    /** Show the full output of the commands (can be toggled with the "v" key). */
    verbose: boolean;
    /** Beginner mode: tips instead of output under the spinner. */
    beginner: boolean;
}

/**
 * DevStarter's terminal. VS Code calls open(), close(), handleInput()…
 * and we write by firing the onDidWrite event.
 */
export class DevStarterTerminal implements vscode.Pseudoterminal {
    // VS Code listens to these events to draw text and to close the terminal.
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number | void>();
    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    private terminal!: vscode.Terminal;
    private columns = 80;
    private resolveOpen!: () => void;
    /** Resolves when VS Code opens the terminal; nothing can be written before that. */
    private readonly opened: Promise<void>;

    private verbose: boolean;
    private readonly beginner: boolean;
    private cancelled = false;
    private finished = false;
    private child?: cp.ChildProcess;

    // Spinner state.
    private spinner?: NodeJS.Timeout;
    private spinnerText = '';
    private tick = 0;
    private stepStarted = 0;
    private progress = { done: 0, total: 0 };
    private lastOutput = '';
    /** Output of the last failed step (to try to fix it). */
    private lastFailure = '';
    private recovery?: RecoveryHandler;
    private tipIndex = Math.floor(Math.random() * tips.length);

    /**
     * The constructor is private: use DevStarterTerminal.create().
     * @param opts verbose mode and beginner mode
     */
    private constructor(opts: TerminalOptions) {
        this.verbose = opts.verbose;
        this.beginner = opts.beginner;
        const self = this;
        this.opened = new Promise<void>(function (resolve) {
            self.resolveOpen = resolve;
        });
    }

    /**
     * Creates the terminal, shows it and waits until it is ready for writing.
     * @param name tab title
     * @param opts display options
     */
    static async create(name: string, opts: TerminalOptions): Promise<DevStarterTerminal> {
        const pty = new DevStarterTerminal(opts);
        pty.terminal = vscode.window.createTerminal({
            name,
            pty,
            iconPath: new vscode.ThemeIcon('terminal-powershell'),
        });
        pty.terminal.show();
        // ! VS Code calls open() as soon as it shows the terminal. If for some reason it does not,
        // ! we go on after 10 s instead of hanging forever (the output is kept anyway
        // ! and appears when the terminal opens).
        await Promise.race([pty.opened, wait(10000)]);
        return pty;
    }

    // ── Methods VS Code calls (Pseudoterminal interface) ────────────

    /** VS Code opened the terminal: writing is possible now. */
    open(dimensions: vscode.TerminalDimensions | undefined): void {
        if (dimensions) {
            this.columns = dimensions.columns;
        }
        this.write(cursor.hide);
        this.resolveOpen();
    }

    /** The terminal was resized. */
    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.columns = dimensions.columns;
    }

    /** The person closed the terminal: cancel whatever is running. */
    close(): void {
        this.cancel();
        this.dispose();
    }

    /** Keys pressed inside the terminal. */
    handleInput(data: string): void {
        if (this.finished) {
            this.closeEmitter.fire();
            this.dispose();
            return;
        }
        if (data === '\x03') {
            // Ctrl+C
            this.cancel();
        } else if (data.toLowerCase() === 'v') {
            this.verbose = !this.verbose;
            this.printAbove(style.gray(`  ${symbols.branch} live logs ${this.verbose ? 'on' : 'off'}`));
        }
    }

    // ── Writing ─────────────────────────────────────────────────────

    /** Writes text as is (may include ANSI codes). */
    write(text: string): void {
        this.writeEmitter.fire(text);
    }

    /** Writes a line. Terminals need "\r\n", not just "\n". */
    line(text = ''): void {
        this.write(text.replace(/\r?\n/g, '\r\n') + '\r\n');
    }

    /** Writes several lines. */
    lines(lines: string[]): void {
        for (const l of lines) {
            this.line(l);
        }
    }

    /** Current width of the terminal in columns. */
    get width(): number {
        return this.columns;
    }

    /** Writes a line above the spinner, which always stays at the very bottom. */
    private printAbove(text: string): void {
        if (this.spinner) {
            this.write(cursor.clearBelow);
            this.line(text);
            this.renderSpinner();
        } else {
            this.line(text);
        }
    }

    // ── Animations ──────────────────────────────────────────────────

    /** The banner appears row by row. */
    async banner(): Promise<void> {
        this.line();
        for (const row of banner(this.columns)) {
            this.line(row);
            await wait(35);
        }
        this.line();
    }

    /** Typewriter effect. */
    async typewriter(text: string, delay = 14): Promise<void> {
        this.write('  ');
        for (const ch of text) {
            this.write(style.gray(ch));
            await wait(delay);
        }
        this.line();
    }

    /** Section header: ◈ Title */
    section(title: string): void {
        this.line();
        this.line(`${style.teal(symbols.logo)} ${style.bold(title)}`);
        this.line();
    }

    /**
     * Result line with a colored symbol and details below.
     * @param color color of the symbol
     * @param text main text
     * @param details lines hanging below
     * @param symbol symbol to use (◆ by default)
     */
    result(color: string, text: string, details: string[] = [], symbol: string = symbols.done): void {
        this.line(`${style.color(color, symbol)} ${text}`);
        for (const d of details) {
            this.line(style.gray(`  ${symbols.branch} ${d}`));
        }
    }

    /** Makes a text shine for a moment and then leaves it fixed. */
    async shimmerLine(text: string, durationMs = 1500): Promise<void> {
        const frames = Math.round(durationMs / 40);
        for (let i = 0; i <= frames; i++) {
            this.write(cursor.clearBelow + style.bold(shimmer(text, i, palette.teal, '#ffffff')));
            await wait(40);
        }
        this.line();
    }

    // ── Spinner ─────────────────────────────────────────────────────

    /** Starts animating the spinner with the step title. */
    private startSpinner(text: string): void {
        this.spinnerText = text;
        this.stepStarted = Date.now();
        this.lastOutput = '';
        this.renderSpinner();
        this.spinner = setInterval(this.onSpinnerTick.bind(this), 100);
    }

    /** Every 100 ms: advance the animation and, every ~7 s, change the tip. */
    private onSpinnerTick(): void {
        this.tick++;
        if (this.tick % 70 === 0) {
            this.tipIndex = (this.tipIndex + 1) % tips.length;
        }
        this.renderSpinner();
    }

    /**
     * Draws the two spinner lines and leaves the cursor at the start of the first one,
     * so next time it is enough to clear "from here down".
     */
    private renderSpinner(): void {
        const width = Math.max(this.columns - 1, 20);
        const seconds = Math.floor((Date.now() - this.stepStarted) / 1000);
        const frame = style.teal(spinnerFrames[Math.floor(this.tick / 1.5) % spinnerFrames.length]);
        const counter = style.gray(`${this.progress.done + 1}/${this.progress.total} · ${seconds}s`);
        const bar = progressBar(this.progress.done, this.progress.total, 10);
        const keys = style.color(palette.dim, '[v] logs  [ctrl+c] cancel');
        const title = truncate(this.spinnerText + '…', Math.max(width - 52, 10));
        const first = `${frame} ${shimmer(title, this.tick)}  ${counter} ${bar}  ${keys}`;

        // * Second line: a tip for beginners, or the latest command output.
        let second = '';
        if (!this.verbose) {
            if (this.beginner) {
                second = `  ${style.gray(symbols.branch)} ${style.fuchsia('tip')}  ${style.gray(tips[this.tipIndex])}`;
            } else if (this.lastOutput) {
                second = `  ${style.gray(symbols.branch)} ${style.gray(this.lastOutput)}`;
            }
        }
        const secondLine = second ? '\r\n' + truncate(second, width) + cursor.up() : '';
        this.write(cursor.clearBelow + truncate(first, width) + secondLine + '\r');
    }

    /** Stops the spinner and clears its lines. */
    private stopSpinner(): void {
        if (this.spinner) {
            clearInterval(this.spinner);
            this.spinner = undefined;
        }
        this.write(cursor.clearBelow);
    }

    // ── Running steps ───────────────────────────────────────────────

    /**
     * Runs the steps in order and stops at the first required step that fails.
     * @param steps steps to run
     */
    async runSteps(steps: Step[]): Promise<StepsResult> {
        const queue = [...steps];
        const recovered = new Set<Step>();
        this.progress = { done: 0, total: queue.length };
        for (let i = 0; i < queue.length; i++) {
            if (this.cancelled) {
                return 'cancelled';
            }
            const step = queue[i];
            const outcome = await this.runStep(step);
            if (outcome === 'failed' && this.recovery && !recovered.has(step)) {
                // ! Only one fix attempt per step, to avoid loops.
                recovered.add(step);
                const plan = await this.recovery(step, this.lastFailure);
                if (plan) {
                    recovered.add(plan.retry);
                    this.line();
                    this.result(palette.teal, style.bold(plan.message), [], symbols.logo);
                    this.line();
                    queue.splice(i + 1, 0, ...plan.before, plan.retry);
                    this.progress.total = queue.length;
                    continue;
                }
            }
            if (outcome !== 'success') {
                return outcome;
            }
            this.progress.done++;
        }
        return 'success';
    }

    /**
     * Lets the extension fix failing steps (e.g. update Node.js and retry).
     * @param handler function that decides how to fix a failure
     */
    setRecovery(handler: RecoveryHandler): void {
        this.recovery = handler;
    }

    /**
     * Runs a step with its spinner and writes the result.
     * Optional steps that fail return 'success' (they only show a warning).
     */
    private async runStep(step: Step): Promise<StepsResult> {
        const tail: string[] = []; // last output lines, shown if it fails
        const logs: string[] = []; // messages from internal steps
        const self = this;

        /** Keeps a detail to show under the step (and live if logs are on). */
        function log(message: string): void {
            logs.push(message);
            if (self.verbose) {
                self.printAbove(style.gray(`  ${symbols.pipe} ${message}`));
            }
        }

        this.startSpinner(step.title);
        const started = Date.now();
        try {
            if (step.kind === 'command') {
                const exitCode = await this.exec(step, tail);
                if (step.verify) {
                    await step.verify(log, exitCode);
                }
            } else {
                await step.run(log);
            }
            this.stopSpinner();
            const secs = ((Date.now() - started) / 1000).toFixed(1);
            const details = [...logs];
            // * Experienced users also see the command that ran.
            if (step.kind === 'command' && !this.beginner) {
                details.unshift(`$ ${truncate(step.command, Math.max(this.columns - 10, 20))}`);
            }
            this.result(palette.green, `${step.title}  ${style.gray(secs + 's')}`, details);
            return 'success';
        } catch (err) {
            this.stopSpinner();
            if (this.cancelled || err instanceof CancelledError) {
                this.result(palette.amber, `${step.title} ${style.gray('(cancelled)')}`, [], symbols.warn);
                return 'cancelled';
            }
            const message = err instanceof Error ? err.message : String(err);
            this.lastFailure = tail.join('\n') + '\n' + message;
            const hint = explainError(this.lastFailure);
            if (step.optional) {
                this.result(palette.amber, `${step.title} ${style.gray('(skipped)')}`, [hint ?? message], symbols.warn);
                return 'success';
            }
            this.result(palette.rose, style.bold(step.title), [], symbols.fail);
            this.line(style.rose(`  ${symbols.branch} ${message}`));
            this.showFailure(tail, hint);
            return 'failed';
        }
    }

    /** Shows the last output lines in a red box, plus the advice if there is any. */
    private showFailure(tail: string[], hint: string | undefined): void {
        this.line();
        if (tail.length && !this.verbose) {
            const shown: string[] = [];
            for (const l of tail.slice(-15)) {
                shown.push(style.gray(truncate(l, Math.max(this.columns - 10, 20))));
            }
            for (const l of box(shown, { color: palette.rose, title: 'Last output', padding: 1 })) {
                this.line('  ' + l);
            }
        }
        if (hint) {
            this.line();
            this.line(`  ${style.amber('💡 ' + hint)}`);
        }
    }

    /**
     * Launches a command and resolves with its exit code when it ends well
     * (code 0 or one of those accepted in `okExitCodes`).
     * @param step step with the command and the folder
     * @param tail the last output lines are collected here
     */
    private exec(step: CommandStep, tail: string[]): Promise<number> {
        if (this.verbose) {
            this.printAbove(style.gray(`  $ ${step.command}`));
        }
        const self = this;
        return new Promise(function (resolve, reject) {
            const child = cp.spawn(step.command, {
                cwd: step.cwd,
                shell: true,
                windowsHide: true,
                // ! No standard input: if something tries to ask a question, it fails fast instead of hanging.
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...quietEnv, ...step.env },
            });
            self.child = child;

            let partial = '';
            /** Output arrives in chunks: join them and handle each complete line. */
            function onData(chunk: Buffer): void {
                const parts = (partial + chunk.toString()).split(/\r?\n/);
                partial = parts.pop() ?? '';
                for (const l of parts) {
                    self.onOutputLine(l, tail);
                }
            }
            child.stdout?.on('data', onData);
            child.stderr?.on('data', onData);

            child.on('error', function (err) {
                self.child = undefined;
                reject(err);
            });
            child.on('close', function (code) {
                self.child = undefined;
                if (partial) {
                    self.onOutputLine(partial, tail);
                }
                if (self.cancelled) {
                    reject(new CancelledError());
                } else if (code === 0 || (code !== null && step.okExitCodes?.includes(code >>> 0))) {
                    resolve(code ?? 0);
                } else {
                    reject(new Error(`Command failed with exit code ${code}: ${step.command}`));
                }
            });
        });
    }

    /** Processes an output line: keeps it and, if live logs are on, shows it. */
    private onOutputLine(raw: string, tail: string[]): void {
        // Keep what comes after the last "\r" (progress bars) and drop cursor
        // movements, but keep the colors (codes ending in "m").
        const line = (raw.split('\r').pop() ?? '').replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, '').trimEnd();
        const plain = stripAnsi(line).trim();
        if (!plain) {
            return;
        }
        tail.push(plain);
        if (tail.length > 60) {
            tail.shift();
        }
        this.lastOutput = plain;
        if (this.verbose) {
            this.printAbove(style.gray(`  ${symbols.pipe} `) + truncate(line, Math.max(this.columns - 6, 20)));
        }
    }

    /** Cancels the current step by killing the process (and its children). */
    cancel(): void {
        if (this.cancelled || this.finished) {
            return;
        }
        this.cancelled = true;
        const child = this.child;
        if (child?.pid) {
            if (process.platform === 'win32') {
                // ! With shell: true the command runs inside cmd.exe, so we kill the whole tree.
                cp.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            } else {
                child.kill('SIGTERM');
            }
        }
    }

    /** Once finished, any key closes the terminal. */
    finish(): void {
        this.finished = true;
        this.stopSpinner();
        this.line();
        this.line(style.gray('  Press any key to close this terminal.'));
        this.write(cursor.show);
    }

    /** Frees the terminal's resources. */
    private dispose(): void {
        this.stopSpinner();
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }
}
