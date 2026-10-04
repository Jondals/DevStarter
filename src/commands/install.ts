/**
 * commands/install.ts
 * ────────────────────
 * Herramientas que hacen falta para un proyecto: comprobarlas, ofrecer instalarlas (con permiso
 * y diciendo de dónde viene lo que se ejecuta) y arreglar el caso "este framework pide un
 * Node.js más nuevo" (actualizar Node.js o usar una versión compatible).
 */
import * as vscode from 'vscode';
import * as os from 'os';
import { CommandStep, DevStarterTerminal, Logger, Recovery, Step } from '../terminal';
import { ProjectChoice, requiredTools, usesNode } from '../project';
import {
    clearToolCache,
    compareVersions,
    detectPackageManagers,
    detectTool,
    Installer,
    installerFor,
    installSource,
    minNodeVersion,
    packageManagerInstaller,
    refreshPath,
    ToolId,
    updaterFor,
} from '../tools';
import { isNewer, isNodeEngineError, latestCompatibleVersion, requiredNodeFromOutput } from '../updates';
import { palette, style, symbols } from '../ui';
import { syncTerminalPath } from '../state';

/** Herramienta que falta (o es demasiado antigua) y cómo instalarla, si se puede. */
export interface Missing {
    name: string;
    installUrl: string;
    installer?: Installer;
    /** Vuelve a comprobar la herramienta tras instalarla. */
    verify: () => Promise<boolean>;
}

/**
 * Crea una función que vuelve a detectar una herramienta (sin caché).
 * @param id herramienta
 */
export function recheckTool(id: ToolId): () => Promise<boolean> {
    return async function (): Promise<boolean> {
        clearToolCache();
        return !!(await detectTool(id)).version;
    };
}

/**
 * Crea una función que vuelve a detectar un gestor de paquetes (sin caché).
 * @param id npm, pnpm o bun
 */
export function recheckPackageManager(id: string): () => Promise<boolean> {
    return async function (): Promise<boolean> {
        clearToolCache();
        for (const p of await detectPackageManagers()) {
            if (p.id === id && p.version) {
                return true;
            }
        }
        return false;
    };
}

/**
 * Comprueba las herramientas que necesita el proyecto y las escribe en el terminal.
 * @returns lo que falta y el comando de Python detectado
 */
export async function checkProjectTools(
    term: DevStarterTerminal,
    choice: ProjectChoice,
): Promise<{ missing: Missing[]; python?: string }> {
    const tools = await Promise.all(requiredTools(choice).map(detectToolById));
    const missing: Missing[] = [];
    let python: string | undefined;
    for (const tool of tools) {
        if (tool.id === 'python') {
            python = tool.command;
        }
        if (!tool.version) {
            const installer = await installerFor(tool.id);
            missing.push({ name: tool.name, installUrl: tool.installUrl, installer, verify: recheckTool(tool.id) });
            const note = installer ? 'not found · can be installed automatically' : 'not found';
            term.result(
                installer ? palette.amber : palette.rose,
                `${tool.name} ${style.gray(note)}`,
                [],
                installer ? symbols.warn : symbols.fail,
            );
        } else if (tool.id === 'node' && compareVersions(tool.version, minNodeVersion) < 0) {
            missing.push({
                name: `${tool.name} ${minNodeVersion}+`,
                installUrl: tool.installUrl,
                verify: recheckTool('node'),
            });
            term.result(
                palette.rose,
                `${tool.name} ${tool.version} ${style.gray(`is too old, ${minNodeVersion}+ needed`)}`,
                [],
                symbols.fail,
            );
        } else {
            term.result(palette.green, `${tool.name} ${style.gray('v' + tool.version)}`);
        }
    }
    if (usesNode(choice)) {
        const pm = choice.pm;
        if (pm.version) {
            term.result(palette.green, `${pm.id} ${style.gray('v' + pm.version)}`);
        } else if (pm.id !== 'npm') {
            missing.push({
                name: pm.id,
                installUrl: pm.id === 'pnpm' ? 'https://pnpm.io/installation' : 'https://bun.sh',
                installer: packageManagerInstaller(pm.id),
                verify: recheckPackageManager(pm.id),
            });
            term.result(
                palette.amber,
                `${pm.id} ${style.gray('not found · can be installed automatically')}`,
                [],
                symbols.warn,
            );
        }
    }
    return { missing, python };
}

/** Detecta una herramienta (función con nombre para usar con `map`). */
function detectToolById(id: ToolId): ReturnType<typeof detectTool> {
    return detectTool(id);
}

/**
 * Si faltan herramientas: las que se pueden instalar solas se ofrecen en un diálogo;
 * si alguna no se puede, se explica cómo hacerlo.
 * @returns los pasos de instalación, o undefined si no se puede continuar
 */
export async function planInstalls(term: DevStarterTerminal, missing: Missing[]): Promise<Step[] | undefined> {
    if (!missing.length) {
        return [];
    }
    const manual = missing.filter(hasNoInstaller);
    if (manual.length) {
        term.line();
        for (const m of manual) {
            term.line(
                `  ${style.amber('💡')} Install ${style.bold(m.name)} from ${style.underline(style.teal(m.installUrl))}`,
            );
        }
        term.line(style.gray('     Then restart VS Code and run DevStarter again.'));
        const names: string[] = [];
        const buttons: string[] = [];
        for (const m of manual) {
            names.push(m.name);
            buttons.push(`Download ${m.name}`);
        }
        const picked = await vscode.window.showErrorMessage(
            `This project needs ${names.join(' and ')}. Install it and try again.`,
            ...buttons,
        );
        for (const m of manual) {
            if (`Download ${m.name}` === picked) {
                void vscode.env.openExternal(vscode.Uri.parse(m.installUrl));
            }
        }
        return undefined;
    }

    const names: string[] = [];
    for (const m of missing) {
        names.push(m.name);
    }
    const sources: string[] = [];
    for (const m of missing) {
        sources.push(`• ${m.name}: ${installSource(m.installer!)}`);
    }
    const answer = await vscode.window.showInformationMessage(
        `DevStarter needs to install ${names.join(', ')}. Install now?`,
        {
            modal: true,
            detail: `It will use:\n${sources.join('\n')}\n\nIt may take a few minutes. Windows can ask for permission: click "Yes" when it does.`,
        },
        'Install',
    );
    if (answer !== 'Install') {
        term.line();
        term.result(palette.amber, 'Installation declined. Nothing was changed.', [], symbols.warn);
        return undefined;
    }
    return installSteps(missing);
}

/** ¿Hay que instalar esta herramienta a mano? */
function hasNoInstaller(m: Missing): boolean {
    return !m.installer;
}

/**
 * Pasos que instalan las herramientas y comprueban que han quedado disponibles.
 * PHP y Composer vienen del mismo instalador: no se ejecuta dos veces.
 * @param missing herramientas a instalar (todas con instalador)
 */
export function installSteps(missing: Missing[]): Step[] {
    const steps: Step[] = [];
    const seen = new Set<string>();
    for (const m of missing) {
        const installer = m.installer!;
        if (seen.has(installer.command)) {
            continue;
        }
        seen.add(installer.command);
        steps.push(
            { kind: 'command', title: installer.title, command: installer.command, cwd: os.homedir() },
            verifyStep(m),
        );
    }
    return steps;
}

/**
 * Paso que actualiza el PATH y comprueba que la herramienta ya funciona.
 * @param m herramienta instalada
 */
function verifyStep(m: Missing): Step {
    return {
        kind: 'task',
        title: `Checking ${m.name}`,
        async run(log: Logger) {
            await refreshPath(true);
            syncTerminalPath();
            if (!(await m.verify())) {
                throw new Error(
                    `${m.name} was installed, but VS Code can't see it yet. Restart VS Code and run DevStarter again.`,
                );
            }
            log(`${m.name} is ready`);
        },
    };
}

// ─── Arreglar fallos ────────────────────────────────────────────────

/**
 * Si un paso falla porque el framework pide un Node.js más nuevo, pregunta qué hacer:
 * actualizar Node.js, o usar la versión más nueva del framework que funciona con el Node actual.
 * Después el terminal reintenta el paso.
 * @param step paso que ha fallado
 * @param output salida del paso
 * @returns el plan de arreglo, o undefined si no sabemos arreglarlo
 */
export async function recoverFromFailure(step: Step, output: string): Promise<Recovery | undefined> {
    if (!isNodeEngineError(output)) {
        return undefined;
    }
    clearToolCache();
    const node = await detectTool('node');
    const compat = step.kind === 'command' ? step.compat : undefined;
    const [updater, compatible] = await Promise.all([
        updaterFor('node'),
        compat && node.version ? latestCompatibleVersion(compat.package, node.version) : Promise.resolve(undefined),
    ]);
    const updateLabel = 'Update Node.js and retry';
    const compatLabel = compat && compatible ? `Use ${compat.package} ${compatible} and retry` : undefined;
    const buttons: string[] = [];
    if (updater) {
        buttons.push(updateLabel);
    }
    if (compatLabel) {
        buttons.push(compatLabel);
    }
    if (!buttons.length) {
        return undefined;
    }
    const required = requiredNodeFromOutput(output);
    const answer = await vscode.window.showWarningMessage(
        `This step needs a newer Node.js${required ? ` (${required})` : ''}. You have ${node.version ?? 'an older one'}.`,
        {
            modal: true,
            detail:
                'Updating Node.js is recommended: every tool will keep working.' +
                (compatLabel ? ' Or keep your Node.js and use the newest version of the tool that supports it.' : ''),
        },
        ...buttons,
    );
    if (answer === updateLabel && updater) {
        return {
            message: 'Updating Node.js, then trying again',
            before: [
                { kind: 'command', title: updater.title, command: updater.command, cwd: os.homedir() },
                nodeUpdatedStep(node.version),
            ],
            retry: step,
        };
    }
    if (compatLabel && answer === compatLabel && compat && compatible) {
        const retry: CommandStep = {
            ...(step as CommandStep),
            title: `${step.title} · ${compat.package} ${compatible}`,
            command: compat.command(compatible),
        };
        return { message: `Trying again with ${compat.package} ${compatible}`, before: [], retry };
    }
    return undefined;
}

/**
 * Paso que comprueba que Node.js se ha actualizado de verdad.
 * @param before versión que había antes
 */
function nodeUpdatedStep(before: string | undefined): Step {
    return {
        kind: 'task',
        title: 'Checking the new Node.js',
        async run(log: Logger) {
            await refreshPath(true);
            clearToolCache();
            const now = (await detectTool('node')).version;
            if (!now || !isNewer(before, now)) {
                throw new Error(
                    'Node.js could not be updated automatically. Install the latest LTS from https://nodejs.org, restart VS Code and try again.',
                );
            }
            log(`Node.js ${before} → ${now}`);
        },
    };
}
