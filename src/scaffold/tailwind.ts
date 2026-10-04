/**
 * scaffold/tailwind.ts
 * ────────────────────
 * Configuración de Tailwind CSS v4 (Vite, Angular y Nuxt) y del "proxy" que hace
 * que las peticiones del frontend a /api lleguen al backend durante el desarrollo.
 */
import * as fs from 'fs';
import * as path from 'path';
import { firstExisting, write } from './files';

const viteConfigs = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];

/**
 * Añade el plugin @tailwindcss/vite a vite.config y cambia la hoja de estilos principal por Tailwind.
 * @param dir carpeta del proyecto
 * @param cssFile hoja de estilos principal (relativa a `dir`)
 */
export function configureViteTailwind(dir: string, cssFile: string): void {
    const config = firstExisting(dir, viteConfigs);
    if (!config) {
        // La plantilla "vanilla" no trae vite.config, así que lo creamos.
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
 * Hace que las peticiones a /api del frontend lleguen al backend durante el desarrollo.
 * Así el frontend puede hacer fetch('/api/todos') sin preocuparse de puertos ni de CORS.
 * @param dir carpeta del frontend
 * @param backendUrl URL del backend (p. ej. http://localhost:3000)
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
        // "$&" en replace() significa "lo que se ha encontrado", así insertamos justo detrás.
        fs.writeFileSync(config, source.replace(/defineConfig\(\{\s*/, `$&${proxy}`));
    }
}

/**
 * Angular usa PostCSS para Tailwind v4.
 * @param dir carpeta del proyecto Angular
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
 * Angular: proxy de /api al backend con proxy.conf.json.
 * @param dir carpeta del proyecto Angular
 * @param backendUrl URL del backend
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
 * Nuxt 4: plugin de Vite + hoja de estilos en app/assets/css/main.css.
 * @param dir carpeta del proyecto Nuxt
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
