/**
 * ui.ts
 * ─────
 * Utilidades para "pintar" en el terminal con códigos ANSI: colores, degradados,
 * el efecto de brillo que recorre el texto, cajas, la barra de progreso y el banner.
 *
 * Un código ANSI es una secuencia que empieza por ESC + "[" y que el terminal
 * interpreta en vez de mostrarla. Por ejemplo "\x1b[1m" activa la negrita.
 * Aquí no se escribe nada en pantalla: solo se construyen textos que luego
 * escribe terminal.ts.
 */

const ESC = '\x1b[';

/** Un color como [rojo, verde, azul], cada uno de 0 a 255. */
type RGB = [number, number, number];

/** Paleta de colores de DevStarter: turquesa, índigo y fucsia. */
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

/** Degradado de la marca, usado en el banner, títulos y barra de progreso. */
export const brandGradient = [palette.teal, palette.indigo, palette.fuchsia];

/**
 * Convierte "#rrggbb" en [r, g, b].
 * @param hex color en hexadecimal
 */
function hexToRgb(hex: string): RGB {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Código ANSI "truecolor" (24 bits) que cambia el color del texto.
 * @param rgb color a usar
 */
function fg(rgb: RGB): string {
    return `${ESC}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

/** Funciones de estilo: cada una envuelve el texto y después restaura el estilo normal. */
export const style = {
    /** Texto en negrita. */
    bold: function (s: string): string {
        return `${ESC}1m${s}${ESC}22m`;
    },
    /** Texto atenuado. */
    dim: function (s: string): string {
        return `${ESC}2m${s}${ESC}22m`;
    },
    /** Texto en cursiva. */
    italic: function (s: string): string {
        return `${ESC}3m${s}${ESC}23m`;
    },
    /** Texto subrayado. */
    underline: function (s: string): string {
        return `${ESC}4m${s}${ESC}24m`;
    },
    /** Texto del color indicado en hexadecimal. */
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

/** Movimientos de cursor y borrado de pantalla. */
export const cursor = {
    hide: `${ESC}?25l`,
    show: `${ESC}?25h`,
    /** Vuelve al principio de la línea y borra desde ahí hasta el final de la pantalla. */
    clearBelow: `\r${ESC}J`,
    /** Sube el cursor `n` líneas. */
    up: function (n = 1): string {
        return `${ESC}${n}A`;
    },
};

/** Símbolos usados en el terminal (todos ocupan una sola columna). */
export const symbols = {
    /** Paso terminado (su color indica el resultado). */
    done: '◆',
    /** Paso fallido. */
    fail: '✗',
    /** Aviso. */
    warn: '▲',
    /** Rama para los detalles debajo de un paso. */
    branch: '└',
    /** Logo de DevStarter en títulos. */
    logo: '◈',
    /** Flecha para comandos sugeridos. */
    arrow: '❯',
    /** Barra vertical para los logs en directo. */
    pipe: '│',
};

/** Fotogramas del spinner: un arco que gira. */
export const spinnerFrames = ['◜', '◠', '◝', '◞', '◡', '◟'];

/**
 * Mezcla dos colores.
 * @param a color inicial
 * @param b color final
 * @param t cuánto de `b` (0 = todo `a`, 1 = todo `b`)
 */
function mix(a: RGB, b: RGB, t: number): RGB {
    return [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
    ];
}

/**
 * Color en la posición `t` (0..1) de un degradado con varias paradas.
 * @param stops colores del degradado
 * @param t posición dentro del degradado
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
 * "Ida y vuelta": convierte cualquier número en un valor 0..1 que sube y baja.
 * Sirve para desplazar un degradado sin que el color salte de golpe al principio.
 * @param t posición (puede ser mayor que 1)
 */
function pingPong(t: number): number {
    const p = ((t % 2) + 2) % 2;
    return p > 1 ? 2 - p : p;
}

/**
 * Pinta cada carácter del texto con un color del degradado.
 * @param text texto a colorear
 * @param stops colores del degradado
 * @param offset desplazamiento del degradado (útil para animaciones)
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
 * Efecto de brillo: una franja clara recorre el texto.
 * Cada vez que se llama con un `tick` mayor, la franja avanza un carácter.
 * @param text texto a animar
 * @param tick número de fotograma
 * @param base color normal del texto
 * @param highlight color del brillo
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
        // Cuanto más cerca del centro de la franja, más claro.
        const t = distance > 3 ? 0 : 1 - distance / 4;
        out += fg(mix(baseRgb, lightRgb, t)) + chars[i];
    }
    return out + `${ESC}39m`;
}

/** Expresión que reconoce cualquier código ANSI. */
const ansiPattern = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Quita los códigos ANSI de un texto.
 * @param s texto con colores
 */
export function stripAnsi(s: string): string {
    return s.replace(ansiPattern, '');
}

/**
 * Longitud que se ve en pantalla (sin contar los códigos ANSI).
 * @param s texto a medir
 */
export function visibleLength(s: string): number {
    return [...stripAnsi(s)].length;
}

/**
 * Recorta el texto a `max` columnas visibles, añadiendo "…" si hace falta.
 * Si recorta, devuelve el texto sin colores.
 * @param s texto a recortar
 * @param max columnas máximas
 */
export function truncate(s: string, max: number): string {
    const plain = [...stripAnsi(s)];
    if (plain.length <= max) {
        return s;
    }
    return plain.slice(0, Math.max(max - 1, 0)).join('') + '…';
}

/** Opciones para dibujar una caja. */
export interface BoxOptions {
    color?: string;
    title?: string;
    padding?: number;
    minWidth?: number;
}

/**
 * Dibuja una caja con esquinas redondeadas alrededor de las líneas.
 * @param lines contenido de la caja
 * @param opts color, título, márgenes y ancho mínimo
 * @returns las líneas ya dibujadas
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
 * Barra de progreso compacta, por ejemplo ▰▰▰▰▱▱▱▱.
 * @param done pasos terminados
 * @param total pasos totales
 * @param width ancho en caracteres
 */
export function progressBar(done: number, total: number, width = 10): string {
    const filled = total === 0 ? width : Math.round((done / total) * width);
    return gradient('▰'.repeat(filled)) + style.color(palette.dim, '▱'.repeat(width - filled));
}

/** Letras en estilo "ANSI Shadow". Se componen al vuelo para que el banner siempre cuadre. */
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
 * Banner grande "DEVSTARTER" con degradado, o una versión de una línea si el terminal es estrecho.
 * @param columns ancho del terminal
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
    // Cada fila desplaza un poco el degradado para dar un brillo en diagonal.
    const out: string[] = [];
    for (let i = 0; i < rows.length; i++) {
        out.push('  ' + gradient(rows[i], brandGradient, i * 0.03));
    }
    return out;
}
