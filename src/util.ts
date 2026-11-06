/**
 * util.ts
 * ───────
 * Tiny helpers used by several modules.
 */

/**
 * Waits a few milliseconds.
 * @param ms milliseconds
 */
export function wait(ms: number): Promise<void> {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}
