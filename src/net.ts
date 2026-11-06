/**
 * net.ts
 * ──────
 * DevStarter's downloads, all through the same path and with the same protections:
 *  - HTTPS only (no http://).
 *  - A maximum waiting time.
 *  - A maximum size: if the server sends more than expected the download is cut instead of
 *    filling the memory.
 * Used by: version lookups (npm, nodejs.org), the official Node.js installer and the
 * Spring Boot project download.
 */

/** Options of a download. */
export interface FetchOptions {
    /** Milliseconds before giving up (15 s by default). */
    timeoutMs?: number;
    /** Maximum accepted bytes (5 MB by default). */
    maxBytes?: number;
    /** Accept header. */
    accept?: string;
}

/**
 * Downloads an HTTPS address and returns the bytes.
 * @param url address (must start with https://)
 * @param opts maximum time, maximum size and content type
 */
export async function fetchBuffer(url: string, opts: FetchOptions = {}): Promise<Buffer> {
    if (!url.startsWith('https://')) {
        throw new Error(`Refusing to download from a non-HTTPS address: ${url}`);
    }
    const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    const response = await fetch(url, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
        headers: opts.accept ? { accept: opts.accept } : undefined,
    });
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
        throw new Error(`${url} is ${declared} bytes, more than the ${maxBytes} allowed`);
    }
    // ! Read in chunks to stop as soon as the limit is exceeded (even if the server does not send the size).
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (!reader) {
        return Buffer.alloc(0);
    }
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        total += value.length;
        if (total > maxBytes) {
            await reader.cancel();
            throw new Error(`${url} sent more than the ${maxBytes} bytes allowed`);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}

/**
 * Downloads JSON.
 * @param url https address
 * @param opts download options
 */
export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<any> {
    return JSON.parse((await fetchBuffer(url, { accept: 'application/json', ...opts })).toString('utf8'));
}

/**
 * Downloads text.
 * @param url https address
 * @param opts download options
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
    return (await fetchBuffer(url, opts)).toString('utf8');
}
