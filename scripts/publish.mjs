#!/usr/bin/env node
/**
 * scripts/publish.mjs
 * ───────────────────
 * Publica DevStarter en el Marketplace de Microsoft Y en Open VSX de una sola vez.
 * Open VSX es la tienda que usan Cursor, Windsurf, VSCodium, Trae y otros IDEs.
 *
 *   pnpm publish:check         → ensaya todo SIN publicar (comprobaciones + empaquetado)
 *   pnpm publish:all           → publica en las dos tiendas
 *   pnpm publish:marketplace   → solo Microsoft
 *   pnpm publish:openvsx       → solo Open VSX
 *
 * Opciones:  --dry-run  --only marketplace|openvsx  --skip-tests  --skip-checks  --yes
 *
 * Que hace, en orden:
 *   1. Comprueba que el CHANGELOG tiene la entrada de la version del package.json.
 *   2. Mira en cada tienda si esa version YA esta publicada (no se puede subir dos veces).
 *   3. Pasa las comprobaciones (tipos, lint, formato y tests) salvo --skip-checks / --skip-tests.
 *   4. Empaqueta UNA sola vez el .vsix y sube ese mismo fichero a las dos tiendas.
 *   5. Comprueba en las tiendas que la version nueva aparece y da los enlaces.
 *
 * Los tokens se leen de las variables de entorno VSCE_PAT (Microsoft) y OVSX_PAT (Open VSX), o se
 * piden por teclado sin mostrarse. Nunca se guardan ni se escriben en pantalla. Desde VS Code, las
 * tareas "DevStarter: Publish ..." los piden en un cuadro y los pasan solo a este proceso.
 * Hace falta Node.js 20 o superior.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

/** Tiendas a las que se publica: nombre, variable del token y como comprobar una version. */
const stores = {
    marketplace: {
        label: 'Microsoft Marketplace',
        tokenVariable: 'VSCE_PAT',
        tokenHelp: 'Un token de Azure DevOps con el permiso "Marketplace → Manage" (https://dev.azure.com → User settings → Personal access tokens).',
        link: 'https://marketplace.visualstudio.com/items?itemName=' + manifest.publisher + '.' + manifest.name,
    },
    openvsx: {
        label: 'Open VSX',
        tokenVariable: 'OVSX_PAT',
        tokenHelp: 'Un token de https://open-vsx.org (tu perfil → Access Tokens).',
        link: 'https://open-vsx.org/extension/' + manifest.publisher + '/' + manifest.name,
    },
};

// ── Colores sencillos para la consola ───────────────────────────────

const colors = { green: 32, red: 31, yellow: 33, cyan: 36, gray: 90, bold: 1 };

/**
 * Pinta un texto con un color ANSI.
 * @param {string} name color de la tabla
 * @param {string} text texto
 */
function paint(name, text) {
    return '\x1b[' + colors[name] + 'm' + text + '\x1b[0m';
}

/** Escribe un titulo de seccion. */
function section(text) {
    console.log('\n' + paint('cyan', '◈ ' + text));
}

/** Escribe una linea de exito. */
function ok(text) {
    console.log(paint('green', '  ✔ ') + text);
}

/** Escribe una linea de aviso. */
function warn(text) {
    console.log(paint('yellow', '  ▲ ') + text);
}

/** Escribe una linea de error. */
function fail(text) {
    console.log(paint('red', '  ✗ ') + text);
}

// ── Argumentos ──────────────────────────────────────────────────────

/**
 * Lee los argumentos de la linea de comandos.
 * @param {string[]} argv argumentos sin "node" ni el nombre del script
 */
export function parseArgs(argv) {
    const options = { dryRun: false, only: undefined, skipTests: false, skipChecks: false, yes: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--skip-tests') {
            options.skipTests = true;
        } else if (arg === '--skip-checks') {
            options.skipChecks = true;
        } else if (arg === '--yes' || arg === '-y') {
            options.yes = true;
        } else if (arg === '--only') {
            options.only = argv[++i];
            if (!stores[options.only]) {
                throw new Error('--only admite "marketplace" u "openvsx" (se escribio "' + options.only + '")');
            }
        } else {
            throw new Error('Opcion desconocida: ' + arg);
        }
    }
    return options;
}

// ── Utilidades ──────────────────────────────────────────────────────

/**
 * Ejecuta un comando mostrando su salida y guardandola (para reconocer errores conocidos).
 * Los tokens viajan en variables de entorno, nunca en los argumentos.
 * @param {string} command programa
 * @param {string[]} args argumentos
 * @param {Record<string, string>} extraEnv variables de entorno adicionales
 * @returns {Promise<{ code: number, output: string }>}
 */
function run(command, args, extraEnv = {}) {
    return new Promise(function (resolve) {
        const child = spawn(command, args, { shell: true, env: { ...process.env, ...extraEnv } });
        let output = '';
        function onData(chunk) {
            output += chunk.toString();
            process.stdout.write(chunk);
        }
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('close', function (code) {
            resolve({ code: code ?? 1, output });
        });
    });
}

/**
 * Pregunta algo por teclado.
 * @param {string} question pregunta
 * @param {boolean} secret si es true, lo que se escribe no se muestra (para tokens)
 */
function ask(question, secret = false) {
    return new Promise(function (resolve) {
        process.stdout.write(question);
        const input = process.stdin;
        let text = '';
        input.setRawMode?.(true);
        input.resume();
        input.setEncoding('utf8');
        function onKey(key) {
            for (const ch of key) {
                if (ch === '\r' || ch === '\n') {
                    input.setRawMode?.(false);
                    input.pause();
                    input.removeListener('data', onKey);
                    process.stdout.write('\n');
                    resolve(text);
                    return;
                }
                if (ch === '\x03') {
                    process.stdout.write('\n');
                    process.exit(130);
                }
                if (ch === '\x7f' || ch === '\b') {
                    text = text.slice(0, -1);
                } else {
                    text += ch;
                    if (!secret) {
                        process.stdout.write(ch);
                    }
                }
            }
        }
        input.on('data', onKey);
    });
}

// ── Comprobaciones previas ──────────────────────────────────────────

/**
 * ¿El CHANGELOG tiene una entrada para esta version?
 * @param {string} changelog contenido de CHANGELOG.md
 * @param {string} version version del package.json
 */
export function hasChangelogEntry(changelog, version) {
    return changelog.includes('## [' + version + ']');
}

/**
 * ¿Esta version ya esta publicada en Microsoft?
 * @param {string} version version a buscar
 */
async function publishedInMarketplace(version) {
    const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.1-preview.1' },
        body: JSON.stringify({
            filters: [{ criteria: [{ filterType: 7, value: manifest.publisher + '.' + manifest.name }] }],
            flags: 51,
        }),
        signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    const found = data.results?.[0]?.extensions?.[0];
    if (!found) {
        return { exists: false, versions: [] };
    }
    const versions = found.versions.map(function (v) {
        return v.version;
    });
    return { exists: true, versions, published: versions.includes(version) };
}

/**
 * ¿Esta version ya esta publicada en Open VSX?
 * @param {string} version version a buscar
 */
async function publishedInOpenVsx(version) {
    const base = 'https://open-vsx.org/api/' + manifest.publisher + '/' + manifest.name;
    const response = await fetch(base + '/' + version, { signal: AbortSignal.timeout(20000) });
    if (response.status === 404) {
        return { published: false };
    }
    const data = await response.json();
    return { published: !data.error && data.version === version };
}

/**
 * Mira si la version ya esta publicada en una tienda. Si la consulta falla, no bloquea (devuelve undefined).
 * @param {string} store marketplace u openvsx
 * @param {string} version version
 */
export async function alreadyPublished(store, version) {
    try {
        const state = store === 'marketplace' ? await publishedInMarketplace(version) : await publishedInOpenVsx(version);
        return state.published === true;
    } catch (error) {
        warn('No pude consultar ' + stores[store].label + ' (' + error.message + '). Sigo igualmente.');
        return undefined;
    }
}

/**
 * Pasa las comprobaciones de calidad (tipos, lint, formato y tests).
 * @param {{ skipTests: boolean }} options opciones
 */
async function runChecks(options) {
    const steps = [
        ['Tipos', ['check-types']],
        ['Lint', ['lint']],
        ['Formato', ['format:check']],
    ];
    if (!options.skipTests) {
        steps.push(['Tests', ['test']]);
    }
    for (const [name, args] of steps) {
        console.log(paint('gray', '\n  $ pnpm ' + args.join(' ')));
        const result = await run('pnpm', args);
        if (result.code !== 0) {
            fail(name + ' ha fallado: no se publica nada.');
            return false;
        }
        ok(name);
    }
    return true;
}

// ── Publicacion ─────────────────────────────────────────────────────

/** Consejos para los errores mas habituales de cada tienda. */
const hints = [
    [/Unknown publisher|namespace .* not found|not a valid namespace/i, 'El namespace "' + manifest.publisher + '" no existe en Open VSX. Crealo una vez con: pnpm exec ovsx create-namespace ' + manifest.publisher + ' -p <token>'],
    [/401|403|Access Denied|Unauthorized|invalid.*token|Personal Access Token/i, 'El token no sirve o caduco. Revisa que sea del publicador correcto y que tenga permiso para publicar.'],
    [/already exists|already published|version .* exists/i, 'Esa version ya esta publicada: sube la version en package.json y escribe su entrada en el CHANGELOG.'],
    [/ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i, 'Parece un problema de red. Comprueba tu conexion y repite.'],
];

/**
 * Publica el .vsix en una tienda.
 * @param {string} store marketplace u openvsx
 * @param {string} vsix ruta del paquete
 * @param {string} token token de esa tienda
 */
async function publishTo(store, vsix, token) {
    const info = stores[store];
    const args =
        store === 'marketplace'
            ? ['exec', 'vsce', 'publish', '--packagePath', vsix]
            : ['exec', 'ovsx', 'publish', vsix];
    console.log(paint('gray', '\n  $ pnpm ' + args.join(' ') + '   (token en ' + info.tokenVariable + ', no se muestra)'));
    const result = await run('pnpm', args, { [info.tokenVariable]: token });
    if (result.code === 0) {
        ok('Publicado en ' + info.label);
        return true;
    }
    fail('No se pudo publicar en ' + info.label);
    for (const [pattern, advice] of hints) {
        if (pattern.test(result.output)) {
            console.log(paint('yellow', '    💡 ' + advice));
            break;
        }
    }
    return false;
}

/**
 * Espera a que una tienda muestre la version nueva.
 * @param {string} store marketplace u openvsx
 * @param {string} version version
 * @param {number} seconds segundos maximos de espera
 */
async function waitUntilVisible(store, version, seconds) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
        if ((await alreadyPublished(store, version)) === true) {
            return true;
        }
        await new Promise(function (resolve) {
            setTimeout(resolve, 5000);
        });
    }
    return false;
}

// ── Programa principal ──────────────────────────────────────────────

/** Orquesta todo el proceso. Devuelve el codigo de salida. */
async function main() {
    const options = parseArgs(process.argv.slice(2));
    const version = manifest.version;
    const targets = options.only ? [options.only] : ['marketplace', 'openvsx'];

    console.log(paint('bold', manifest.displayName + ' ' + version) + paint('gray', '  →  ' + manifest.publisher + '.' + manifest.name));
    if (options.dryRun) {
        warn('MODO ENSAYO: se comprueba y se empaqueta, pero no se publica nada.');
    }

    // 1. CHANGELOG
    section('1. CHANGELOG');
    if (!hasChangelogEntry(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version)) {
        fail('CHANGELOG.md no tiene la entrada "## [' + version + ']". Escribela antes de publicar.');
        return 1;
    }
    ok('Hay entrada para la version ' + version);

    // 2. ¿Ya publicada?
    section('2. Estado en las tiendas');
    const pending = [];
    for (const store of targets) {
        const published = await alreadyPublished(store, version);
        if (published) {
            warn(stores[store].label + ': la version ' + version + ' YA esta publicada (se salta).');
        } else {
            ok(stores[store].label + ': la version ' + version + ' esta libre');
            pending.push(store);
        }
    }
    if (!pending.length) {
        fail('No queda nada que publicar. Sube la version en package.json (y el CHANGELOG) para publicar una nueva.');
        return 1;
    }

    // 3. Comprobaciones
    section('3. Comprobaciones de calidad');
    if (options.skipChecks) {
        warn('Saltadas (--skip-checks).');
    } else if (!(await runChecks(options))) {
        return 1;
    }

    // 4. Empaquetado (una sola vez, el mismo fichero para las dos tiendas)
    section('4. Empaquetado');
    const vsix = manifest.name + '-' + version + '.vsix';
    const packaged = await run('pnpm', ['exec', 'vsce', 'package', '--no-dependencies', '-o', vsix]);
    if (packaged.code !== 0 || !existsSync(vsix)) {
        fail('No se pudo crear ' + vsix);
        return 1;
    }
    ok(vsix + ' (' + Math.round(statSync(vsix).size / 1024) + ' KB)');

    if (options.dryRun) {
        section('Ensayo terminado');
        ok('Todo listo para publicar ' + version + ' en: ' + pending.map(function (s) { return stores[s].label; }).join(' y '));
        console.log(paint('gray', '    Para publicar de verdad: pnpm publish:all'));
        return 0;
    }

    // 5. Tokens y confirmacion
    section('5. Tokens');
    const tokens = {};
    for (const store of pending) {
        const info = stores[store];
        let token = (process.env[info.tokenVariable] ?? '').trim();
        if (!token) {
            if (!process.stdin.isTTY) {
                fail('Falta ' + info.tokenVariable + ' para ' + info.label + '. ' + info.tokenHelp);
                return 1;
            }
            console.log(paint('gray', '    ' + info.tokenHelp));
            token = (await ask('    Token de ' + info.label + ' (no se muestra): ', true)).trim();
        }
        if (!token) {
            fail('Sin token no se puede publicar en ' + info.label + '.');
            return 1;
        }
        tokens[store] = token;
        ok(info.label + ': token recibido');
    }
    if (!options.yes) {
        if (!process.stdin.isTTY) {
            fail('Sin terminal interactiva hace falta --yes para confirmar.');
            return 1;
        }
        const answer = await ask('\n  ¿Publicar ' + version + ' en ' + pending.map(function (s) { return stores[s].label; }).join(' y ') + '? Esto no se puede deshacer. (s/N) ');
        if (!/^(s|si|sí|y|yes)$/i.test(answer.trim())) {
            warn('Cancelado. No se ha publicado nada.');
            return 1;
        }
    }

    // 6. Publicar: si una tienda falla, se intenta igualmente la otra
    section('6. Publicando');
    const results = {};
    for (const store of pending) {
        results[store] = await publishTo(store, vsix, tokens[store]);
    }

    // 7. Verificar
    section('7. Verificando en las tiendas');
    for (const store of pending) {
        if (!results[store]) {
            continue;
        }
        // Open VSX publica al instante; Microsoft valida el paquete y puede tardar unos minutos.
        const seconds = store === 'openvsx' ? 60 : 90;
        if (await waitUntilVisible(store, version, seconds)) {
            ok(stores[store].label + ': la version ' + version + ' ya es visible');
        } else {
            warn(stores[store].label + ': subida correcta, pero aun no se ve la version (la tienda sigue validando). Mira en unos minutos.');
        }
        console.log(paint('gray', '    ' + stores[store].link));
    }

    const failed = pending.filter(function (s) {
        return !results[s];
    });
    if (failed.length) {
        console.log('\n' + paint('red', 'Terminado con errores en: ' + failed.map(function (s) { return stores[s].label; }).join(', ')));
        console.log(paint('gray', 'Puedes repetir solo esa tienda: pnpm publish:' + failed[0]));
        return 1;
    }
    console.log('\n' + paint('green', '✨ ' + manifest.displayName + ' ' + version + ' publicado.'));
    return 0;
}

// Solo se ejecuta si se llama directamente (no al importar las funciones desde otro fichero).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .then(function (code) {
            process.exit(code);
        })
        .catch(function (error) {
            fail(error.message);
            process.exit(1);
        });
}
