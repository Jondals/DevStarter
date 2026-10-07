// Ejecuta los tests dentro de la version MINIMA de VS Code que declara "engines.vscode".
// Uso: pnpm test:min
// Asi se comprueba de verdad que la extension funciona en los IDEs derivados mas antiguos.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// "^1.90.0" -> "1.90.0"
const minimum = manifest.engines.vscode.replace(/^[^\d]*/, '');
console.log(`Tests en VS Code ${minimum} (la version minima declarada)`);

const result = spawnSync('pnpm', ['test'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VSCODE_TEST_VERSION: minimum },
});
process.exit(result.status ?? 1);
