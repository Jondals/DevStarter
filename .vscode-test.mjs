import { defineConfig } from '@vscode/test-cli';

// Por defecto los tests corren en la ultima version de VS Code. Con VSCODE_TEST_VERSION=1.90.0 corren
// en la version minima que declara "engines.vscode" (ver "pnpm test:min").
export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: process.env.VSCODE_TEST_VERSION || 'stable',
});
