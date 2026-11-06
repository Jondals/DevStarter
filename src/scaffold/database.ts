/**
 * scaffold/database.ts
 * ────────────────────
 * Database integration for every kind of backend.
 *
 * The idea is the same everywhere: install the database "driver", store the connection
 * in a .env file and add an /api/db route to check that it connects.
 * This file generates the connection code (Node, Python) and adjusts Django and Laravel.
 */
import * as fs from 'fs';
import * as path from 'path';
import { snakeCase, updateEnvFile } from './files';

export type Database = 'SQLite' | 'PostgreSQL' | 'MySQL' | 'MongoDB';

export const allDatabases: Database[] = ['SQLite', 'PostgreSQL', 'MySQL', 'MongoDB'];

/**
 * SQLite is stored in a file; the others need a server (local, Docker or in the cloud).
 * @param db chosen database (or none)
 */
export function needsServer(db: Database | undefined): boolean {
    return !!db && db !== 'SQLite';
}

/** Default user, password and port. They match the docker-compose.yml we generate. */
export const credentials = {
    PostgreSQL: { user: 'postgres', password: 'postgres', port: 5432 },
    MySQL: { user: 'root', password: 'password', port: 3306 },
    MongoDB: { port: 27017 },
};

/**
 * Connection URL in the "dialect" each library understands.
 * @param db database
 * @param name project name (used as the database name)
 * @param flavor node (pg, mysql2…), sqlalchemy (Python) or django (dj-database-url)
 */
export function databaseUrl(db: Database, name: string, flavor: 'node' | 'sqlalchemy' | 'django' = 'node'): string {
    const n = snakeCase(name);
    const pg = credentials.PostgreSQL;
    const my = credentials.MySQL;
    switch (db) {
        case 'PostgreSQL':
            return `${flavor === 'sqlalchemy' ? 'postgresql+psycopg' : 'postgres'}://${pg.user}:${pg.password}@localhost:${pg.port}/${n}`;
        case 'MySQL':
            return `${flavor === 'sqlalchemy' ? 'mysql+pymysql' : 'mysql'}://${my.user}:${my.password}@localhost:${my.port}/${n}`;
        case 'MongoDB':
            return `mongodb://localhost:${credentials.MongoDB.port}/${n}`;
        case 'SQLite':
            return flavor === 'node' ? 'data.db' : 'sqlite:///./data.db';
    }
}

/**
 * .env line for Node projects.
 * @param db database
 * @param name project name
 */
export function nodeEnvLine(db: Database, name: string): string {
    return db === 'SQLite' ? 'DATABASE_FILE=data.db' : `DATABASE_URL=${databaseUrl(db, name)}`;
}

// ─── Node.js (Express, NestJS, Next.js, Nuxt, SvelteKit) ────────────

/**
 * npm packages of the driver (and its types if the project uses TypeScript).
 * @param db database
 * @param ts the project uses TypeScript
 */
export function nodePackages(db: Database, ts: boolean): { deps: string[]; devDeps: string[] } {
    switch (db) {
        case 'PostgreSQL':
            return { deps: ['pg'], devDeps: ts ? ['@types/pg'] : [] };
        case 'MySQL':
            return { deps: ['mysql2'], devDeps: [] };
        case 'SQLite':
            return { deps: ['better-sqlite3'], devDeps: ts ? ['@types/better-sqlite3'] : [] };
        case 'MongoDB':
            return { deps: ['mongoose'], devDeps: [] };
    }
}

/** Options of the Node connection module. */
export interface NodeModuleOptions {
    ts: boolean;
    /** Expression the variables are read from (process.env, or `env` in SvelteKit). */
    env?: string;
    /** Extra lines at the top (framework-specific imports). */
    header?: string;
}

/**
 * Code of the module that connects to the database and exports `checkDatabase()`.
 * @param db database
 * @param opts language, source of the variables and header
 */
export function nodeModule(db: Database, opts: NodeModuleOptions): string {
    const env = opts.env ?? 'process.env';
    const header = opts.header ? opts.header + '\n' : '';
    switch (db) {
        case 'PostgreSQL':
            return `${header}import pg from 'pg'

// A pool reuses connections instead of opening a new one for every query.
export const pool = new pg.Pool({ connectionString: ${env}.DATABASE_URL })

export async function checkDatabase() {
  const result = await pool.query('SELECT NOW() AS now')
  return result.rows[0]
}
`;
        case 'MySQL':
            return `${header}import mysql from 'mysql2/promise'

export const pool = mysql.createPool(${env}.DATABASE_URL ?? '')

export async function checkDatabase() {
  const [rows] = await pool.query('SELECT NOW() AS now')
  return ${opts.ts ? '(rows as Array<Record<string, unknown>>)' : 'rows'}[0]
}
`;
        case 'SQLite':
            return `${header}import Database from 'better-sqlite3'

// The whole database lives in a single file inside your project. No server needed!
export const db = new Database(${env}.DATABASE_FILE ?? 'data.db')

export async function checkDatabase() {
  return db.prepare("SELECT datetime('now') AS now").get()
}
`;
        case 'MongoDB':
            return `${header}import mongoose from 'mongoose'

export async function checkDatabase() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(${env}.DATABASE_URL ?? '')
  }
  return { connected: true, database: mongoose.connection.name }
}
`;
    }
}

// ─── Python (FastAPI, Flask) ────────────────────────────────────────

/**
 * pip packages to connect to the database.
 * @param db database
 */
export function pythonPackages(db: Database): string[] {
    switch (db) {
        case 'PostgreSQL':
            return ['sqlmodel', 'psycopg[binary]', 'python-dotenv'];
        case 'MySQL':
            return ['sqlmodel', 'pymysql', 'python-dotenv'];
        case 'SQLite':
            return ['sqlmodel', 'python-dotenv'];
        case 'MongoDB':
            return ['pymongo', 'python-dotenv'];
    }
}

/**
 * Code of db.py with the `check_database()` function.
 * @param db database
 * @param name project name
 */
export function pythonModule(db: Database, name: string): string {
    if (db === 'MongoDB') {
        return `
import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

client = MongoClient(os.getenv("DATABASE_URL", "${databaseUrl(db, name)}"), serverSelectionTimeoutMS=3000)


def check_database():
    client.admin.command("ping")
    return {"ping": "ok", "database": client.get_default_database().name}
`;
    }
    return `
import os

from dotenv import load_dotenv
from sqlalchemy import text
from sqlmodel import create_engine

load_dotenv()

# The engine manages the connections to the database configured in .env
engine = create_engine(os.getenv("DATABASE_URL", "sqlite:///./data.db"))


def check_database():
    with engine.connect() as conn:
        return {"result": conn.execute(text("SELECT 1")).scalar()}
`;
}

// ─── Django ─────────────────────────────────────────────────────────

/**
 * Extra Django packages for each database.
 * @param db database
 */
export function djangoPackages(db: Database): string[] {
    switch (db) {
        case 'PostgreSQL':
            return ['psycopg[binary]', 'dj-database-url', 'python-dotenv'];
        case 'MySQL':
            return ['mysqlclient', 'dj-database-url', 'python-dotenv'];
        default:
            return []; // SQLite is configured out of the box
    }
}

/**
 * Changes settings.py to read the database from DATABASE_URL (in the .env).
 * @param dir Django project folder
 * @param db database
 * @param name project name
 */
export function configureDjangoDatabase(dir: string, db: Database, name: string): void {
    if (db === 'SQLite') {
        return;
    }
    const settings = path.join(dir, 'config', 'settings.py');
    let source = fs.readFileSync(settings, 'utf8');
    source = source.replace(
        'from pathlib import Path',
        'import os\nfrom pathlib import Path\n\nimport dj_database_url\nfrom dotenv import load_dotenv\n\n' +
            'load_dotenv(Path(__file__).resolve().parent.parent / ".env")',
    );
    source = source.replace(
        /DATABASES = \{[\s\S]*?\n\}\n/,
        'DATABASES = {\n    "default": dj_database_url.config(default=os.getenv("DATABASE_URL"), conn_max_age=600),\n}\n',
    );
    fs.writeFileSync(settings, source);
    fs.writeFileSync(path.join(dir, '.env'), `DATABASE_URL=${databaseUrl(db, name, 'django')}\n`);
}

// ─── Laravel ────────────────────────────────────────────────────────

/**
 * Laravel already ships with SQLite; for MySQL/PostgreSQL changing the .env is enough.
 * @param dir Laravel project folder
 * @param db database
 * @param name project name
 */
export function configureLaravelDatabase(dir: string, db: Database, name: string): void {
    if (db === 'SQLite' || db === 'MongoDB') {
        return;
    }
    const isPg = db === 'PostgreSQL';
    const c = isPg ? credentials.PostgreSQL : credentials.MySQL;
    const values = {
        DB_CONNECTION: isPg ? 'pgsql' : 'mysql',
        DB_HOST: '127.0.0.1',
        DB_PORT: String(c.port),
        DB_DATABASE: snakeCase(name),
        DB_USERNAME: c.user,
        DB_PASSWORD: c.password,
    };
    updateEnvFile(path.join(dir, '.env'), values);
    updateEnvFile(path.join(dir, '.env.example'), values);
}
