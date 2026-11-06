/**
 * esbuild.js
 * ──────────
 * Build script: bundles src/extension.ts (and everything it imports) into dist/extension.js,
 * and copies the codicon font used by the visual wizard into dist/codicons.
 *
 *   node esbuild.js               · development build (with source maps)
 *   node esbuild.js --production  · minified build for publishing
 *   node esbuild.js --watch       · rebuild on every change
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
    name: 'esbuild-problem-matcher',

    setup(build) {
        build.onStart(() => {
            console.log('[watch] build started');
        });
        build.onEnd(result => {
            result.errors.forEach(({ text, location }) => {
                console.error(`✘ [ERROR] ${text}`);
                console.error(`    ${location.file}:${location.line}:${location.column}:`);
            });
            console.log('[watch] build finished');
        });
    },
};

/**
 * Copies the codicon font and stylesheet next to the bundle, for the visual wizard (webview).
 * ! node_modules is not shipped in the .vsix, so the files must live in dist/.
 */
function copyCodicons() {
    const from = path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist');
    const to = path.join(__dirname, 'dist', 'codicons');
    fs.mkdirSync(to, { recursive: true });
    for (const file of ['codicon.css', 'codicon.ttf']) {
        fs.copyFileSync(path.join(from, file), path.join(to, file));
    }
}

/** Builds (or watches) the extension bundle. */
async function main() {
    copyCodicons();
    const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        bundle: true,
        format: 'cjs',
        minify: production,
        sourcemap: !production,
        sourcesContent: false,
        platform: 'node',
        outfile: 'dist/extension.js',
        external: ['vscode'],
        logLevel: 'silent',
        plugins: [
            /* add to the end of plugins array */
            esbuildProblemMatcherPlugin,
        ],
    });
    if (watch) {
        await ctx.watch();
    } else {
        await ctx.rebuild();
        await ctx.dispose();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
