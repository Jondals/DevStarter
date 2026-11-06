/**
 * scaffold/welcome.ts
 * ───────────────────
 * Welcome pages built with Tailwind, so beginners can see that everything works.
 * If the project has a backend, the page also calls /api/health and shows the
 * answer, proving that frontend and backend are connected.
 *
 * ? Note: the code inside the templates (`...`) is what gets written into the user's
 * project, and follows the usual style of each framework.
 */
import * as path from 'path';
import { write } from './files';

/** Frameworks that have a welcome page. */
export type WelcomeFramework = 'react' | 'vue' | 'svelte' | 'vanilla';

// * Tailwind classes shared by every variant (DevStarter colors: teal, indigo, fuchsia).
const heading =
    'text-5xl font-extrabold bg-linear-to-r from-teal-300 via-indigo-400 to-fuchsia-400 bg-clip-text text-transparent';
const button =
    'rounded-xl bg-indigo-500 px-6 py-3 font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-400 active:scale-95';
const page = 'min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6';
const apiBox = 'rounded-lg border border-slate-800 bg-slate-900 p-3 text-left font-mono text-sm text-teal-300';

/**
 * Replaces the main component with a Tailwind welcome page.
 * @param dir frontend folder
 * @param framework project framework
 * @param name project name (shown as the title)
 * @param typescript the project uses TypeScript
 * @param withApi there is a backend: the page calls it
 */
export function writeWelcomePage(
    dir: string,
    framework: WelcomeFramework,
    name: string,
    typescript: boolean,
    withApi: boolean,
) {
    const ext = typescript ? 'ts' : 'js';
    switch (framework) {
        case 'react': {
            const file = `src/App.${typescript ? 'tsx' : 'jsx'}`;
            write(
                path.join(dir, file),
                `
import { useEffect, useState } from 'react'

function App() {
  const [count, setCount] = useState(0)
${
    withApi
        ? `  const [api, setApi] = useState('Connecting to the backend…')

  // Calls the backend through the dev server proxy (see vite.config).
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setApi(JSON.stringify(data)))
      .catch(() => setApi('Backend not running. Start it with the dev command.'))
  }, [])
`
        : `
  useEffect(() => {
    document.title = '${name}'
  }, [])
`
}
  return (
    <main className="${page}">
      <div className="max-w-xl space-y-6 text-center">
        <p className="text-sm uppercase tracking-widest text-teal-300">Created with DevStarter</p>
        <h1 className="${heading}">${name}</h1>
        <p className="text-slate-400">
          Edit <code className="text-fuchsia-300">${file}</code> and save. The page updates instantly.
        </p>
        <button className="${button}" onClick={() => setCount((c) => c + 1)}>
          Clicked {count} {count === 1 ? 'time' : 'times'}
        </button>
${withApi ? `        <pre className="${apiBox}">{api}</pre>\n` : ''}      </div>
    </main>
  )
}

export default App
`,
            );
            break;
        }
        case 'vue':
            write(
                path.join(dir, 'src/App.vue'),
                `
<script setup${typescript ? ' lang="ts"' : ''}>
import { ${withApi ? 'onMounted, ' : ''}ref } from 'vue'

const count = ref(0)
${
    withApi
        ? `const api = ref('Connecting to the backend…')

// Calls the backend through the dev server proxy (see vite.config).
onMounted(async () => {
  try {
    api.value = JSON.stringify(await (await fetch('/api/health')).json())
  } catch {
    api.value = 'Backend not running. Start it with the dev command.'
  }
})
`
        : ''
}</script>

<template>
  <main class="${page}">
    <div class="max-w-xl space-y-6 text-center">
      <p class="text-sm uppercase tracking-widest text-teal-300">Created with DevStarter</p>
      <h1 class="${heading}">${name}</h1>
      <p class="text-slate-400">
        Edit <code class="text-fuchsia-300">src/App.vue</code> and save. The page updates instantly.
      </p>
      <button class="${button}" @click="count++">
        Clicked {{ count }} {{ count === 1 ? 'time' : 'times' }}
      </button>
${withApi ? `      <pre class="${apiBox}">{{ api }}</pre>\n` : ''}    </div>
  </main>
</template>
`,
            );
            break;
        case 'svelte':
            write(
                path.join(dir, 'src/App.svelte'),
                `
<script${typescript ? ' lang="ts"' : ''}>
  let count = $state(0)
${
    withApi
        ? `  let api = $state('Connecting to the backend…')

  // Calls the backend through the dev server proxy (see vite.config).
  $effect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => (api = JSON.stringify(data)))
      .catch(() => (api = 'Backend not running. Start it with the dev command.'))
  })
`
        : ''
}</script>

<main class="${page}">
  <div class="max-w-xl space-y-6 text-center">
    <p class="text-sm uppercase tracking-widest text-teal-300">Created with DevStarter</p>
    <h1 class="${heading}">${name}</h1>
    <p class="text-slate-400">
      Edit <code class="text-fuchsia-300">src/App.svelte</code> and save. The page updates instantly.
    </p>
    <button class="${button}" onclick={() => count++}>
      Clicked {count} {count === 1 ? 'time' : 'times'}
    </button>
${withApi ? `    <pre class="${apiBox}">{api}</pre>\n` : ''}  </div>
</main>
`,
            );
            break;
        case 'vanilla': {
            /** JS/TS code to select an HTML element (typed in TypeScript). */
            function el(sel: string, type: string): string {
                return typescript ? `document.querySelector<${type}>('${sel}')!` : `document.querySelector('${sel}')`;
            }
            write(
                path.join(dir, `src/main.${ext}`),
                `
import './style.css'

const app = ${el('#app', 'HTMLDivElement')}

app.innerHTML = \`
  <main class="${page}">
    <div class="max-w-xl space-y-6 text-center">
      <p class="text-sm uppercase tracking-widest text-teal-300">Created with DevStarter</p>
      <h1 class="${heading}">${name}</h1>
      <p class="text-slate-400">
        Edit <code class="text-fuchsia-300">src/main.${ext}</code> and save. The page updates instantly.
      </p>
      <button id="counter" class="${button}">Clicked 0 times</button>
${withApi ? `      <pre id="api" class="${apiBox}">Connecting to the backend…</pre>\n` : ''}    </div>
  </main>
\`

let count = 0
const button = ${el('#counter', 'HTMLButtonElement')}
button.addEventListener('click', () => {
  count++
  button.textContent = \`Clicked \${count} \${count === 1 ? 'time' : 'times'}\`
})
${
    withApi
        ? `
// Calls the backend through the dev server proxy (see vite.config).
const api = ${el('#api', 'HTMLPreElement')}
fetch('/api/health')
  .then((res) => res.json())
  .then((data) => (api.textContent = JSON.stringify(data)))
  .catch(() => (api.textContent = 'Backend not running. Start it with the dev command.'))
`
        : ''
}`,
            );
            break;
        }
    }
}
