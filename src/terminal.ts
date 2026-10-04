/**
 * terminal.ts
 * ───────────
 * Terminal propio de DevStarter (un "Pseudoterminal" de VS Code).
 *
 * En vez de mandar comandos a un terminal normal sin saber cuándo terminan,
 * aquí lanzamos cada comando nosotros (child_process), esperamos a que acabe
 * y dibujamos el progreso con animaciones:
 *
 *   ◝ Installing dependencies…  3/9 · 12s ▰▰▰▱▱▱▱▱▱▱   [v] logs  [ctrl+c] cancel
 *     └ tip  Ctrl+P lets you jump to any file by name.
 *
 *   ◆ Installing dependencies  7.9s
 *     └ $ npm install
 *
 * También traduce los errores típicos a consejos que una persona novata entienda.
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

/** Paso que ejecuta un comando de consola. */
export interface CommandStep {
    kind: 'command';
    title: string;
    command: string;
    cwd: string;
    /** Si un paso opcional falla, solo se muestra un aviso y se sigue adelante. */
    optional?: boolean;
    env?: Record<string, string>;
    /** Códigos de salida (además del 0) que no son un error, p. ej. "no hay una versión más nueva". */
    okExitCodes?: number[];
    /**
     * Se ejecuta cuando el comando termina bien: sirve para comprobar que hizo lo que debía
     * (p. ej. que la versión cambió). Si lanza un error, el paso falla con ese mensaje.
     * @param log escribe un detalle bajo el paso
     * @param exitCode código con el que terminó el comando
     */
    verify?: (log: Logger, exitCode: number) => Promise<void> | void;
    /**
     * Paquete de npm que ejecuta este comando (p. ej. "@angular/cli") y cómo reconstruir el
     * comando con otra versión. Permite volver a intentarlo con una versión compatible
     * si la última pide un Node.js más nuevo.
     */
    compat?: { package: string; command: (version: string) => string };
}

/** Función que recibe un paso interno para ir contando lo que hace. */
export type Logger = (message: string) => void;

/** Paso que ejecuta código de la propia extensión (escribir ficheros, etc.). */
export interface TaskStep {
    kind: 'task';
    title: string;
    run: (log: Logger) => Promise<void> | void;
    optional?: boolean;
}

export type Step = CommandStep | TaskStep;

export type StepsResult = 'success' | 'failed' | 'cancelled';

/** Plan para arreglar un paso que ha fallado: pasos previos y el paso a reintentar. */
export interface Recovery {
    /** Mensaje que se muestra antes de intentar el arreglo. */
    message: string;
    before: Step[];
    retry: Step;
}

/**
 * Función que recibe un paso fallido y su salida, y devuelve cómo arreglarlo (o nada).
 * La pone la extensión con setRecovery().
 */
export type RecoveryHandler = (step: Step, output: string) => Promise<Recovery | undefined>;

/** Error interno para distinguir "lo canceló la persona" de "falló". */
class CancelledError extends Error {}

/** Variables de entorno que hacen que los generadores no pregunten nada y no envíen telemetría. */
const quietEnv: Record<string, string> = {
    FORCE_COLOR: '1',
    npm_config_yes: 'true',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    // pnpm 11 hace fallar la instalación si una dependencia trae scripts de build sin aprobar.
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

/** Consejos que van rotando bajo el spinner mientras se espera (modo principiante). */
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

/** Patrón de error → consejo. */
type Hint = [RegExp, string];

const hints: Hint[] = [
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
 * Traduce los errores más típicos a un consejo que una persona novata pueda seguir.
 * @param output salida del comando que falló
 * @returns el consejo, o undefined si no reconoce el error
 */
export function explainError(output: string): string | undefined {
    for (const [pattern, advice] of hints) {
        if (pattern.test(output)) {
            return advice;
        }
    }
    return undefined;
}

/** Opciones al crear el terminal. */
export interface TerminalOptions {
    /** Mostrar toda la salida de los comandos (se puede cambiar con la tecla "v"). */
    verbose: boolean;
    /** Modo principiante: consejos en vez de salida bajo el spinner. */
    beginner: boolean;
}

/**
 * El terminal de DevStarter. VS Code llama a open(), close(), handleInput()…
 * y nosotros escribimos lanzando el evento onDidWrite.
 */
export class DevStarterTerminal implements vscode.Pseudoterminal {
    // VS Code escucha estos eventos para pintar texto y para cerrar el terminal.
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number | void>();
    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;

    private terminal!: vscode.Terminal;
    private columns = 80;
    private resolveOpen!: () => void;
    /** Se resuelve cuando VS Code abre el terminal; antes de eso no se puede escribir. */
    private readonly opened: Promise<void>;

    private verbose: boolean;
    private readonly beginner: boolean;
    private cancelled = false;
    private finished = false;
    private child?: cp.ChildProcess;

    // Estado del spinner.
    private spinner?: NodeJS.Timeout;
    private spinnerText = '';
    private tick = 0;
    private stepStarted = 0;
    private progress = { done: 0, total: 0 };
    private lastOutput = '';
    /** Salida del último paso que falló (para intentar arreglarlo). */
    private lastFailure = '';
    private recovery?: RecoveryHandler;
    private tipIndex = Math.floor(Math.random() * tips.length);

    /**
     * El constructor es privado: hay que usar DevStarterTerminal.create().
     * @param opts modo detallado y modo principiante
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
     * Crea el terminal, lo muestra y espera a que esté listo para escribir.
     * @param name título de la pestaña
     * @param opts opciones de visualización
     */
    static async create(name: string, opts: TerminalOptions): Promise<DevStarterTerminal> {
        const pty = new DevStarterTerminal(opts);
        pty.terminal = vscode.window.createTerminal({
            name,
            pty,
            iconPath: new vscode.ThemeIcon('terminal-powershell'),
        });
        pty.terminal.show();
        // VS Code llama a open() en cuanto muestra el terminal. Si por lo que sea no lo hace,
        // seguimos a los 10 s en vez de quedarnos colgados para siempre (la salida se guardaría
        // igualmente y aparece cuando el terminal se abra).
        await Promise.race([pty.opened, wait(10000)]);
        return pty;
    }

    // ── Métodos que llama VS Code (interfaz Pseudoterminal) ─────────

    /** VS Code ha abierto el terminal: ya se puede escribir. */
    open(dimensions: vscode.TerminalDimensions | undefined): void {
        if (dimensions) {
            this.columns = dimensions.columns;
        }
        this.write(cursor.hide);
        this.resolveOpen();
    }

    /** El terminal cambió de tamaño. */
    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.columns = dimensions.columns;
    }

    /** La persona cerró el terminal: cancelamos lo que esté en marcha. */
    close(): void {
        this.cancel();
        this.dispose();
    }

    /** Teclas pulsadas dentro del terminal. */
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

    // ── Escritura ───────────────────────────────────────────────────

    /** Escribe texto tal cual (puede incluir códigos ANSI). */
    write(text: string): void {
        this.writeEmitter.fire(text);
    }

    /** Escribe una línea. Los terminales necesitan "\r\n", no solo "\n". */
    line(text = ''): void {
        this.write(text.replace(/\r?\n/g, '\r\n') + '\r\n');
    }

    /** Escribe varias líneas. */
    lines(lines: string[]): void {
        for (const l of lines) {
            this.line(l);
        }
    }

    /** Ancho actual del terminal en columnas. */
    get width(): number {
        return this.columns;
    }

    /** Escribe una línea por encima del spinner, que se queda siempre abajo del todo. */
    private printAbove(text: string): void {
        if (this.spinner) {
            this.write(cursor.clearBelow);
            this.line(text);
            this.renderSpinner();
        } else {
            this.line(text);
        }
    }

    // ── Animaciones ─────────────────────────────────────────────────

    /** El banner aparece fila a fila. */
    async banner(): Promise<void> {
        this.line();
        for (const row of banner(this.columns)) {
            this.line(row);
            await wait(35);
        }
        this.line();
    }

    /** Efecto máquina de escribir. */
    async typewriter(text: string, delay = 14): Promise<void> {
        this.write('  ');
        for (const ch of text) {
            this.write(style.gray(ch));
            await wait(delay);
        }
        this.line();
    }

    /** Cabecera de sección: ◈ Título */
    section(title: string): void {
        this.line();
        this.line(`${style.teal(symbols.logo)} ${style.bold(title)}`);
        this.line();
    }

    /**
     * Línea de resultado con un símbolo de color y detalles debajo.
     * @param color color del símbolo
     * @param text texto principal
     * @param details líneas que cuelgan debajo
     * @param symbol símbolo a usar (◆ por defecto)
     */
    result(color: string, text: string, details: string[] = [], symbol: string = symbols.done): void {
        this.line(`${style.color(color, symbol)} ${text}`);
        for (const d of details) {
            this.line(style.gray(`  ${symbols.branch} ${d}`));
        }
    }

    /** Hace brillar un texto durante un momento y lo deja fijo. */
    async shimmerLine(text: string, durationMs = 1500): Promise<void> {
        const frames = Math.round(durationMs / 40);
        for (let i = 0; i <= frames; i++) {
            this.write(cursor.clearBelow + style.bold(shimmer(text, i, palette.teal, '#ffffff')));
            await wait(40);
        }
        this.line();
    }

    // ── Spinner ─────────────────────────────────────────────────────

    /** Empieza a animar el spinner con el título del paso. */
    private startSpinner(text: string): void {
        this.spinnerText = text;
        this.stepStarted = Date.now();
        this.lastOutput = '';
        this.renderSpinner();
        this.spinner = setInterval(this.onSpinnerTick.bind(this), 100);
    }

    /** Cada 100 ms: avanza la animación y, cada ~7 s, cambia de consejo. */
    private onSpinnerTick(): void {
        this.tick++;
        if (this.tick % 70 === 0) {
            this.tipIndex = (this.tipIndex + 1) % tips.length;
        }
        this.renderSpinner();
    }

    /**
     * Dibuja las dos líneas del spinner y deja el cursor al principio de la primera,
     * así la siguiente vez basta con borrar "desde aquí hacia abajo".
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

        // Segunda línea: un consejo para principiantes, o la última salida del comando.
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

    /** Para el spinner y borra sus líneas. */
    private stopSpinner(): void {
        if (this.spinner) {
            clearInterval(this.spinner);
            this.spinner = undefined;
        }
        this.write(cursor.clearBelow);
    }

    // ── Ejecución de pasos ──────────────────────────────────────────

    /**
     * Ejecuta los pasos en orden y se detiene en el primer paso obligatorio que falle.
     * @param steps pasos a ejecutar
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
                // Un solo intento de arreglo por paso, para no entrar en un bucle.
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
     * Permite a la extensión arreglar pasos que fallan (p. ej. actualizar Node.js y reintentar).
     * @param handler función que decide cómo arreglar un fallo
     */
    setRecovery(handler: RecoveryHandler): void {
        this.recovery = handler;
    }

    /**
     * Ejecuta un paso con su spinner y escribe el resultado.
     * Los pasos opcionales que fallan devuelven 'success' (solo muestran un aviso).
     */
    private async runStep(step: Step): Promise<StepsResult> {
        const tail: string[] = []; // últimas líneas de salida, para mostrarlas si falla
        const logs: string[] = []; // mensajes de los pasos internos
        const self = this;

        /** Guarda un detalle para mostrarlo bajo el paso (y en directo si hay logs activados). */
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
            // Los programadores ven también el comando que se ejecutó.
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

    /** Muestra las últimas líneas de salida en una caja roja y el consejo, si lo hay. */
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
     * Lanza un comando y resuelve con su código de salida cuando termina bien
     * (código 0 o uno de los aceptados en `okExitCodes`).
     * @param step paso con el comando y la carpeta
     * @param tail aquí se van guardando las últimas líneas de salida
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
                // Sin entrada estándar: si algo intenta preguntar, falla rápido en vez de quedarse colgado.
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...quietEnv, ...step.env },
            });
            self.child = child;

            // La salida llega en trozos; juntamos hasta tener líneas completas.
            let partial = '';
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

    /** Procesa una línea de salida: la guarda y, si hay logs en directo, la muestra. */
    private onOutputLine(raw: string, tail: string[]): void {
        // Nos quedamos con lo último tras un "\r" (barras de progreso) y quitamos
        // los movimientos de cursor, pero conservamos los colores (códigos que acaban en "m").
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

    /** Cancela el paso actual matando el proceso (y sus hijos). */
    cancel(): void {
        if (this.cancelled || this.finished) {
            return;
        }
        this.cancelled = true;
        const child = this.child;
        if (child?.pid) {
            if (process.platform === 'win32') {
                // Con shell: true el comando va dentro de cmd.exe, así que matamos todo el árbol.
                cp.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
            } else {
                child.kill('SIGTERM');
            }
        }
    }

    /** Al terminar, cualquier tecla cierra el terminal. */
    finish(): void {
        this.finished = true;
        this.stopSpinner();
        this.line();
        this.line(style.gray('  Press any key to close this terminal.'));
        this.write(cursor.show);
    }

    /** Libera los recursos del terminal. */
    private dispose(): void {
        this.stopSpinner();
        this.writeEmitter.dispose();
        this.closeEmitter.dispose();
    }
}
