/**
 * templates/libraries.ts
 * ──────────────────────
 * Catalog of popular libraries that can be added to each stack from the wizard
 * (React Router, Zustand, Pinia, Zod, Helmet, pytest, Django REST Framework…).
 *
 * Each library says which templates it applies to and how it is installed (npm, pip,
 * composer or its own command). Some are also wired into the code (setup).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Logger, Step } from '../terminal';
import { appendLines, patchJson, write } from '../scaffold/files';
import {
    isViteProject,
    writeDemoIndex,
    writeFiberDemo,
    writeGsapDemo,
    writeLeafletDemo,
    writeP5Demo,
    writePhaserDemo,
    writeThreeDemo,
} from '../scaffold/demos';
import { cmd, PartOptions, pipInstall, task, venvPython } from './types';

/** A library that can be added to a project. */
export interface Library {
    id: string;
    label: string;
    /** Short text next to the name. */
    description: string;
    /** Explanation for beginners. */
    detail: string;
    docs: string;
    /** Templates it applies to. */
    templates: string[];
    npm?: string[];
    npmDev?: string[];
    pip?: string[];
    composer?: string[];
    composerDev?: string[];
    /** Custom install command (cargo add, flutter pub add, astro add…). */
    command?: (o: PartOptions) => string;
    /** Extra setup after installing (write files, patch code…). */
    setup?: (o: PartOptions, log: Logger) => void;
    /** Only used as a Spring Initializr dependency (handled by the Spring template). */
    springOnly?: boolean;
    /** Demo page its setup creates in Vite projects (relative to the project). */
    demo?: string;
}

// ─── Setup functions ────────────────────────────────────────────────

/**
 * Vitest: a "test" script and an example test that already passes.
 * @param o project options
 * @param log function to report what is being done
 */
function setupVitest(o: PartOptions, log: Logger): void {
    patchJson(path.join(o.dir, 'package.json'), function (json) {
        json.scripts = { ...json.scripts, test: 'vitest' };
    });
    const file = `src/example.test.${o.typescript ? 'ts' : 'js'}`;
    write(
        path.join(o.dir, file),
        `
import { describe, expect, it } from 'vitest'

// Run the tests with: npm test
describe('example', () => {
  it('adds numbers', () => {
    expect(1 + 2).toBe(3)
  })
})
`,
    );
    log(`${file} and a "test" script`);
}

/**
 * Inserts a line right after the first line that contains `anchor`.
 * @param file file to change
 * @param anchor text that marks where to insert
 * @param line line to insert
 */
function insertAfter(file: string, anchor: string, line: string): void {
    const source = fs.readFileSync(file, 'utf8');
    if (source.includes(line)) {
        return;
    }
    const index = source.indexOf(anchor);
    if (index < 0) {
        throw new Error(`Could not find "${anchor}" in ${path.basename(file)}`);
    }
    const end = source.indexOf('\n', index);
    fs.writeFileSync(file, source.slice(0, end + 1) + line + '\n' + source.slice(end + 1));
}

/** Express: enables Helmet (security headers). */
function setupHelmet(o: PartOptions, log: Logger): void {
    const index = path.join(o.dir, 'src', 'index.js');
    insertAfter(index, "import cors from 'cors'", "import helmet from 'helmet'");
    insertAfter(index, 'app.use(cors())', 'app.use(helmet())');
    log('app.use(helmet()) in src/index.js');
}

/** Express: enables Morgan (one log line per request). */
function setupMorgan(o: PartOptions, log: Logger): void {
    const index = path.join(o.dir, 'src', 'index.js');
    insertAfter(index, "import cors from 'cors'", "import morgan from 'morgan'");
    insertAfter(index, 'app.use(cors())', "app.use(morgan('dev'))");
    log("app.use(morgan('dev')) in src/index.js");
}

/** Flask: enables CORS so a frontend on another port can call the API. */
function setupFlaskCors(o: PartOptions, log: Logger): void {
    const app = path.join(o.dir, 'app.py');
    insertAfter(app, 'from flask import', 'from flask_cors import CORS');
    insertAfter(app, 'app = Flask(__name__)', 'CORS(app)');
    log('CORS(app) in app.py');
}

/**
 * Django: adds an app to INSTALLED_APPS.
 * @param o project options
 * @param app Django app name
 */
function addDjangoApp(o: PartOptions, app: string): void {
    insertAfter(path.join(o.dir, 'config', 'settings.py'), "'django.contrib.staticfiles',", `    '${app}',`);
}

/** Django: registers Django REST Framework. */
function setupDrf(o: PartOptions, log: Logger): void {
    addDjangoApp(o, 'rest_framework');
    log("'rest_framework' added to INSTALLED_APPS");
}

/** Django: registers django-cors-headers and allows the Vite frontend. */
function setupDjangoCors(o: PartOptions, log: Logger): void {
    const settings = path.join(o.dir, 'config', 'settings.py');
    addDjangoApp(o, 'corsheaders');
    insertAfter(settings, 'MIDDLEWARE = [', "    'corsheaders.middleware.CorsMiddleware',");
    appendLines(
        settings,
        '\n# Frontends allowed to call this API during development.\nCORS_ALLOWED_ORIGINS = ["http://localhost:5173"]',
    );
    log('corsheaders configured in config/settings.py');
}

/**
 * pytest: configuration and an example test.
 * @param o project options
 * @param test contents of the test file
 * @param log function to report what is being done
 */
function writePytest(o: PartOptions, test: string, log: Logger): void {
    write(path.join(o.dir, 'pytest.ini'), '[pytest]\npythonpath = .\ntestpaths = tests\n');
    write(path.join(o.dir, 'tests', 'test_app.py'), test);
    log('tests/test_app.py (run them with: python -m pytest)');
}

/** pytest for FastAPI (uses the TestClient). */
function setupPytestFastapi(o: PartOptions, log: Logger): void {
    writePytest(
        o,
        `
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
`,
        log,
    );
}

/** pytest for Flask (uses Flask's test client). */
function setupPytestFlask(o: PartOptions, log: Logger): void {
    writePytest(
        o,
        `
from app import app


def test_health():
    response = app.test_client().get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
`,
        log,
    );
}

/** pytest for a Python script. */
function setupPytestScript(o: PartOptions, log: Logger): void {
    writePytest(
        o,
        `
from main import main


def test_main_says_hello(capsys):
    main()
    assert "Hello" in capsys.readouterr().out
`,
        log,
    );
}

/**
 * Creates a setup function that writes a demo page (Vite projects only)
 * and updates the demo index.
 * @param writeDemo function that writes the demo
 * @param page path of the demo, for the message
 */
function demoSetup(writeDemo: (dir: string) => void, page: string): (o: PartOptions, log: Logger) => void {
    return function (o: PartOptions, log: Logger): void {
        if (!isViteProject(o.dir)) {
            log('Installed (demo pages are only created in Vite projects)');
            return;
        }
        writeDemo(o.dir);
        writeDemoIndex(o.dir);
        log(`Demo: ${page} (open it with the dev server running)`);
    };
}

// ─── Custom install commands ────────────────────────────────────────

/** Returns a function that builds `astro add <integration>`. */
function astroAdd(integration: string): (o: PartOptions) => string {
    return function (o: PartOptions): string {
        return o.pm.bin('astro', ['add', integration, '--yes']);
    };
}

/** Returns a function that builds `flutter pub add <package>`. */
function flutterAdd(pkg: string): () => string {
    return function (): string {
        return `flutter pub add ${pkg}`;
    };
}

/** Returns a function that builds `cargo add <crate>`. */
function cargoAdd(args: string): () => string {
    return function (): string {
        return `cargo add ${args}`;
    };
}

// ─── Catalog ────────────────────────────────────────────────────────

const reactLike = ['react', 'next'];
const jsFrontends = ['react', 'next', 'vue', 'nuxt', 'svelte', 'sveltekit', 'vanilla', 'angular', 'expo'];
/** Web frontends (everything but mobile). */
const webFrontends = ['vanilla', 'react', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'sveltekit', 'astro'];
/** Frontends built with Vite (where the demo pages are created). */
const viteFrontends = ['vanilla', 'react', 'vue', 'svelte'];

export const libraries: Library[] = [
    // * React and Next.js
    {
        id: 'react-router',
        label: 'React Router',
        description: 'pages & navigation',
        detail: 'Several pages in your app, each with its own URL.',
        docs: 'https://reactrouter.com/start/declarative/installation',
        templates: ['react'],
        npm: ['react-router'],
    },
    {
        id: 'zustand',
        label: 'Zustand',
        description: 'global state',
        detail: 'Share data between components without passing props everywhere.',
        docs: 'https://zustand.docs.pmnd.rs',
        templates: [...reactLike, 'expo'],
        npm: ['zustand'],
    },
    {
        id: 'tanstack-query',
        label: 'TanStack Query',
        description: 'data fetching',
        detail: 'Fetch, cache and refresh data from APIs with loading and error states.',
        docs: 'https://tanstack.com/query/latest/docs/framework/react/overview',
        templates: [...reactLike, 'expo'],
        npm: ['@tanstack/react-query'],
    },
    {
        id: 'motion',
        label: 'Motion',
        description: 'animations',
        detail: 'Smooth animations and transitions (formerly Framer Motion).',
        docs: 'https://motion.dev/docs/react',
        templates: reactLike,
        npm: ['motion'],
    },
    {
        id: 'react-hook-form',
        label: 'React Hook Form + Zod',
        description: 'forms & validation',
        detail: 'Forms with validation that are easy to write and fast.',
        docs: 'https://react-hook-form.com/get-started',
        templates: reactLike,
        npm: ['react-hook-form', 'zod', '@hookform/resolvers'],
    },
    {
        id: 'react-icons',
        label: 'React Icons',
        description: 'icons',
        detail: 'Thousands of icons from popular sets as React components.',
        docs: 'https://react-icons.github.io/react-icons/',
        templates: reactLike,
        npm: ['react-icons'],
    },
    // * Vue and Nuxt
    {
        id: 'vue-router',
        label: 'Vue Router',
        description: 'pages & navigation',
        detail: 'Several pages in your app, each with its own URL.',
        docs: 'https://router.vuejs.org/guide/',
        templates: ['vue'],
        npm: ['vue-router'],
    },
    {
        id: 'pinia',
        label: 'Pinia',
        description: 'global state',
        detail: 'The official way to share data between Vue components.',
        docs: 'https://pinia.vuejs.org/getting-started.html',
        templates: ['vue'],
        npm: ['pinia'],
    },
    {
        id: 'vueuse',
        label: 'VueUse',
        description: 'utilities',
        detail: 'Hundreds of ready-made helpers: dark mode, local storage, mouse position…',
        docs: 'https://vueuse.org/guide/',
        templates: ['vue', 'nuxt'],
        npm: ['@vueuse/core'],
    },
    // * Svelte
    {
        id: 'lucide-svelte',
        label: 'Lucide icons',
        description: 'icons',
        detail: 'Clean, consistent icons as Svelte components.',
        docs: 'https://lucide.dev/guide/packages/lucide-svelte',
        templates: ['svelte', 'sveltekit'],
        npm: ['@lucide/svelte'],
    },
    // * Common to frontends
    {
        id: 'axios',
        label: 'Axios',
        description: 'HTTP client',
        detail: 'Call APIs with a friendlier syntax than fetch.',
        docs: 'https://axios-http.com/docs/intro',
        templates: ['react', 'vue', 'svelte', 'vanilla', 'expo'],
        npm: ['axios'],
    },
    {
        id: 'zod',
        label: 'Zod',
        description: 'validation',
        detail: 'Check that data has the shape you expect (forms, API responses…).',
        docs: 'https://zod.dev',
        templates: [...jsFrontends.filter(notReactLike), 'express', 'node-script'],
        npm: ['zod'],
    },
    {
        id: 'dayjs',
        label: 'Day.js',
        description: 'dates',
        detail: 'Format and calculate dates easily ("3 days ago", "Monday 5 May").',
        docs: 'https://day.js.org/docs/en/installation/installation',
        templates: ['vanilla', 'react', 'vue', 'svelte', 'angular'],
        npm: ['dayjs'],
    },
    {
        id: 'chartjs',
        label: 'Chart.js',
        description: 'charts',
        detail: 'Beautiful bar, line and pie charts with a few lines of code.',
        docs: 'https://www.chartjs.org/docs/latest/getting-started/',
        templates: ['vanilla', 'angular', 'vue', 'svelte'],
        npm: ['chart.js'],
    },
    {
        id: 'gsap',
        label: 'GSAP',
        description: 'animations',
        detail: 'Professional-grade animations for any website. Includes a demo page.',
        docs: 'https://gsap.com/docs/v3/',
        templates: webFrontends,
        npm: ['gsap'],
        setup: demoSetup(writeGsapDemo, 'demos/gsap.html'),
        demo: 'demos/gsap.html',
    },
    {
        id: 'vitest',
        label: 'Vitest',
        description: 'testing',
        detail: 'Write automated tests. Includes an example test you can run with "npm test".',
        docs: 'https://vitest.dev/guide/',
        templates: ['react', 'vue', 'svelte', 'vanilla', 'node-script'],
        npmDev: ['vitest'],
        setup: setupVitest,
    },
    // * Creative: 3D, games, art, maps, carousels (with demo pages in Vite projects)
    {
        id: 'three',
        label: 'Three.js',
        description: '3D graphics',
        detail: '3D scenes in the browser: shapes, lights, models and cameras. Includes a demo page.',
        docs: 'https://threejs.org/manual/#en/fundamentals',
        templates: webFrontends,
        npm: ['three'],
        npmDev: ['@types/three'],
        setup: demoSetup(writeThreeDemo, 'demos/three.html'),
        demo: 'demos/three.html',
    },
    {
        id: 'r3f',
        label: 'React Three Fiber',
        description: '3D with React',
        detail: 'Three.js written as React components, plus helpers from drei. Includes a demo page.',
        docs: 'https://r3f.docs.pmnd.rs/getting-started/introduction',
        templates: reactLike,
        npm: ['three', '@react-three/fiber', '@react-three/drei'],
        setup: demoSetup(writeFiberDemo, 'demos/fiber.html'),
        demo: 'demos/fiber.html',
    },
    {
        id: 'p5',
        label: 'p5.js',
        description: 'creative coding',
        detail: 'Draw and animate with code. Perfect to learn programming visually. Includes a demo page.',
        docs: 'https://p5js.org/tutorials/',
        templates: viteFrontends,
        npm: ['p5'],
        setup: demoSetup(writeP5Demo, 'demos/p5.html'),
        demo: 'demos/p5.html',
    },
    {
        id: 'phaser',
        label: 'Phaser',
        description: '2D games',
        detail: 'Make browser games with physics, sprites and sounds. Includes a mini game.',
        docs: 'https://docs.phaser.io/phaser/getting-started/what-is-phaser',
        templates: viteFrontends,
        npm: ['phaser'],
        setup: demoSetup(writePhaserDemo, 'demos/phaser.html'),
        demo: 'demos/phaser.html',
    },
    {
        id: 'leaflet',
        label: 'Leaflet',
        description: 'interactive maps',
        detail: 'Maps with zoom, markers and popups, using free OpenStreetMap data. Includes a demo page.',
        docs: 'https://leafletjs.com/examples/quick-start/',
        templates: webFrontends,
        npm: ['leaflet'],
        npmDev: ['@types/leaflet'],
        setup: demoSetup(writeLeafletDemo, 'demos/leaflet.html'),
        demo: 'demos/leaflet.html',
    },
    {
        id: 'aos',
        label: 'AOS',
        description: 'animate on scroll',
        detail: 'Elements fade and slide in as you scroll. Great for landing pages.',
        docs: 'https://michalsnik.github.io/aos/',
        templates: webFrontends,
        npm: ['aos'],
    },
    {
        id: 'swiper',
        label: 'Swiper',
        description: 'carousels & sliders',
        detail: 'Touch-friendly image carousels and sliders.',
        docs: 'https://swiperjs.com/get-started',
        templates: webFrontends,
        npm: ['swiper'],
    },
    // * Astro
    {
        id: 'astro-mdx',
        label: 'MDX',
        description: 'Markdown + components',
        detail: 'Write pages in Markdown and use components inside them.',
        docs: 'https://docs.astro.build/en/guides/integrations-guide/mdx/',
        templates: ['astro'],
        command: astroAdd('mdx'),
    },
    {
        id: 'astro-react',
        label: 'React components',
        description: 'interactive islands',
        detail: 'Use React components inside your Astro pages.',
        docs: 'https://docs.astro.build/en/guides/integrations-guide/react/',
        templates: ['astro'],
        command: astroAdd('react'),
    },
    // * Express and NestJS
    {
        id: 'helmet',
        label: 'Helmet',
        description: 'security headers',
        detail: 'Adds HTTP headers that protect your API from common attacks. Already wired in.',
        docs: 'https://helmetjs.github.io',
        templates: ['express'],
        npm: ['helmet'],
        setup: setupHelmet,
    },
    {
        id: 'morgan',
        label: 'Morgan',
        description: 'request logs',
        detail: 'Prints a line for every request, so you can see what is happening. Already wired in.',
        docs: 'https://github.com/expressjs/morgan',
        templates: ['express'],
        npm: ['morgan'],
        setup: setupMorgan,
    },
    {
        id: 'jwt',
        label: 'JWT + bcrypt',
        description: 'authentication',
        detail: 'The building blocks for login: secure password hashing and tokens.',
        docs: 'https://github.com/auth0/node-jsonwebtoken',
        templates: ['express'],
        npm: ['jsonwebtoken', 'bcryptjs'],
    },
    {
        id: 'nest-config',
        label: '@nestjs/config',
        description: 'settings',
        detail: 'Read settings and secrets from .env the NestJS way.',
        docs: 'https://docs.nestjs.com/techniques/configuration',
        templates: ['nest'],
        npm: ['@nestjs/config'],
    },
    {
        id: 'nest-validation',
        label: 'class-validator',
        description: 'validation',
        detail: 'Validate request bodies with decorators like @IsEmail().',
        docs: 'https://docs.nestjs.com/techniques/validation',
        templates: ['nest'],
        npm: ['class-validator', 'class-transformer'],
    },
    {
        id: 'nest-swagger',
        label: 'Swagger',
        description: 'API docs',
        detail: 'Interactive documentation for your API.',
        docs: 'https://docs.nestjs.com/openapi/introduction',
        templates: ['nest'],
        npm: ['@nestjs/swagger'],
    },
    // * Node.js script
    {
        id: 'chalk',
        label: 'Chalk',
        description: 'colored output',
        detail: 'Print colored text in the terminal.',
        docs: 'https://github.com/chalk/chalk',
        templates: ['node-script'],
        npm: ['chalk'],
    },
    {
        id: 'commander',
        label: 'Commander',
        description: 'CLI arguments',
        detail: 'Turn your script into a real command line tool with options and --help.',
        docs: 'https://github.com/tj/commander.js',
        templates: ['node-script'],
        npm: ['commander'],
    },
    // * Python
    {
        id: 'pytest-fastapi',
        label: 'pytest',
        description: 'testing',
        detail: 'Automated tests. Includes a test for /api/health.',
        docs: 'https://docs.pytest.org',
        templates: ['fastapi'],
        pip: ['pytest', 'httpx'],
        setup: setupPytestFastapi,
    },
    {
        id: 'pydantic-settings',
        label: 'pydantic-settings',
        description: 'settings',
        detail: 'Load settings from .env into a typed Python object.',
        docs: 'https://docs.pydantic.dev/latest/concepts/pydantic_settings/',
        templates: ['fastapi'],
        pip: ['pydantic-settings'],
    },
    {
        id: 'flask-cors',
        label: 'Flask-CORS',
        description: 'allow frontends',
        detail: 'Lets a frontend on another port call your API. Already wired in.',
        docs: 'https://flask-cors.readthedocs.io',
        templates: ['flask'],
        pip: ['flask-cors'],
        setup: setupFlaskCors,
    },
    {
        id: 'pytest-flask',
        label: 'pytest',
        description: 'testing',
        detail: 'Automated tests. Includes a test for /api/health.',
        docs: 'https://docs.pytest.org',
        templates: ['flask'],
        pip: ['pytest'],
        setup: setupPytestFlask,
    },
    {
        id: 'drf',
        label: 'Django REST Framework',
        description: 'APIs',
        detail: 'The standard toolkit to build APIs with Django. Already registered.',
        docs: 'https://www.django-rest-framework.org/tutorial/quickstart/',
        templates: ['django'],
        pip: ['djangorestframework'],
        setup: setupDrf,
    },
    {
        id: 'django-cors',
        label: 'django-cors-headers',
        description: 'allow frontends',
        detail: 'Lets a frontend on another port call your API. Already configured.',
        docs: 'https://github.com/adamchainz/django-cors-headers',
        templates: ['django'],
        pip: ['django-cors-headers'],
        setup: setupDjangoCors,
    },
    {
        id: 'loguru',
        label: 'Loguru',
        description: 'logging',
        detail: 'Pretty, simple logging for Python.',
        docs: 'https://loguru.readthedocs.io',
        templates: ['fastapi', 'flask', 'python-script'],
        pip: ['loguru'],
    },
    {
        id: 'requests',
        label: 'Requests',
        description: 'HTTP client',
        detail: 'Download web pages and call APIs from Python.',
        docs: 'https://requests.readthedocs.io',
        templates: ['python-script'],
        pip: ['requests'],
    },
    {
        id: 'rich',
        label: 'Rich',
        description: 'beautiful output',
        detail: 'Colors, tables and progress bars in the terminal.',
        docs: 'https://rich.readthedocs.io',
        templates: ['python-script'],
        pip: ['rich'],
    },
    {
        id: 'pandas',
        label: 'pandas',
        description: 'data analysis',
        detail: 'Work with spreadsheets and data tables (CSV, Excel…).',
        docs: 'https://pandas.pydata.org/docs/getting_started/',
        templates: ['python-script'],
        pip: ['pandas'],
    },
    {
        id: 'pytest-script',
        label: 'pytest',
        description: 'testing',
        detail: 'Automated tests. Includes an example test.',
        docs: 'https://docs.pytest.org',
        templates: ['python-script'],
        pip: ['pytest'],
        setup: setupPytestScript,
    },
    // * Laravel
    {
        id: 'debugbar',
        label: 'Laravel Debugbar',
        description: 'debugging',
        detail: 'A toolbar that shows queries, timing and more while you develop.',
        docs: 'https://github.com/barryvdh/laravel-debugbar',
        templates: ['laravel'],
        composerDev: ['barryvdh/laravel-debugbar'],
    },
    {
        id: 'permission',
        label: 'Spatie Permission',
        description: 'roles',
        detail: 'Roles and permissions for your users.',
        docs: 'https://spatie.be/docs/laravel-permission',
        templates: ['laravel'],
        composer: ['spatie/laravel-permission'],
    },
    // * Rust
    {
        id: 'serde',
        label: 'Serde',
        description: 'JSON (de)serialization',
        detail: 'Turn Rust structs into JSON and back.',
        docs: 'https://serde.rs',
        templates: ['rust'],
        command: cargoAdd('serde --features derive'),
    },
    {
        id: 'tower-http',
        label: 'tower-http CORS',
        description: 'allow frontends',
        detail: 'Middleware such as CORS for Axum.',
        docs: 'https://docs.rs/tower-http',
        templates: ['rust'],
        command: cargoAdd('tower-http --features cors'),
    },
    // * Spring Boot (Spring Initializr dependencies: the id after "spring-")
    {
        id: 'spring-actuator',
        label: 'Actuator',
        description: 'health & metrics',
        detail: 'Ready-made endpoints to monitor your app (/actuator/health).',
        docs: 'https://docs.spring.io/spring-boot/reference/actuator/',
        templates: ['spring'],
        springOnly: true,
    },
    {
        id: 'spring-validation',
        label: 'Validation',
        description: 'validation',
        detail: 'Validate request data with annotations like @NotBlank.',
        docs: 'https://spring.io/guides/gs/validating-form-input',
        templates: ['spring'],
        springOnly: true,
    },
    {
        id: 'spring-lombok',
        label: 'Lombok',
        description: 'less boilerplate',
        detail: 'Generates getters, setters and constructors for you.',
        docs: 'https://projectlombok.org',
        templates: ['spring'],
        springOnly: true,
    },
    // * Flutter
    {
        id: 'flutter-http',
        label: 'http',
        description: 'HTTP client',
        detail: 'Call APIs from your Flutter app.',
        docs: 'https://pub.dev/packages/http',
        templates: ['flutter'],
        command: flutterAdd('http'),
    },
    {
        id: 'flutter-provider',
        label: 'Provider',
        description: 'state management',
        detail: 'Share data across widgets.',
        docs: 'https://pub.dev/packages/provider',
        templates: ['flutter'],
        command: flutterAdd('provider'),
    },
    {
        id: 'flutter-go-router',
        label: 'go_router',
        description: 'navigation',
        detail: 'Screens with URLs and easy navigation.',
        docs: 'https://pub.dev/packages/go_router',
        templates: ['flutter'],
        command: flutterAdd('go_router'),
    },
];

/** Excludes React and Next (they already get Zod with React Hook Form). */
function notReactLike(id: string): boolean {
    return !reactLike.includes(id);
}

/**
 * Libraries available for a template.
 * @param templateId template id
 */
export function librariesFor(templateId: string): Library[] {
    const result: Library[] = [];
    for (const lib of libraries) {
        if (lib.templates.includes(templateId)) {
            result.push(lib);
        }
    }
    return result;
}

/**
 * Looks up libraries by id.
 * @param ids identifiers
 */
export function findLibraries(ids: string[]): Library[] {
    const result: Library[] = [];
    for (const lib of libraries) {
        if (ids.includes(lib.id)) {
            result.push(lib);
        }
    }
    return result;
}

/**
 * Library names separated by commas (for the step titles).
 * @param libs libraries
 */
function labels(libs: Library[]): string {
    const names: string[] = [];
    for (const lib of libs) {
        names.push(lib.label);
    }
    return names.join(', ');
}

/**
 * Steps to install and configure the chosen libraries in one part of the project.
 * Packages are grouped so there is a single install per package manager.
 * @param libs libraries chosen for this part
 * @param o options of the part
 */
export function librarySteps(libs: Library[], o: PartOptions): Step[] {
    const steps: Step[] = [];
    const npm: string[] = [];
    const npmDev: string[] = [];
    const pip: string[] = [];
    const composer: string[] = [];
    const composerDev: string[] = [];
    for (const lib of libs) {
        npm.push(...(lib.npm ?? []));
        npmDev.push(...(lib.npmDev ?? []));
        pip.push(...(lib.pip ?? []));
        composer.push(...(lib.composer ?? []));
        composerDev.push(...(lib.composerDev ?? []));
    }
    // * No duplicates (e.g. Three.js and React Three Fiber both install "three").
    dedupe(npm);
    dedupe(npmDev);
    dedupe(pip);
    const installable = libs.filter(isNotSpringOnly);
    if (!installable.length) {
        return steps;
    }
    const title = `Adding ${labels(installable)}`;
    if (npm.length) {
        steps.push(cmd(title, o.pm.add(npm), o.dir));
    }
    if (npmDev.length) {
        steps.push(cmd(npm.length ? 'Adding development tools' : title, o.pm.add(npmDev, true), o.dir));
    }
    if (pip.length) {
        steps.push(cmd(title, pipInstall(pip), o.dir));
        steps.push(cmd('Updating requirements.txt', `${venvPython()} -m pip freeze > requirements.txt`, o.dir, true));
    }
    if (composer.length) {
        steps.push(cmd(title, `composer require ${composer.join(' ')}`, o.dir));
    }
    if (composerDev.length) {
        steps.push(
            cmd(
                composer.length ? 'Adding development tools' : title,
                `composer require --dev ${composerDev.join(' ')}`,
                o.dir,
            ),
        );
    }
    for (const lib of libs) {
        if (lib.command) {
            steps.push(cmd(`Adding ${lib.label}`, lib.command(o), o.dir));
        }
    }
    for (const lib of libs) {
        const setup = lib.setup;
        if (setup) {
            steps.push(
                task(`Setting up ${lib.label}`, function (log) {
                    setup(o, log);
                }),
            );
        }
    }
    return steps;
}

/** Spring-only libraries are handled by the Spring Boot template itself. */
function isNotSpringOnly(lib: Library): boolean {
    return !lib.springOnly;
}

/**
 * Removes duplicate items from a list (changes the list in place).
 * @param list list to clean
 */
function dedupe(list: string[]): void {
    const unique = [...new Set(list)];
    list.length = 0;
    list.push(...unique);
}
