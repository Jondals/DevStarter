import { defineConfig } from '@vscode/test-cli';

// By default the tests run on the latest VS Code. With VSCODE_TEST_VERSION=1.90.0 they run
// on the minimum version declared in "engines.vscode" (see "pnpm test:min").
export default defineConfig({
	files: 'out/test/**/*.test.js',
	version: process.env.VSCODE_TEST_VERSION || 'stable',
});
