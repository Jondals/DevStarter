/**
 * ui.ts
 * ─────
 * Helpers to "paint" in the terminal with ANSI codes: colors, gradients,
 * the shine effect that runs across the text, boxes, the progress bar and the banner.
 *
 * An ANSI code is a sequence starting with ESC + "[" that the terminal interprets
 * instead of showing it. For example "\x1b[1m" turns bold on.
 * ? Nothing is written to the screen here: this only builds strings that
 * terminal.ts writes later.
 */

const ESC = '\x1b[';

/** A color as [red, green, blue], each from 0 to 255. */
type RGB = [number, number, number];

/** DevStarter's color palette: teal, indigo and fuchsia. */
export const palette = {
    teal: '#2dd4bf',
    sky: '#38bdf8',
    indigo: '#818cf8',
    indigoLight: '#e0e7ff',
    fuchsia: '#e879f9',
    green: '#4ade80',
    amber: '#fbbf24',
    rose: '#fb7185',
    gray: '#94a3b8',
    dim: '#475569',
};

/** Brand gradient, used in the banner, titles and progress bar. */
export const brandGradient = [palette.teal, palette.indigo, palette.fuchsia];

/**
 * Turns "#rrggbb" into [r, g, b].
 * @param hex color in hexadecimal
 */
function hexToRgb(hex: string): RGB {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * "Truecolor" (24-bit) ANSI code that changes the text color.
 * @param rgb color to use
 */
function fg(rgb: RGB): string {
    return `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

/** Style functions: each wraps the text and then restores the normal style. */
export const style = {
    /** Bold text. */
    bold: function (s: string): string {
        return `${ESC}1m${s}${ESC}22m`;
    },
    /** Dimmed text. */
    dim: function (s: string): string {
        return `${ESC}2m${s}${ESC}22m`;
    },
    /** Italic text. */
    italic: function (s: string): string {
        return `${ESC}3m${s}${ESC}23m`;
    },
    /** Underlined text. */
    underline: function (s: string): string {
        return `${ESC}4m${s}${ESC}24m`;
    },
    /** Text in the given hex color. */
    color: function (hex: string, s: string): string {
        return `${fg(hexToRgb(hex))}${s}${ESC}39m`;
    },
    teal: function (s: string): string {
        return style.color(palette.teal, s);
    },
    indigo: function (s: string): string {
        return style.color(palette.indigo, s);
    },
    fuchsia: function (s: string): string {
        return style.color(palette.fuchsia, s);
    },
    green: function (s: string): string {
        return style.color(palette.green, s);
    },
    amber: function (s: string): string {
        return style.color(palette.amber, s);
    },
    rose: function (s: string): string {
        return style.color(palette.rose, s);
    },
    gray: function (s: string): string {
        return style.color(palette.gray, s);
    },
};

/** Cursor movements and screen clearing. */
export const cursor = {
    hide: `${ESC}?25l`,
    show: `${ESC}?25h`,
    /** Goes back to the start of the line and clears from there to the end of the screen. */
    clearBelow: `\r${ESC}J`,
    /** Moves the cursor up `n` lines. */
    up: function (n = 1): string {
        return `${ESC}${n}A`;
    },
};

/** Symbols used in the terminal (all of them take a single column). */
export const symbols = {
    /** Finished step (its color tells the result). */
    done: '◆',
    /** Failed step. */
    fail: '✗',
    /** Warning. */
    warn: '▲',
    /** Branch for the details under a step. */
    branch: '└',
    /** DevStarter logo in titles. */
    logo: '◈',
    /** Arrow for suggested commands. */
    arrow: '❯',
    /** Vertical bar for live logs. */
    pipe: '│',
};

/** Spinner frames: a spinning arc. */
export const spinnerFrames = ['◜', '◠', '◝', '◞', '◡', '◟'];

/**
 * Mixes two colors.
 * @param a start color
 * @param b end color
 * @param t how much of `b` (0 = all `a`, 1 = all `b`)
 */
function mix(a: RGB, b: RGB, t: number): RGB {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

/**
 * Color at position `t` (0..1) of a gradient with several stops.
 * @param stops colors of the gradient
 * @param t position inside the gradient
 */
function gradientAt(stops: RGB[], t: number): RGB {
    if (stops.length === 1) {
        return stops[0];
    }
    const clamped = Math.min(Math.max(t, 0), 1);
    const scaled = clamped * (stops.length - 1);
    const i = Math.min(Math.floor(scaled), stops.length - 2);
    return mix(stops[i], stops[i + 1], scaled - i);
}

/**
 * "Ping-pong": turns any number into a 0..1 value that goes up and down.
 * Used to shift a gradient without the color jumping back at the start.
 * @param t position (may be greater than 1)
 */
function pingPong(t: number): number {
    const p = ((t % 2) + 2) % 2;
    return p > 1 ? 2 - p : p;
}

/**
 * Paints each character of the text with a color from the gradient.
 * @param text text to color
 * @param stops colors of the gradient
 * @param offset gradient shift (useful for animations)
 */
export function gradient(text: string, stops: string[] = brandGradient, offset = 0): string {
    const rgb = stops.map(hexToRgb);
    const chars = [...text];
    const span = Math.max(chars.length - 1, 1);
    let out = '';
    for (let i = 0; i < chars.length; i++) {
        out += chars[i] === ' ' ? ' ' : fg(gradientAt(rgb, pingPong(i / span + offset))) + chars[i];
    }
    return out + `${ESC}39m`;
}

/**
 * Shine effect: a light stripe runs across the text.
 * Each call with a higher `tick` moves the stripe one character.
 * @param text text to animate
 * @param tick frame number
 * @param base normal text color
 * @param highlight shine color
 */
export function shimmer(text: string, tick: number, base = palette.indigo, highlight = palette.indigoLight): string {
    const chars = [...text];
    const baseRgb = hexToRgb(base);
    const lightRgb = hexToRgb(highlight);
    const cycle = chars.length + 12;
    const center = (tick % cycle) - 6;
    let out = '';
    for (let i = 0; i < chars.length; i++) {
        const distance = Math.abs(i - center);
        // The closer to the middle of the stripe, the lighter.
        const t = distance > 3 ? 0 : 1 - distance / 4;
        out += fg(mix(baseRgb, lightRgb, t)) + chars[i];
    }
    return out + `${ESC}39m`;
}

/** Expression that matches any ANSI code. */
const ansiPattern = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Removes the ANSI codes from a text.
 * @param s text with colors
 */
export function stripAnsi(s: string): string {
    return s.replace(ansiPattern, '');
}

/**
 * Length as seen on screen (without counting ANSI codes).
 * @param s text to measure
 */
export function visibleLength(s: string): number {
    return [...stripAnsi(s)].length;
}

/**
 * Cuts the text to `max` visible columns, adding "…" if needed.
 * If it cuts, it returns the text without colors.
 * @param s text to cut
 * @param max maximum columns
 */
export function truncate(s: string, max: number): string {
    const plain = [...stripAnsi(s)];
    if (plain.length <= max) {
        return s;
    }
    return plain.slice(0, Math.max(max - 1, 0)).join('') + '…';
}

/** Options to draw a box. */
export interface BoxOptions {
    color?: string;
    title?: string;
    padding?: number;
    minWidth?: number;
}

/**
 * Draws a box with rounded corners around the lines.
 * @param lines contents of the box
 * @param opts color, title, padding and minimum width
 * @returns the drawn lines
 */
export function box(lines: string[], opts: BoxOptions = {}): string[] {
    const color = opts.color ?? palette.indigo;
    const pad = opts.padding ?? 2;
    const titleWidth = opts.title ? visibleLength(opts.title) + 2 : 0;
    const inner = Math.max(opts.minWidth ?? 0, titleWidth, ...lines.map(visibleLength)) + pad * 2;

    let top: string;
    if (opts.title) {
        const rest = Math.max(inner - visibleLength(opts.title) - 3, 0);
        top = style.color(color, '╭─ ') + style.bold(opts.title) + style.color(color, ' ' + '─'.repeat(rest) + '╮');
    } else {
        top = style.color(color, '╭' + '─'.repeat(inner) + '╮');
    }
    const body: string[] = [];
    for (const line of lines) {
        const fill = Math.max(inner - pad - visibleLength(line), 0);
        body.push(style.color(color, '│') + ' '.repeat(pad) + line + ' '.repeat(fill) + style.color(color, '│'));
    }
    const bottom = style.color(color, '╰' + '─'.repeat(inner) + '╯');
    return [top, ...body, bottom];
}

/**
 * Compact progress bar, e.g. ▰▰▰▰▱▱▱▱.
 * @param done finished steps
 * @param total total steps
 * @param width width in characters
 */
export function progressBar(done: number, total: number, width = 10): string {
    const filled = total === 0 ? width : Math.round((done / total) * width);
    return gradient('▰'.repeat(filled)) + style.color(palette.dim, '▱'.repeat(width - filled));
}

/** "ANSI Shadow" style letters. Composed on the fly so the banner always lines up. */
const glyphs: Record<string, string[]> = {
    D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
    E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
    V: ['██╗   ██╗', '██║   ██║', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚═══╝  '],
    S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
    T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
    A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
    R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
};

/**
 * Big "DEVSTARTER" banner with a gradient, or a one-line version if the terminal is narrow.
 * @param columns terminal width
 */
export function banner(columns: number): string[] {
    const word = [...'DEVSTARTER'];
    const rows: string[] = [];
    for (let row = 0; row < glyphs.D.length; row++) {
        let line = '';
        for (const letter of word) {
            line += glyphs[letter][row];
        }
        rows.push(line);
    }
    if (columns < visibleLength(rows[0]) + 4) {
        return [gradient(`  ${symbols.logo} D E V S T A R T E R ${symbols.logo}`)];
    }
    // * Each row shifts the gradient a little to give a diagonal shine.
    const out: string[] = [];
    for (let i = 0; i < rows.length; i++) {
        out.push('  ' + gradient(rows[i], brandGradient, i * 0.03));
    }
    return out;
}
