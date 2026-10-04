/**
 * scaffold/docker.ts
 * ──────────────────
 * Ficheros de Docker:
 *  - docker-compose.yml para levantar la base de datos con un solo comando.
 *  - Dockerfiles para empaquetar el backend y desplegarlo en cualquier sitio.
 */
import * as path from 'path';
import { credentials, Database } from './database';
import { snakeCase, write } from './files';

/** Bloque de servicio de docker-compose para cada base de datos con servidor. */
function composeService(db: Database, name: string): string | undefined {
    const n = snakeCase(name);
    switch (db) {
        case 'PostgreSQL':
            return `
    image: postgres:17
    environment:
      POSTGRES_USER: ${credentials.PostgreSQL.user}
      POSTGRES_PASSWORD: ${credentials.PostgreSQL.password}
      POSTGRES_DB: ${n}
    ports:
      - "127.0.0.1:${credentials.PostgreSQL.port}:5432"
    volumes:
      - db-data:/var/lib/postgresql/data`;
        case 'MySQL':
            return `
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: ${credentials.MySQL.password}
      MYSQL_DATABASE: ${n}
    ports:
      - "127.0.0.1:${credentials.MySQL.port}:3306"
    volumes:
      - db-data:/var/lib/mysql`;
        case 'MongoDB':
            return `
    image: mongo:8
    ports:
      - "127.0.0.1:${credentials.MongoDB.port}:27017"
    volumes:
      - db-data:/data/db`;
        default:
            return undefined;
    }
}

/**
 * Escribe docker-compose.yml con el servidor de base de datos. SQLite no lo necesita.
 * @param dir carpeta raíz del proyecto
 * @param db base de datos
 * @param name nombre del proyecto
 */
export function writeDatabaseCompose(dir: string, db: Database, name: string): void {
    const service = composeService(db, name);
    if (!service) {
        return;
    }
    write(
        path.join(dir, 'docker-compose.yml'),
        `
# Start the database with:  docker compose up -d
# Stop it with:             docker compose down
# The database only listens on this computer (127.0.0.1) and uses a development password:
# never publish these ports or reuse this password in production.
services:
  db:${service}
    restart: unless-stopped

volumes:
  db-data:
`,
    );
}

/** Lo que Docker no debe copiar dentro de la imagen. */
const dockerignore = `
node_modules
.venv
__pycache__
dist
target
bin
obj
.git
.env
*.log
`;

/**
 * Dockerfile para una app Node (Express o NestJS).
 * @param opts `build`: compilar antes de arrancar; `start`: comando de arranque
 */
export function nodeDockerfile(opts: { build?: boolean; start: string }): string {
    return `
FROM node:22-alpine
WORKDIR /app
# Run as the unprivileged "node" user instead of root.
RUN chown node:node /app
USER node
COPY --chown=node:node package*.json ./
RUN npm install
COPY --chown=node:node . .
${opts.build ? 'RUN npm run build\n' : ''}ENV NODE_ENV=production
EXPOSE 3000
CMD ${JSON.stringify(opts.start.split(' '))}
`;
}

/**
 * Dockerfile para una app Python (FastAPI, Flask o Django).
 * @param opts puerto y comando de arranque
 */
export function pythonDockerfile(opts: { port: number; cmd: string[] }): string {
    return `
FROM python:3.13-slim
# Run as an unprivileged user instead of root.
RUN useradd --create-home app
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chown -R app:app /app
USER app
EXPOSE ${opts.port}
CMD ${JSON.stringify(opts.cmd)}
`;
}

/** Dockerfile en dos fases para Go: compila y copia solo el binario. */
export function goDockerfile(): string {
    return `
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY . .
RUN go build -o /server .

FROM alpine:3.21
COPY --from=build /server /server
USER nobody
EXPOSE 8080
CMD ["/server"]
`;
}

/**
 * Dockerfile en dos fases para Rust.
 * @param name nombre del binario (el del Cargo.toml)
 */
export function rustDockerfile(name: string): string {
    return `
FROM rust:1-slim AS build
WORKDIR /src
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=build /src/target/release/${name} /server
USER nobody
EXPOSE 3000
CMD ["/server"]
`;
}

/**
 * Escribe el Dockerfile y su .dockerignore.
 * @param dir carpeta del backend
 * @param content contenido del Dockerfile
 */
export function writeDockerfile(dir: string, content: string): void {
    write(path.join(dir, 'Dockerfile'), content);
    write(path.join(dir, '.dockerignore'), dockerignore);
}
