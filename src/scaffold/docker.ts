/**
 * scaffold/docker.ts
 * ──────────────────
 * Docker files:
 *  - docker-compose.yml to start the database with a single command.
 *  - Dockerfiles to package the backend and deploy it anywhere.
 */
import * as path from 'path';
import { credentials, Database } from './database';
import { snakeCase, write } from './files';

/** docker-compose service block for each database that needs a server. */
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
 * Writes docker-compose.yml with the database server. SQLite does not need it.
 * @param dir project root folder
 * @param db database
 * @param name project name
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

/** What Docker must not copy into the image. */
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
 * Dockerfile for a Node app (Express or NestJS).
 * @param opts `build`: compile before starting; `start`: start command
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
 * Dockerfile for a Python app (FastAPI, Flask or Django).
 * @param opts port and start command
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

/** Two-stage Dockerfile for Go: compiles and copies only the binary. */
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
 * Two-stage Dockerfile for Rust.
 * @param name binary name (the one in Cargo.toml)
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
 * Writes the Dockerfile and its .dockerignore.
 * @param dir backend folder
 * @param content contents of the Dockerfile
 */
export function writeDockerfile(dir: string, content: string): void {
    write(path.join(dir, 'Dockerfile'), content);
    write(path.join(dir, '.dockerignore'), dockerignore);
}
