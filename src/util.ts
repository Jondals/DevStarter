/**
 * util.ts
 * ───────
 * Utilidades mínimas que usan varios módulos.
 */

/**
 * Espera unos milisegundos.
 * @param ms milisegundos
 */
export function wait(ms: number): Promise<void> {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}
