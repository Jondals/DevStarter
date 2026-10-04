/**
 * scaffold/database.ts
 * ────────────────────
 * Integración con bases de datos para cada tipo de backend.
 *
 * La idea es la misma en todos: se instala el "driver" de la base de datos, se guarda
 * la conexión en un fichero .env y se añade una ruta /api/db para comprobar que conecta.
 * Este fichero genera el código de conexión (Node, Python) y ajusta Django y Laravel.
 */
import * as fs from 'fs';
import * as path from 'path';
import { snakeCase, updateEnvFile } from './files';

export type Database = 'SQLite' | 'PostgreSQL' | 'MySQL' | 'MongoDB';

export const allDatabases: Database[] = ['SQLite', 'PostgreSQL', 'MySQL', 'MongoDB'];

/**
 * SQLite se guarda en un fichero; las demás necesitan un servidor (local, Docker o en la nube).
 * @param db base de datos elegida (o ninguna)
 */
export function needsServer(db: Database | undefined): boolean {
    return !!db && db !== 'SQLite';
}

/** Usuario, contraseña y puerto por defecto. Coinciden con el docker-compose.yml que generamos. */
export const credentials = {
    PostgreSQL: { user: 'postgres', password: 'postgres', port: 5432 },
    MySQL: { user: 'root', password: 'password', port: 3306 },
    MongoDB: { port: 27017 },
};

/**
 * URL de conexión según el "dialecto" que entiende cada librería.
 * @param db base de datos
 * @param name nombre del proyecto (se usa como nombre de la base de datos)
 * @param flavor node (pg, mysql2…), sqlalchemy (Python) o django (dj-database-url)
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
 * Línea del .env para proyectos Node.
 * @param db base de datos
 * @param name nombre del proyecto
 */
export function nodeEnvLine(db: Database, name: string): string {
    return db === 'SQLite' ? 'DATABASE_FILE=data.db' : `DATABASE_URL=${databaseUrl(db, name)}`;
}

// ─── Node.js (Express, NestJS, Next.js, Nuxt, SvelteKit) ────────────

/**
 * Paquetes npm del driver (y sus tipos si el proyecto usa TypeScript).
 * @param db base de datos
 * @param ts el proyecto usa TypeScript
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

/** Opciones del módulo de conexión de Node. */
export interface NodeModuleOptions {
    ts: boolean;
    /** Expresión de donde se leen las variables (process.env, o `env` en SvelteKit). */
    env?: string;
    /** Líneas extra al principio (imports propios del framework). */
    header?: string;
}

/**
 * Código del módulo que conecta con la base de datos y exporta `checkDatabase()`.
 * @param db base de datos
 * @param opts lenguaje, origen de las variables y cabecera
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
 * Paquetes de pip para conectar con la base de datos.
 * @param db base de datos
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
 * Código de db.py con la función `check_database()`.
 * @param db base de datos
 * @param name nombre del proyecto
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
 * Paquetes extra de Django para cada base de datos.
 * @param db base de datos
 */
export function djangoPackages(db: Database): string[] {
    switch (db) {
        case 'PostgreSQL':
            return ['psycopg[binary]', 'dj-database-url', 'python-dotenv'];
        case 'MySQL':
            return ['mysqlclient', 'dj-database-url', 'python-dotenv'];
        default:
            return []; // SQLite viene configurado de serie
    }
}

/**
 * Cambia settings.py para leer la base de datos de DATABASE_URL (en el .env).
 * @param dir carpeta del proyecto Django
 * @param db base de datos
 * @param name nombre del proyecto
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
 * Laravel ya trae SQLite; para MySQL/PostgreSQL basta con cambiar el .env.
 * @param dir carpeta del proyecto Laravel
 * @param db base de datos
 * @param name nombre del proyecto
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
