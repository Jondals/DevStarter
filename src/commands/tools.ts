/**
 * commands/tools.ts
 * ──────────────────
 * Comando "Check & Update My Tools": qué hay instalado, qué falta y qué se puede actualizar.
 */
import * as vscode from 'vscode';
import { DevStarterTerminal, Logger, Step } from '../terminal';
import {
    clearToolCache,
    detectAllTools,
    detectPackageManagers,
    detectTool,
    installerFor,
    PackageManager,
    PackageManagerId,
    packageManagerInstaller,
    packageManagerUpdater,
    refreshPath,
    ToolId,
    updaterFor,
} from '../tools';
import { isNewer, latestNodeLts, latestNpmVersion } from '../updates';
import { installNodeFromOfficialMsi, toolUpdateStep, UpdateTarget } from '../toolupdate';
import { palette, style, symbols } from '../ui';
import { Missing, recheckTool, recheckPackageManager, installSteps } from './install';

// ─── Revisar y actualizar herramientas ──────────────────────────────

/** Una opción de la lista de "Check & Update My Tools". */
type ToolAction = vscode.QuickPickItem & { steps: Step[] };

/**
 * Pasos para actualizar una herramienta. Comprueban después que la versión cambió de verdad
 * y, si no, lo explican (ver toolupdate.ts). Son opcionales: si uno falla, siguen los demás.
 * @param target qué actualizar y cómo
 */
function updateStepsFor(target: UpdateTarget): Step[] {
    return [toolUpdateStep(target)];
}

/**
 * Función que lee la versión instalada de una herramienta (sin caché).
 * @param id herramienta
 */
function toolVersionReader(id: ToolId): () => Promise<string | undefined> {
    return async function (): Promise<string | undefined> {
        return (await detectTool(id)).version;
    };
}

/**
 * Función que lee la versión instalada de npm, pnpm o bun (sin caché).
 * @param id gestor de paquetes
 */
function pmVersionReader(id: PackageManagerId): () => Promise<string | undefined> {
    return async function (): Promise<string | undefined> {
        for (const pm of await detectPackageManagers()) {
            if (pm.id === id) {
                return pm.version;
            }
        }
        return undefined;
    };
}

/**
 * Segunda vía para Node.js cuando winget no tiene la última versión: el instalador oficial.
 * @param latest última versión de Node.js LTS
 */
function nodeFallback(latest: string | undefined): (log: Logger) => Promise<boolean> {
    return async function (log: Logger): Promise<boolean> {
        return latest ? installNodeFromOfficialMsi(latest, log) : false;
    };
}

/** Comando "Check & Update My Tools": qué hay instalado, qué falta y qué se puede actualizar. */
export async function checkTools(): Promise<void> {
    clearToolCache();
    await refreshPath();
    const term = await DevStarterTerminal.create('DevStarter · Tools', { verbose: false, beginner: true });
    term.section('Your development tools');
    term.line(style.gray('  Checking installed versions and the latest releases…'));
    term.line();
    const [tools, pms, nodeLts, npmLatest, pnpmLatest, bunLatest] = await Promise.all([
        detectAllTools(),
        detectPackageManagers(),
        latestNodeLts(),
        latestNpmVersion('npm'),
        latestNpmVersion('pnpm'),
        latestNpmVersion('bun'),
    ]);
    const latest: Record<string, string | undefined> = {
        node: nodeLts,
        npm: npmLatest,
        pnpm: pnpmLatest,
        bun: bunLatest,
    };

    const actions: ToolAction[] = [];
    for (const tool of tools) {
        if (!tool.version) {
            const installer = await installerFor(tool.id);
            term.result(palette.dim, `${tool.name.padEnd(12)} ${style.gray('not installed')}`, [], symbols.warn);
            if (installer) {
                const missing: Missing = {
                    name: tool.name,
                    installUrl: tool.installUrl,
                    installer,
                    verify: recheckTool(tool.id),
                };
                actions.push({
                    label: `$(add) Install ${tool.name}`,
                    description: 'not installed',
                    steps: installSteps([missing]),
                });
            }
            continue;
        }
        const newer = isNewer(tool.version, latest[tool.id]);
        const note = newer ? style.amber(`  → v${latest[tool.id]} available`) : '';
        term.result(
            newer ? palette.amber : palette.green,
            `${tool.name.padEnd(12)} ${style.gray('v' + tool.version)}${note}`,
        );
        const updater = await updaterFor(tool.id, tool.version);
        if (updater) {
            actions.push({
                label: `$(arrow-up) Update ${tool.name}`,
                description: newer
                    ? `v${tool.version} → v${latest[tool.id]}`
                    : `v${tool.version} · check for a newer version`,
                picked: newer,
                steps: updateStepsFor({
                    name: tool.name,
                    current: tool.version,
                    latest: latest[tool.id],
                    installer: updater,
                    detect: toolVersionReader(tool.id),
                    fallback: tool.id === 'node' ? nodeFallback(latest.node) : undefined,
                }),
            });
        }
    }
    addPackageManagerLines(term, pms, latest, actions);

    if (!actions.length) {
        term.line();
        term.result(palette.teal, 'Nothing to install or update from here. You are all set!');
        term.finish();
        return;
    }
    const picked = await vscode.window.showQuickPick(actions, {
        canPickMany: true,
        placeHolder: 'Select what to install or update (updates with a new version are pre-selected · Esc to skip)',
    });
    if (!picked?.length) {
        term.finish();
        return;
    }
    const steps: Step[] = [];
    for (const p of picked) {
        steps.push(...p.steps);
    }
    steps.push({
        kind: 'task',
        title: 'Checking the new versions',
        async run(log: Logger) {
            await refreshPath();
            clearToolCache();
            const versions: string[] = [];
            for (const tool of await detectAllTools()) {
                if (tool.version) {
                    versions.push(`${tool.name} ${tool.version}`);
                }
            }
            for (const pm of await detectPackageManagers()) {
                if (pm.version) {
                    versions.push(`${pm.id} ${pm.version}`);
                }
            }
            log(versions.join(' · '));
        },
    });
    term.section('Installing and updating');
    await term.runSteps(steps);
    term.finish();
}

/**
 * Escribe el estado de npm/pnpm/bun y añade a la lista las instalaciones y actualizaciones posibles.
 * @param term terminal
 * @param pms gestores detectados
 * @param latest última versión conocida de cada uno
 * @param actions lista donde añadir las opciones
 */
function addPackageManagerLines(
    term: DevStarterTerminal,
    pms: PackageManager[],
    latest: Record<string, string | undefined>,
    actions: ToolAction[],
): void {
    let hasNpm = false;
    for (const pm of pms) {
        if (pm.id === 'npm' && pm.version) {
            hasNpm = true;
        }
    }
    for (const pm of pms) {
        if (pm.version) {
            const newer = isNewer(pm.version, latest[pm.id]);
            const note = newer ? style.amber(`  → v${latest[pm.id]} available`) : '';
            term.result(
                newer ? palette.amber : palette.green,
                `${pm.id.padEnd(12)} ${style.gray('v' + pm.version)}${note}`,
            );
            actions.push({
                label: `$(arrow-up) Update ${pm.id}`,
                description: newer ? `v${pm.version} → v${latest[pm.id]}` : `v${pm.version} · already the latest`,
                picked: newer,
                steps: updateStepsFor({
                    name: pm.id,
                    current: pm.version,
                    latest: latest[pm.id],
                    installer: packageManagerUpdater(pm.id),
                    detect: pmVersionReader(pm.id),
                    hint: pm.id === 'npm' ? 'npm comes with Node.js: updating Node.js also updates npm.' : undefined,
                }),
            });
            continue;
        }
        term.result(
            palette.dim,
            `${pm.id.padEnd(12)} ${style.gray(pm.id === 'npm' ? 'comes with Node.js' : 'not installed')}`,
            [],
            symbols.warn,
        );
        const installer = packageManagerInstaller(pm.id);
        // pnpm en Windows se instala con npm, así que hace falta Node.
        if (installer && (hasNpm || pm.id === 'bun' || process.platform !== 'win32')) {
            const missing: Missing = {
                name: pm.id,
                installUrl: pm.id === 'pnpm' ? 'https://pnpm.io/installation' : 'https://bun.sh',
                installer,
                verify: recheckPackageManager(pm.id),
            };
            actions.push({
                label: `$(add) Install ${pm.id}`,
                description: 'not installed',
                steps: installSteps([missing]),
            });
        }
    }
}
