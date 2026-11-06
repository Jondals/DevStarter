/**
 * templates/backend.ts
 * ────────────────────
 * Backend templates: Express, NestJS, FastAPI, Flask, Django, Laravel, Go,
 * .NET, Rust (Axum) and Spring Boot.
 *
 * They all expose GET /api/health so a frontend can check that the backend
 * responds, and the ones that support a database also add GET /api/db.
 * ? The code inside the text templates (`...`) is what gets written into the user's
 * project, in the usual style of each language.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Step } from '../terminal';
import {
    allDatabases,
    configureDjangoDatabase,
    configureLaravelDatabase,
    databaseUrl,
    djangoPackages,
    nodeEnvLine,
    nodeModule,
    nodePackages,
    pythonModule,
    pythonPackages,
} from '../scaffold/database';
import { goDockerfile, nodeDockerfile, pythonDockerfile, rustDockerfile, writeDockerfile } from '../scaffold/docker';
import { allowPnpmBuild, appendLines, write } from '../scaffold/files';
import { fetchBuffer } from '../net';
import { nodeDatabaseSteps } from './fullstack';
import { cmd, isWindows, makeDir, PartOptions, pipInstall, Plan, scaffold, task, Template, venvPython } from './types';

const nodeGitignore = 'node_modules/\ndist/\n.env\n*.log\n.DS_Store\n';
const pythonGitignore = '.venv/\n__pycache__/\n*.pyc\n.env\ndb.sqlite3\ndata.db\n.DS_Store\n';
const pythonExt = ['ms-python.python'];

/**
 * Shared note: where the database connection lives and how to test it.
 * @param o project options
 */
function databaseNote(o: PartOptions): string[] {
    return o.database ? [`Your ${o.database} connection is in \`.env\`. Test it at \`/api/db\`.`] : [];
}

/**
 * Step that writes the Dockerfile, only if it was requested.
 * @param o project options
 * @param content contents of the Dockerfile
 */
function dockerStep(o: PartOptions, content: string): Step[] {
    if (!o.dockerfile) {
        return [];
    }
    return [
        task('Writing Dockerfile', function () {
            writeDockerfile(o.dir, content);
        }),
    ];
}

// ─── Express ────────────────────────────────────────────────────────

/**
 * Writes the Express API files: package.json, .env, src/index.js and src/db.js.
 * @param o project options
 */
function writeExpressProject(o: PartOptions): void {
    const db = o.database;
    const pkg = {
        name: o.packageName,
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
            // ? --watch restarts the server on save; --env-file loads the variables from .env.
            dev: 'node --watch --env-file=.env src/index.js',
            start: 'node --env-file=.env src/index.js',
        },
    };
    write(path.join(o.dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    if (db === 'SQLite' && o.pm.id === 'pnpm') {
        allowPnpmBuild(o.dir, 'better-sqlite3');
    }
    const env = `PORT=3000\n${db ? nodeEnvLine(db, o.name) + '\n' : ''}`;
    write(path.join(o.dir, '.env'), env);
    write(path.join(o.dir, '.env.example'), env);
    write(path.join(o.dir, '.gitignore'), nodeGitignore + (db === 'SQLite' ? '*.db\n' : ''));
    if (db) {
        write(path.join(o.dir, 'src', 'db.js'), nodeModule(db, { ts: false }));
    }
    write(
        path.join(o.dir, 'src', 'index.js'),
        `
import express from 'express'
import cors from 'cors'
${db ? "import { checkDatabase } from './db.js'\n" : ''}
const app = express()
const PORT = process.env.PORT ?? 3000

// Any website may call this API: fine while you develop, but before deploying
// restrict it, e.g. cors({ origin: 'https://your-site.com' }).
app.use(cors())
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'Hello from ${o.name}!' })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})
${
    db
        ? `
// Visit http://localhost:3000/api/db to test the database connection (configure it in .env)
app.get('/api/db', async (req, res) => {
  try {
    res.json({ ok: true, result: await checkDatabase() })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})
`
        : ''
}
// A tiny in-memory "todos" resource to play with.
const todos = []

app.get('/api/todos', (req, res) => {
  res.json(todos)
})

app.post('/api/todos', (req, res) => {
  const { title } = req.body ?? {}
  if (!title) {
    return res.status(400).json({ error: 'title is required' })
  }
  const todo = { id: todos.length + 1, title, done: false }
  todos.push(todo)
  res.status(201).json(todo)
})

app.listen(PORT, () => {
  console.log(\`Server running at http://localhost:\${PORT}\`)
})
`,
    );
}

/** Express steps. */
function expressPlan(o: PartOptions): Plan {
    const deps = ['express', 'cors', ...(o.database ? nodePackages(o.database, false).deps : [])];
    return {
        steps: [
            task('Writing API files', function (log) {
                writeExpressProject(o);
                log(`src/index.js, .env${o.database ? ', src/db.js' : ''}`);
            }),
            cmd('Installing Express', o.pm.add(deps), o.dir),
            ...dockerStep(o, nodeDockerfile({ start: 'node src/index.js' })),
        ],
        server: { command: o.pm.run('dev'), url: 'http://localhost:3000' },
        mainFiles: ['src/index.js'],
        notes: [
            'The server restarts automatically when you save (thanks to `node --watch`).',
            'Try the endpoints: `/`, `/api/health` and `/api/todos`.',
            'Secrets and settings go in `.env` (never commit it; `.env.example` is the shareable copy).',
            ...databaseNote(o),
        ],
    };
}

// ─── NestJS ─────────────────────────────────────────────────────────

/**
 * Adds an /api controller (health and, with a database, db) and registers it in AppModule.
 * @param o project options
 */
function writeNestApiController(o: PartOptions): void {
    const modulePath = path.join(o.dir, 'src', 'app.module.ts');
    let module = fs.readFileSync(modulePath, 'utf8');
    // ! Newer Nest versions use ESM and import with a ".js" extension.
    const suffix = module.includes("app.controller.js'") ? '.js' : '';
    const db = o.database;
    if (db) {
        write(
            path.join(o.dir, 'src', 'db.ts'),
            nodeModule(db, {
                ts: true,
                // ? Nest does not read .env by itself; Node can load it with loadEnvFile().
                header: 'try {\n  process.loadEnvFile()\n} catch {\n  // No .env file: use the real environment variables.\n}\n',
            }),
        );
    }
    write(
        path.join(o.dir, 'src', 'api.controller.ts'),
        `
import { Controller, Get } from '@nestjs/common';
${db ? `import { checkDatabase } from './db${suffix}';\n` : ''}
@Controller('api')
export class ApiController {
  @Get('health')
  health() {
    return { status: 'ok', uptime: process.uptime() };
  }
${
    db
        ? `
  @Get('db')
  async db() {
    return { ok: true, result: await checkDatabase() };
  }
`
        : ''
}}
`,
    );
    if (!module.includes('ApiController')) {
        // * Insert the import after the last import and add the controller to the list.
        module = module.replace(
            /(import [^\n]+\n)(?![\s\S]*import )/,
            `$1import { ApiController } from './api.controller${suffix}';\n`,
        );
        module = module.replace(/controllers:\s*\[/, 'controllers: [ApiController, ');
        fs.writeFileSync(modulePath, module);
    }
}

/** NestJS steps. */
function nestPlan(o: PartOptions): Plan {
    // ! The Nest CLI does not support bun as a package manager; in that case it installs with npm.
    const nestPm = o.pm.id === 'bun' ? 'npm' : o.pm.id;
    return {
        steps: [
            scaffold(
                o,
                'Creating NestJS project and installing dependencies',
                '@nestjs/cli',
                ['new', o.folder, '--package-manager', nestPm, '--skip-git', '--strict'],
                o.parentDir,
            ),
            task('Adding /api routes', function (log) {
                writeNestApiController(o);
                log('src/api.controller.ts');
            }),
            ...nodeDatabaseSteps(o, {}, true),
            ...dockerStep(o, nodeDockerfile({ build: true, start: 'node dist/main' })),
        ],
        server: { command: o.pm.run('start:dev'), url: 'http://localhost:3000' },
        mainFiles: ['src/api.controller.ts', 'src/app.controller.ts'],
        notes: [
            `Generate pieces with the Nest CLI, e.g. \`${o.pm.bin('nest', ['generate', 'resource', 'todos'])}\`.`,
            ...databaseNote(o),
        ],
    };
}

// ─── Python: FastAPI and Flask ──────────────────────────────────────

/**
 * Shared files of the Python backends: .gitignore and, with a database, db.py and .env.
 * @param o project options
 */
function writePythonBase(o: PartOptions): void {
    write(path.join(o.dir, '.gitignore'), pythonGitignore);
    if (o.database) {
        write(path.join(o.dir, 'db.py'), pythonModule(o.database, o.name));
        write(path.join(o.dir, '.env'), `DATABASE_URL=${databaseUrl(o.database, o.name, 'sqlalchemy')}\n`);
    }
}

/**
 * Writes FastAPI's main.py (plus db.py + .env with a database).
 * @param o project options
 */
function writeFastApiProject(o: PartOptions): void {
    writePythonBase(o);
    const dbRoute = `

@app.get("/api/db")
def database_status():
    try:
        return {"ok": True, "result": check_database()}
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": str(exc)})
`;
    write(
        path.join(o.dir, 'main.py'),
        `
from fastapi import FastAPI
${o.database ? 'from fastapi.responses import JSONResponse\n' : ''}from pydantic import BaseModel
${o.database ? '\nfrom db import check_database\n' : ''}
app = FastAPI(title="${o.name}")


class Todo(BaseModel):
    title: str
    done: bool = False


todos: list[Todo] = []


@app.get("/")
def read_root():
    return {"message": "Hello from ${o.name}!", "docs": "Open /docs for interactive API docs"}


@app.get("/api/health")
def health():
    return {"status": "ok"}
${o.database ? dbRoute : ''}

@app.get("/api/todos")
def list_todos() -> list[Todo]:
    return todos


@app.post("/api/todos", status_code=201)
def create_todo(todo: Todo) -> Todo:
    todos.append(todo)
    return todo
`,
    );
}

/**
 * Writes Flask's app.py (plus db.py + .env with a database).
 * @param o project options
 */
function writeFlaskProject(o: PartOptions): void {
    writePythonBase(o);
    const dbRoute = `

@app.get("/api/db")
def database_status():
    try:
        return jsonify(ok=True, result=check_database())
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 500
`;
    write(
        path.join(o.dir, 'app.py'),
        `
from flask import Flask, jsonify, request
${o.database ? '\nfrom db import check_database\n' : ''}
app = Flask(__name__)

todos = []


@app.get("/")
def index():
    return jsonify(message="Hello from ${o.name}!")


@app.get("/api/health")
def health():
    return jsonify(status="ok")
${o.database ? dbRoute : ''}

@app.get("/api/todos")
def list_todos():
    return jsonify(todos)


@app.post("/api/todos")
def create_todo():
    data = request.get_json(silent=True) or {}
    if not data.get("title"):
        return jsonify(error="title is required"), 400
    todo = {"id": len(todos) + 1, "title": data["title"], "done": False}
    todos.append(todo)
    return jsonify(todo), 201
`,
    );
}

/**
 * Shared Python steps: virtual environment (.venv), install packages and save requirements.txt.
 * @param o project options
 * @param packages pip packages
 */
function pythonSteps(o: PartOptions, packages: string[]): Step[] {
    const first = packages[0].replace(/\[.*\]/, '');
    return [
        cmd('Creating virtual environment (.venv)', `${o.python} -m venv .venv`, o.dir),
        cmd(`Installing ${first}${packages.length > 1 ? ' and friends' : ''}`, pipInstall(packages), o.dir),
        cmd('Saving requirements.txt', `${venvPython()} -m pip freeze > requirements.txt`, o.dir, true),
    ];
}

/** FastAPI steps. */
function fastapiPlan(o: PartOptions): Plan {
    return {
        steps: [
            makeDir(o.dir),
            task('Writing API files', function () {
                writeFastApiProject(o);
            }),
            ...pythonSteps(o, ['fastapi[standard]', ...(o.database ? pythonPackages(o.database) : [])]),
            ...dockerStep(o, pythonDockerfile({ port: 8000, cmd: ['fastapi', 'run', 'main.py', '--port', '8000'] })),
        ],
        server: { command: `${venvPython()} -m fastapi dev main.py`, url: 'http://localhost:8000/docs' },
        mainFiles: ['main.py'],
        notes: [
            'Open `/docs` to try every endpoint from your browser.',
            'Packages live in `.venv`, isolated from the rest of your computer.',
            ...databaseNote(o),
        ],
    };
}

/** Flask steps. */
function flaskPlan(o: PartOptions): Plan {
    return {
        steps: [
            makeDir(o.dir),
            task('Writing app files', function () {
                writeFlaskProject(o);
            }),
            ...pythonSteps(o, ['flask', ...(o.database ? pythonPackages(o.database) : [])]),
            ...dockerStep(
                o,
                pythonDockerfile({
                    port: 5001,
                    cmd: ['flask', '--app', 'app', 'run', '--host', '0.0.0.0', '--port', '5001'],
                }),
            ),
        ],
        // ! Port 5001: on macOS port 5000 is taken by AirPlay.
        server: { command: `${venvPython()} -m flask --app app run --debug --port 5001`, url: 'http://localhost:5001' },
        mainFiles: ['app.py'],
        notes: ['`--debug` reloads the server when you save and shows helpful error pages.', ...databaseNote(o)],
    };
}

// ─── Django ─────────────────────────────────────────────────────────

/**
 * Adds /api/health to config/urls.py and configures the database.
 * @param o project options
 * @param log function to report what is being done
 */
function configureDjango(o: PartOptions, log: (m: string) => void): void {
    const db = o.database ?? 'SQLite';
    const urls = path.join(o.dir, 'config', 'urls.py');
    let source = fs.readFileSync(urls, 'utf8');
    source = source.replace(
        'from django.urls import path',
        'from django.http import JsonResponse\nfrom django.urls import path',
    );
    source = source.replace(
        /urlpatterns = \[/,
        'urlpatterns = [\n    path("api/health", lambda request: JsonResponse({"status": "ok"})),',
    );
    fs.writeFileSync(urls, source);
    configureDjangoDatabase(o.dir, db, o.name);
    log(db === 'SQLite' ? 'Using SQLite (db.sqlite3)' : `DATABASE_URL in .env (${db})`);
}

/** Django steps. */
function djangoPlan(o: PartOptions): Plan {
    const db = o.database ?? 'SQLite';
    const steps: Step[] = [
        makeDir(o.dir),
        task('Writing .gitignore', function () {
            write(path.join(o.dir, '.gitignore'), pythonGitignore);
        }),
        cmd('Creating virtual environment (.venv)', `${o.python} -m venv .venv`, o.dir),
        cmd('Installing Django', pipInstall(['django', ...djangoPackages(db)]), o.dir),
        cmd('Creating Django project', `${venvPython()} -m django startproject config .`, o.dir),
        task('Adding /api/health and database settings', function (log) {
            configureDjango(o, log);
        }),
    ];
    // ? With SQLite the tables can be created now; with a server, once it is running.
    if (db === 'SQLite') {
        steps.push(cmd('Setting up the database', `${venvPython()} manage.py migrate`, o.dir));
    }
    steps.push(
        cmd('Saving requirements.txt', `${venvPython()} -m pip freeze > requirements.txt`, o.dir, true),
        ...dockerStep(o, pythonDockerfile({ port: 8000, cmd: ['python', 'manage.py', 'runserver', '0.0.0.0:8000'] })),
    );
    const notes = [
        `Create your first app with \`${venvPython()} manage.py startapp core\`.`,
        `Create an admin user with \`${venvPython()} manage.py createsuperuser\`, then visit /admin.`,
    ];
    if (db !== 'SQLite') {
        notes.push(`Start your ${db} server, then run \`${venvPython()} manage.py migrate\`.`);
    }
    return {
        steps,
        server: { command: `${venvPython()} manage.py runserver`, url: 'http://localhost:8000' },
        mainFiles: ['config/urls.py'],
        notes,
    };
}

// ─── Laravel ────────────────────────────────────────────────────────

/** Laravel steps. */
function laravelPlan(o: PartOptions): Plan {
    const notes = [
        'Routes live in `routes/web.php`, views in `resources/views`.',
        'Create a model with its migration: `php artisan make:model Todo -m`.',
    ];
    if (o.database && o.database !== 'SQLite') {
        notes.push(`Start your ${o.database} server, then run \`php artisan migrate\`.`);
    }
    return {
        steps: [
            cmd(
                'Creating Laravel project (downloads quite a bit)',
                `composer create-project laravel/laravel ${o.folder} --no-interaction --prefer-dist`,
                o.parentDir,
            ),
            task('Adding /api/health and database settings', function (log) {
                appendLines(
                    path.join(o.dir, 'routes', 'web.php'),
                    "\nRoute::get('/api/health', fn () => ['status' => 'ok']);",
                );
                if (o.database && o.database !== 'SQLite') {
                    configureLaravelDatabase(o.dir, o.database, o.name);
                    log(`DB_CONNECTION set to ${o.database} in .env`);
                }
            }),
        ],
        server: { command: 'php artisan serve', url: 'http://localhost:8000' },
        mainFiles: ['routes/web.php'],
        notes,
    };
}

// ─── Go, Rust, .NET and Spring Boot ─────────────────────────────────

/**
 * Writes go.mod and main.go (standard library only).
 * @param o project options
 */
function writeGoProject(o: PartOptions): void {
    write(path.join(o.dir, 'go.mod'), `module ${o.packageName}\n\ngo 1.22\n`);
    write(path.join(o.dir, '.gitignore'), `/${o.packageName}\n*.exe\n`);
    write(
        path.join(o.dir, 'main.go'),
        `
package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// writeJSON sends any value as a JSON response.
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"message": "Hello from ${o.name}!"})
	})

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	log.Println("Server running at http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
`,
    );
}

/** Go steps. */
function goPlan(o: PartOptions): Plan {
    return {
        steps: [
            makeDir(o.dir),
            task('Writing Go files', function () {
                writeGoProject(o);
            }),
            cmd('Checking the Go module', 'go mod tidy', o.dir),
            ...dockerStep(o, goDockerfile()),
        ],
        server: { command: 'go run .', url: 'http://localhost:8080' },
        mainFiles: ['main.go'],
        notes: ['Run `go run .` again after each change (or install `air` for live reload).'],
    };
}

/** .NET Web API steps. */
function dotnetPlan(o: PartOptions): Plan {
    return {
        steps: [
            cmd('Creating .NET Web API', `dotnet new webapi -o ${o.folder} --no-https`, o.parentDir),
            task('Adding /api/health', function () {
                const program = path.join(o.dir, 'Program.cs');
                const source = fs.readFileSync(program, 'utf8');
                fs.writeFileSync(
                    program,
                    source.replace(
                        /app\.Run\(\);/,
                        'app.MapGet("/api/health", () => new { status = "ok" });\n\napp.Run();',
                    ),
                );
            }),
        ],
        server: { command: 'dotnet watch run --urls http://localhost:5080', url: 'http://localhost:5080/api/health' },
        mainFiles: ['Program.cs'],
        notes: ['`dotnet watch` rebuilds and restarts the API when you save.'],
    };
}

/**
 * Writes Cargo.toml and src/main.rs with an Axum server.
 * @param o project options
 */
function writeRustProject(o: PartOptions): void {
    write(
        path.join(o.dir, 'Cargo.toml'),
        `
[package]
name = "${o.packageName}"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.8"
serde_json = "1"
tokio = { version = "1", features = ["full"] }
`,
    );
    write(path.join(o.dir, '.gitignore'), '/target\n');
    write(
        path.join(o.dir, 'src', 'main.rs'),
        `
use axum::{routing::get, Json, Router};
use serde_json::{json, Value};

async fn root() -> Json<Value> {
    Json(json!({ "message": "Hello from ${o.name}!" }))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/", get(root))
        .route("/api/health", get(health));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("Server running at http://localhost:3000");
    axum::serve(listener, app).await.unwrap();
}
`,
    );
}

/** Rust (Axum) steps. */
function rustPlan(o: PartOptions): Plan {
    return {
        steps: [
            makeDir(o.dir),
            task('Writing Rust files', function () {
                writeRustProject(o);
            }),
            cmd('Downloading crates', 'cargo fetch', o.dir),
            ...dockerStep(o, rustDockerfile(o.packageName)),
        ],
        server: { command: 'cargo run', url: 'http://localhost:3000' },
        mainFiles: ['src/main.rs'],
        notes: ['The first `cargo run` compiles everything and takes a while. Later runs are quick.'],
    };
}

/**
 * Name that is valid as a Java package: lowercase letters and digits only.
 * @param name project name
 */
function javaPackageName(name: string): string {
    const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return /^[a-z]/.test(clean) ? clean : `app${clean}`;
}

/**
 * Downloads the project from start.spring.io and saves it as a .zip.
 * @param zip path to save the zip to
 * @param pkg Java package name
 * @param dependencies Spring Initializr dependencies
 */
async function downloadSpringProject(zip: string, pkg: string, dependencies: string[]): Promise<void> {
    const params = new URLSearchParams({
        type: 'maven-project',
        language: 'java',
        javaVersion: '21',
        dependencies: dependencies.join(','),
        groupId: 'com.example',
        artifactId: pkg,
        name: pkg,
        packageName: `com.example.${pkg}`,
    });
    // ! A Spring project weighs less than 1 MB: accept 20 MB at most.
    const url = `https://start.spring.io/starter.zip?${params}`;
    fs.writeFileSync(zip, await fetchBuffer(url, { timeoutMs: 60000, maxBytes: 20 * 1024 * 1024 }));
}

/**
 * Unzips a .zip WITHOUT going through a shell, so no path can be interpreted as a command.
 * Windows ships a tar.exe that can open .zip files; on macOS and Linux unzip is used.
 * @param zip .zip file
 * @param dest folder to unzip into (must exist)
 */
function extractZip(zip: string, dest: string): void {
    if (isWindows) {
        const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
        cp.execFileSync(tar, ['-xf', zip, '-C', dest], { windowsHide: true });
    } else {
        cp.execFileSync('unzip', ['-q', '-o', zip, '-d', dest]);
    }
}

/** Spring Boot steps. */
function springPlan(o: PartOptions): Plan {
    const pkg = javaPackageName(o.packageName);
    const zip = path.join(o.parentDir, `${o.folder}.zip`);
    // * Libraries with the "spring-" prefix → Spring Initializr dependencies.
    const dependencies = ['web', 'devtools'];
    for (const id of o.libraries) {
        if (id.startsWith('spring-')) {
            dependencies.push(id.slice('spring-'.length));
        }
    }
    const controller = `
package com.example.${pkg};

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HelloController {

    @GetMapping("/")
    public Map<String, String> hello() {
        return Map.of("message", "Hello from ${o.name}!");
    }

    @GetMapping("/api/health")
    public Map<String, String> health() {
        return Map.of("status", "ok");
    }
}
`;
    return {
        steps: [
            task('Downloading project from start.spring.io', async function (log) {
                await downloadSpringProject(zip, pkg, dependencies);
                fs.mkdirSync(o.dir, { recursive: true });
                log(`Dependencies: ${dependencies.join(', ')}`);
            }),
            task('Extracting project', function () {
                extractZip(zip, o.dir);
            }),
            task('Adding /api/health', function () {
                fs.rmSync(zip, { force: true });
                write(
                    path.join(o.dir, 'src', 'main', 'java', 'com', 'example', pkg, 'HelloController.java'),
                    controller,
                );
            }),
        ],
        server: {
            command: isWindows ? 'mvnw.cmd spring-boot:run' : './mvnw spring-boot:run',
            url: 'http://localhost:8080',
        },
        mainFiles: [`src/main/java/com/example/${pkg}/HelloController.java`],
        notes: ['The first run downloads Maven and the dependencies, so give it a minute.'],
    };
}

// ─── Catalog ────────────────────────────────────────────────────────

export const backendTemplates: Template[] = [
    {
        id: 'express',
        label: 'Express API',
        icon: 'server',
        category: 'Backend',
        description: 'Node.js',
        detail: 'A minimal REST API with Node.js. The classic first backend.',
        recommended: true,
        databases: allDatabases,
        port: 3000,
        docker: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://expressjs.com/en/starter/basic-routing.html',
        vscode: [],
        plan: expressPlan,
    },
    {
        id: 'nest',
        label: 'NestJS',
        icon: 'symbol-class',
        category: 'Backend',
        description: 'Node.js + TypeScript',
        detail: 'Structured TypeScript backend with modules, controllers and services. Great for bigger APIs.',
        databases: allDatabases,
        port: 3000,
        docker: true,
        ci: 'node',
        node: true,
        requires: ['node'],
        nameStyle: 'kebab',
        docs: 'https://docs.nestjs.com/first-steps',
        vscode: ['dbaeumer.vscode-eslint'],
        plan: nestPlan,
    },
    {
        id: 'fastapi',
        label: 'FastAPI',
        icon: 'zap',
        category: 'Backend',
        description: 'Python',
        detail: 'Modern Python API with automatic interactive docs at /docs.',
        recommended: true,
        databases: allDatabases,
        port: 8000,
        docker: true,
        ci: 'python',
        node: false,
        requires: ['python'],
        nameStyle: 'kebab',
        docs: 'https://fastapi.tiangolo.com/tutorial/',
        vscode: pythonExt,
        plan: fastapiPlan,
    },
    {
        id: 'flask',
        label: 'Flask',
        icon: 'beaker',
        category: 'Backend',
        description: 'Python',
        detail: 'Tiny and simple Python web framework. Easy to understand line by line.',
        databases: allDatabases,
        port: 5001,
        docker: true,
        ci: 'python',
        node: false,
        requires: ['python'],
        nameStyle: 'kebab',
        docs: 'https://flask.palletsprojects.com/en/stable/quickstart/',
        vscode: pythonExt,
        plan: flaskPlan,
    },
    {
        id: 'django',
        label: 'Django',
        icon: 'globe',
        category: 'Backend',
        description: 'Python',
        detail: 'The "batteries included" Python framework, with admin panel and ORM.',
        databases: ['SQLite', 'PostgreSQL', 'MySQL'],
        port: 8000,
        docker: true,
        ci: 'python',
        node: false,
        requires: ['python'],
        nameStyle: 'kebab',
        docs: 'https://docs.djangoproject.com/en/stable/intro/tutorial01/',
        vscode: [...pythonExt, 'batisteo.vscode-django'],
        plan: djangoPlan,
    },
    {
        id: 'laravel',
        label: 'Laravel',
        icon: 'symbol-property',
        category: 'Backend',
        description: 'PHP',
        detail: 'Elegant PHP framework with everything you need. DevStarter can install PHP for you.',
        databases: ['SQLite', 'PostgreSQL', 'MySQL'],
        port: 8000,
        ci: 'php',
        node: false,
        requires: ['php', 'composer'],
        nameStyle: 'kebab',
        docs: 'https://laravel.com/docs/installation',
        vscode: ['bmewburn.vscode-intelephense-client', 'laravel.vscode-laravel'],
        plan: laravelPlan,
    },
    {
        id: 'go',
        label: 'Go API',
        icon: 'rocket',
        category: 'Backend',
        description: 'Go',
        detail: 'Fast, simple and compiled. Uses only the standard library.',
        port: 8080,
        docker: true,
        ci: 'go',
        node: false,
        requires: ['go'],
        nameStyle: 'kebab',
        docs: 'https://go.dev/tour/',
        vscode: ['golang.go'],
        plan: goPlan,
    },
    {
        id: 'dotnet',
        label: '.NET Web API',
        icon: 'symbol-namespace',
        category: 'Backend',
        description: 'C#',
        detail: "Microsoft's C# framework for fast, typed APIs.",
        port: 5080,
        ci: 'dotnet',
        node: false,
        requires: ['dotnet'],
        nameStyle: 'kebab',
        docs: 'https://learn.microsoft.com/aspnet/core/tutorials/min-web-api',
        vscode: ['ms-dotnettools.csdevkit'],
        plan: dotnetPlan,
    },
    {
        id: 'rust',
        label: 'Rust (Axum)',
        icon: 'gear',
        category: 'Backend',
        description: 'Rust',
        detail: 'Blazing fast and memory safe. A steeper learning curve, but very rewarding.',
        port: 3000,
        docker: true,
        ci: 'rust',
        node: false,
        requires: ['cargo'],
        nameStyle: 'kebab',
        docs: 'https://doc.rust-lang.org/book/',
        vscode: ['rust-lang.rust-analyzer'],
        plan: rustPlan,
    },
    {
        id: 'spring',
        label: 'Spring Boot',
        icon: 'coffee',
        category: 'Backend',
        description: 'Java',
        detail: 'The most popular Java framework, used by big companies everywhere.',
        port: 8080,
        ci: 'java',
        node: false,
        requires: ['java'],
        nameStyle: 'kebab',
        docs: 'https://spring.io/guides/gs/rest-service',
        vscode: ['vscjava.vscode-java-pack', 'vmware.vscode-boot-dev-pack'],
        plan: springPlan,
    },
];
