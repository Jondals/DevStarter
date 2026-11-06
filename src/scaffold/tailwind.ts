/**
 * scaffold/tailwind.ts
 * ────────────────────
 * Setup of Tailwind CSS v4 (Vite, Angular and Nuxt) and of the "proxy" that sends
 * the frontend's requests to /api to the backend during development.
 */
import * as fs from 'fs';
import * as path from 'path';
import { firstExisting, write } from './files';

const viteConfigs = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];

/**
 * Adds the @tailwindcss/vite plugin to vite.config and replaces the main stylesheet with Tailwind.
 * @param dir project folder
 * @param cssFile main stylesheet (relative to `dir`)
 */
export function configureViteTailwind(dir: string, cssFile: string): void {
    const config = firstExisting(dir, viteConfigs);
    if (!config) {
        // ? The "vanilla" template has no vite.config, so we create it.
        write(
            path.join(dir, 'vite.config.js'),
            `
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
})
`,
        );
    } else {
        let source = fs.readFileSync(config, 'utf8');
        if (!source.includes('@tailwindcss/vite')) {
            if (!/plugins:\s*\[/.test(source)) {
                throw new Error(`Could not find "plugins: [" in ${path.basename(config)}`);
            }
            source = `import tailwindcss from '@tailwindcss/vite'\n` + source;
            source = source.replace(/plugins:\s*\[/, 'plugins: [tailwindcss(), ');
            fs.writeFileSync(config, source);
        }
    }
    write(path.join(dir, cssFile), '@import "tailwindcss";\n');
}

/**
 * Sends the frontend's requests to /api to the backend during development.
 * That way the frontend can call fetch('/api/todos') without worrying about ports or CORS.
 * @param dir frontend folder
 * @param backendUrl backend URL (e.g. http://localhost:3000)
 */
export function configureViteProxy(dir: string, backendUrl: string): void {
    const proxy = `server: {\n    proxy: {\n      '/api': '${backendUrl}',\n    },\n  },\n  `;
    const config = firstExisting(dir, viteConfigs);
    if (!config) {
        write(
            path.join(dir, 'vite.config.js'),
            `
import { defineConfig } from 'vite'

export default defineConfig({
  ${proxy.trimEnd()}
})
`,
        );
        return;
    }
    const source = fs.readFileSync(config, 'utf8');
    if (!source.includes('proxy')) {
        // ? "$&" in replace() means "the matched text", so we insert right after it.
        fs.writeFileSync(config, source.replace(/defineConfig\(\{\s*/, `$&${proxy}`));
    }
}

/**
 * Angular uses PostCSS for Tailwind v4.
 * @param dir Angular project folder
 */
export function configureAngularTailwind(dir: string): void {
    write(
        path.join(dir, '.postcssrc.json'),
        JSON.stringify({ plugins: { '@tailwindcss/postcss': {} } }, null, 2) + '\n',
    );
    const styles = path.join(dir, 'src', 'styles.css');
    const current = fs.existsSync(styles) ? fs.readFileSync(styles, 'utf8') : '';
    if (!current.includes('tailwindcss')) {
        write(styles, `@import "tailwindcss";\n${current}`);
    }
}

/**
 * Angular: proxy /api to the backend with proxy.conf.json.
 * @param dir Angular project folder
 * @param backendUrl backend URL
 */
export function configureAngularProxy(dir: string, backendUrl: string): void {
    write(
        path.join(dir, 'proxy.conf.json'),
        JSON.stringify({ '/api': { target: backendUrl, secure: false } }, null, 2) + '\n',
    );
    const angularJson = path.join(dir, 'angular.json');
    if (!fs.existsSync(angularJson)) {
        return;
    }
    const json = JSON.parse(fs.readFileSync(angularJson, 'utf8'));
    for (const name of Object.keys(json.projects ?? {})) {
        const serve = json.projects[name]?.architect?.serve;
        if (serve) {
            serve.options = { ...serve.options, proxyConfig: 'proxy.conf.json' };
        }
    }
    fs.writeFileSync(angularJson, JSON.stringify(json, null, 2) + '\n');
}

/**
 * Nuxt 4: Vite plugin + stylesheet in app/assets/css/main.css.
 * @param dir Nuxt project folder
 */
export function configureNuxtTailwind(dir: string): void {
    const config = path.join(dir, 'nuxt.config.ts');
    let source = fs.readFileSync(config, 'utf8');
    if (!source.includes('@tailwindcss/vite')) {
        const extra = `css: ['~/assets/css/main.css'],\n  vite: {\n    plugins: [tailwindcss()],\n  },\n  `;
        source =
            `import tailwindcss from '@tailwindcss/vite'\n\n` + source.replace(/defineNuxtConfig\(\{\s*/, `$&${extra}`);
        fs.writeFileSync(config, source);
    }
    write(path.join(dir, 'app', 'assets', 'css', 'main.css'), '@import "tailwindcss";\n');
}
