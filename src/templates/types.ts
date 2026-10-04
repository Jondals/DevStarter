/**
 * templates/types.ts
 * ──────────────────
 * Tipos compartidos por todas las plantillas (qué es una plantilla, qué recibe
 * y qué devuelve) y pequeñas funciones para crear pasos del terminal.
 */
import * as fs from 'fs';
import { CommandStep, Logger, Step } from '../terminal';
import { scaffolderTag } from '../updates';
import { PackageManager, ToolId } from '../tools';
import { Database } from '../scaffold/database';
import { CiKind } from '../scaffold/extras';

export type Category = 'Frontend' | 'Full-stack' | 'Backend' | 'Mobile' | 'Other';

/** Todo lo que una plantilla necesita saber para crear su parte del proyecto. */
export interface PartOptions {
    /** Nombre del proyecto tal y como lo escribió la persona. */
    name: string;
    /** Nombre para package.json, Cargo.toml… (en full-stack: "nombre-backend"). */
    packageName: string;
    /** Carpeta donde se crea la parte. */
    parentDir: string;
    /** Nombre de la carpeta de la parte (el nombre del proyecto, o "frontend" / "backend"). */
    folder: string;
    /** Ruta completa: parentDir/folder. */
    dir: string;
    typescript: boolean;
    tailwind: boolean;
    database?: Database;
    pm: PackageManager;
    /** Comando de Python del sistema (python / py / python3). */
    python?: string;
    beginner: boolean;
    /** Si es un frontend con backend, URL del backend para redirigir /api. */
    backendUrl?: string;
    /** Generar Dockerfile (solo backends). */
    dockerfile: boolean;
    /** Identificadores de las librerías elegidas para esta parte. */
    libraries: string[];
}

/** Lo que devuelve una plantilla: los pasos a ejecutar y cómo arrancarla después. */
export interface Plan {
    steps: Step[];
    /** Comando para arrancar el servidor de desarrollo, si lo hay. */
    server?: { command: string; url?: string };
    /** Fichero principal a abrir (relativo a la parte); gana el primero que exista. */
    mainFiles: string[];
    /** Consejos que acaban en GETTING_STARTED.md. */
    notes: string[];
}

/** Una plantilla de proyecto. */
export interface Template {
    id: string;
    label: string;
    /** Icono de VS Code (codicon) para el selector. */
    icon: string;
    category: Category;
    /** Texto corto al lado del nombre. */
    description: string;
    /** Explicación para principiantes. */
    detail: string;
    recommended?: boolean;
    /** Ofrece elegir entre TypeScript y JavaScript. */
    languages?: boolean;
    tailwind?: boolean;
    /** Bases de datos que sabe integrar. */
    databases?: Database[];
    /** Si es un backend que se puede añadir a un frontend: puerto en el que escucha. */
    port?: number;
    /** Frontends y apps móviles a los que se puede añadir un backend. */
    acceptsBackend?: boolean;
    /** Sabe generar un Dockerfile. */
    docker?: boolean;
    /** Tipo de proyecto para GitHub Actions. */
    ci?: CiKind;
    /** Usa npm / pnpm / bun. */
    node: boolean;
    requires: ToolId[];
    nameStyle: 'kebab' | 'snake';
    docs: string;
    /** Extensiones de VS Code recomendadas para este stack. */
    vscode: string[];
    /** Construye los pasos para crear esta parte del proyecto. */
    plan(o: PartOptions): Plan;
}

export const isWindows = process.platform === 'win32';

/** Python dentro del entorno virtual del proyecto (ruta relativa a la carpeta del proyecto). */
export function venvPython(): string {
    return isWindows ? '.venv\\Scripts\\python' : '.venv/bin/python';
}

/**
 * Comando pip install con cada paquete entre comillas (por los corchetes de "psycopg[binary]").
 * @param packages paquetes a instalar
 */
export function pipInstall(packages: string[]): string {
    const quoted: string[] = [];
    for (const p of packages) {
        quoted.push(`"${p}"`);
    }
    return `${venvPython()} -m pip install ${quoted.join(' ')}`;
}

/**
 * Crea un paso que ejecuta un comando.
 * @param title texto que se muestra
 * @param command comando de consola
 * @param cwd carpeta donde se ejecuta
 * @param optional si falla, solo avisa
 */
export function cmd(title: string, command: string, cwd: string, optional = false): Step {
    return { kind: 'command', title, command, cwd, optional };
}

/**
 * Crea un paso que ejecuta código de la extensión.
 * @param title texto que se muestra
 * @param run función a ejecutar (recibe `log` para contar lo que hace)
 * @param optional si falla, solo avisa
 */
export function task(title: string, run: (log: Logger) => void | Promise<void>, optional = false): Step {
    return { kind: 'task', title, run, optional };
}

/**
 * Paso que crea la carpeta del proyecto.
 * @param dir carpeta a crear
 */
export function makeDir(dir: string): Step {
    return task('Creating project folder', function () {
        fs.mkdirSync(dir, { recursive: true });
    });
}

/**
 * Paso que ejecuta un generador de proyectos publicado en npm (create-vite, @angular/cli…).
 * Usa la versión fijada en los ajustes (o "latest") y guarda cómo repetir el comando con
 * otra versión, para poder reintentarlo con una compatible si la última pide un Node más nuevo.
 * @param o opciones del proyecto (para el gestor de paquetes)
 * @param title texto que se muestra
 * @param pkg paquete de npm del generador
 * @param args argumentos del generador
 * @param cwd carpeta donde se ejecuta
 */
export function scaffold(o: PartOptions, title: string, pkg: string, args: string[], cwd: string): CommandStep {
    /** Comando completo con una versión concreta del generador, más el arreglo de pnpm. */
    function withVersion(version: string): string {
        return o.pm.exec(`${pkg}@${version}`, args) + pinPnpmCommand(o);
    }
    return {
        kind: 'command',
        title,
        command: withVersion(scaffolderTag(pkg)),
        cwd,
        compat: { package: pkg, command: withVersion },
    };
}

/**
 * Algunos generadores (Angular, Nuxt…) escriben en el package.json un campo
 * "packageManager": "pnpm@<la última versión>". Si no coincide con el pnpm instalado, pnpm
 * intenta descargar y cambiar a esa versión cada vez que se usa en la carpeta, y en Windows
 * eso falla ("El sistema no puede encontrar la ruta especificada").
 * Devuelve un comando (para encadenar con &&) que fija el campo al pnpm instalado.
 * @param o opciones del proyecto
 * @returns "" si no hace falta (otro gestor, o versión desconocida)
 */
export function pinPnpmCommand(o: PartOptions): string {
    if (o.pm.id !== 'pnpm' || !o.pm.version || !/^\d+\.\d+\.\d+$/.test(o.pm.version)) {
        return '';
    }
    // Script de Node en una sola línea (sin comillas dobles: el comando va entre comillas dobles).
    const script =
        "const fs=require('fs'),path=require('path');" +
        "const f=path.join(process.cwd(),process.argv[1],'package.json');" +
        'try{' +
        "const j=JSON.parse(fs.readFileSync(f,'utf8'));" +
        "if(/^pnpm@/.test(j.packageManager||'')){" +
        `j.packageManager='pnpm@${o.pm.version}';` +
        'fs.writeFileSync(f,JSON.stringify(j,null,2)+String.fromCharCode(10))}' +
        '}catch(e){}';
    return ` && node -e "${script}" "${o.folder}"`;
}
