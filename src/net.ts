/**
 * net.ts
 * ──────
 * Descargas de DevStarter, todas por el mismo camino y con las mismas protecciones:
 *  - Solo HTTPS (nada de http://).
 *  - Tiempo máximo de espera.
 *  - Tamaño máximo: si el servidor envía más de lo esperado se corta la descarga en vez de
 *    llenar la memoria.
 * Lo usan: la consulta de versiones (npm, nodejs.org), el instalador oficial de Node.js y la
 * descarga de proyectos de Spring Boot.
 */

/** Opciones de una descarga. */
export interface FetchOptions {
    /** Milisegundos antes de rendirse (15 s por defecto). */
    timeoutMs?: number;
    /** Bytes máximos que se aceptan (5 MB por defecto). */
    maxBytes?: number;
    /** Cabecera Accept. */
    accept?: string;
}

/**
 * Descarga una dirección HTTPS y devuelve los bytes.
 * @param url dirección (tiene que empezar por https://)
 * @param opts tiempo máximo, tamaño máximo y tipo de contenido
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
    // Se lee por trozos para cortar en cuanto se pasa del límite (aunque el servidor no diga el tamaño).
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
 * Descarga un JSON.
 * @param url dirección https
 * @param opts opciones de la descarga
 */
export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<any> {
    return JSON.parse((await fetchBuffer(url, { accept: 'application/json', ...opts })).toString('utf8'));
}

/**
 * Descarga un texto.
 * @param url dirección https
 * @param opts opciones de la descarga
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
    return (await fetchBuffer(url, opts)).toString('utf8');
}
