// Compila scripts/smoke/run.ts (con la API de VS Code imitada) y lo ejecuta.
// Uso: node scripts/smoke/build.mjs [casos...]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, '..', '..', 'out-smoke', 'run.js');

await build({
    entryPoints: [path.join(here, 'run.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    alias: { vscode: path.join(here, 'vscode-mock.js') },
    logLevel: 'warning',
});

const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
