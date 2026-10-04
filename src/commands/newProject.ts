/**
 * commands/newProject.ts
 * ───────────────────────
 * Comando "New Project": asistente → terminal → herramientas → pasos → abrir el proyecto.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DevStarterTerminal } from '../terminal';
import { buildProject, BuiltProject, describe, plainSummary, ProjectChoice } from '../project';
import { clearToolCache, detectPackageManagers, detectTool, refreshPath } from '../tools';
import { background, reportError } from '../log';
import { box, palette, style, symbols } from '../ui';
import { runWizard } from '../wizard';
import { PendingLaunch } from '../state';
import { checkProjectTools, planInstalls, recoverFromFailure } from './install';
import { afterCreate } from './launch';
import { rememberProject } from './recent';

/** Evita crear dos proyectos a la vez. */
let running = false;

// ─── Crear un proyecto ──────────────────────────────────────────────

/**
 * Comando "New Project".
 * @param context contexto de la extensión
 * @param templateId plantilla elegida de antemano (desde el walkthrough)
 */
export async function newProject(context: vscode.ExtensionContext, templateId?: string): Promise<void> {
    if (running) {
        vscode.window.showWarningMessage(
            'DevStarter is already creating a project. Wait for it to finish (or cancel it with Ctrl+C in its terminal).',
        );
        return;
    }
    // Empezamos a detectar herramientas ya, para que el asistente no tenga que esperar.
    clearToolCache();
    await refreshPath();
    const choice = await runWizard({
        globalState: context.globalState,
        packageManagers: detectPackageManagers(),
        git: detectTool('git'),
        gh: detectTool('gh'),
        preselect: typeof templateId === 'string' ? templateId : undefined,
    });
    if (!choice) {
        return;
    }
    running = true;
    try {
        await createProject(context, choice);
    } catch (err) {
        await reportError('creating the project', err);
    } finally {
        running = false;
    }
}

/**
 * Todo el proceso de creación una vez terminado el asistente.
 * @param context contexto de la extensión
 * @param choice elección del asistente
 */
async function createProject(context: vscode.ExtensionContext, choice: ProjectChoice): Promise<void> {
    const config = vscode.workspace.getConfiguration('devstarter');
    const version: string = context.extension.packageJSON.version;
    const root = path.join(choice.parentDir, choice.name);
    const term = await DevStarterTerminal.create(`DevStarter · ${choice.name}`, {
        verbose: config.get('showLiveLogs', false),
        beginner: choice.beginner,
    });
    const started = Date.now();
    // Si un paso falla porque hace falta un Node.js más nuevo, intentamos arreglarlo.
    term.setRecovery(recoverFromFailure);

    // ── Bienvenida
    await term.banner();
    term.lines(
        box(
            [
                `${style.teal(symbols.logo)} ${style.bold('DevStarter')}  ${style.gray('v' + version)}`,
                '',
                `${style.gray('Project ')}  ${style.bold(choice.name)}`,
                `${style.gray('Stack   ')}  ${describe(choice)}`,
                ...(choice.beginner ? [`${style.gray('In short')}  ${plainSummary(choice)}`] : []),
                `${style.gray('Folder  ')}  ${root}`,
            ],
            { minWidth: 44 },
        ),
    );
    await term.typewriter(choice.beginner ? "Sit back. I'll take care of everything." : 'Scaffolding your project…');

    // ── Herramientas
    term.section('Checking your tools');
    const { missing, python } = await checkProjectTools(term, choice);
    const installSteps = await planInstalls(term, missing);
    if (!installSteps) {
        term.finish();
        return;
    }

    // ── Pasos del proyecto
    // Si Python se va a instalar ahora, aún no sabemos su comando: usamos el habitual.
    const project = buildProject(choice, python ?? (process.platform === 'win32' ? 'python' : 'python3'));
    term.section(installSteps.length ? 'Installing tools and creating your project' : 'Creating your project');
    const result = await term.runSteps([...installSteps, ...project.steps]);

    if (result !== 'success') {
        term.line();
        if (result === 'cancelled') {
            term.result(palette.amber, 'Cancelled.', [], symbols.warn);
        } else {
            term.result(palette.rose, 'Setup failed. Scroll up to see what happened.', [], symbols.fail);
        }
        term.finish();
        if (await offerCleanup(root, result === 'cancelled')) {
            // "Retry": la carpeta ya está borrada; empezamos de nuevo con la misma elección.
            return createProject(context, choice);
        }
        return;
    }

    // ── Final
    const mainFile = findExisting(root, project.mainFiles);
    await showSummary(term, choice, project, mainFile, started);
    term.finish();
    await rememberProject(context, { name: choice.name, root, stack: describe(choice), createdAt: Date.now() });

    const servers: PendingLaunch['servers'] = [];
    for (const s of project.servers) {
        servers.push({ label: s.label, cwd: path.join(root, s.folder), command: s.command, url: s.url });
    }
    // Sin await: la notificación puede quedarse abierta y no debe bloquear otro proyecto.
    background(
        'opening the new project',
        afterCreate(
            context,
            { root, servers, mainFile, openGuide: choice.beginner, createdAt: Date.now() },
            choice.name,
        ),
    );
}

/**
 * Primer fichero de la lista que exista en `root`.
 * @param root carpeta del proyecto
 * @param files rutas relativas
 */
function findExisting(root: string, files: string[]): string | undefined {
    for (const f of files) {
        if (fs.existsSync(path.join(root, f))) {
            return f;
        }
    }
    return undefined;
}

/**
 * Pantalla final: animación y caja con los siguientes pasos.
 * @param term terminal
 * @param choice elección del asistente
 * @param project plan construido
 * @param mainFile fichero principal (si existe)
 * @param started momento en que empezó todo
 */
async function showSummary(
    term: DevStarterTerminal,
    choice: ProjectChoice,
    project: BuiltProject,
    mainFile: string | undefined,
    started: number,
): Promise<void> {
    const elapsed = Math.round((Date.now() - started) / 1000);
    const time = elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`;
    term.line();
    await term.shimmerLine(`${symbols.logo} ${choice.name} is ready! (${time})`);
    term.line();

    const arrow = style.fuchsia(symbols.arrow);
    const lines: string[] = [style.gray('Start coding:'), ''];
    if (project.devAll) {
        lines.push(
            `${arrow} ${style.teal(`cd ${choice.name}`)}`,
            `${arrow} ${style.teal(project.devAll)}   ${style.gray('starts everything')}`,
        );
    } else {
        for (const s of project.servers) {
            lines.push(
                `${arrow} ${style.teal(`cd ${path.join(choice.name, s.folder)}`)}`,
                `${arrow} ${style.teal(s.command)}`,
            );
        }
    }
    const urls: string[] = [];
    for (const s of project.servers) {
        if (s.url) {
            urls.push(`${style.gray(s.label.padEnd(10))} ${style.underline(s.url)}`);
        }
    }
    if (urls.length) {
        lines.push('', ...urls);
    }
    if (mainFile) {
        lines.push('', `${style.gray('Edit')} ${mainFile} ${style.gray('to make it yours')}`);
    }
    // Si alguna librería creó páginas de demo, enlazamos al índice.
    const front = project.servers[0];
    if (front?.url && fs.existsSync(path.join(project.root, front.folder, 'demos', 'index.html'))) {
        lines.push(`${style.gray('Demos')} ${style.underline(`${front.url}/demos/`)}`);
    }
    if (choice.beginner) {
        lines.push('', style.gray('New to this? Read GETTING_STARTED.md in your project.'));
    }
    term.lines(box(lines, { color: palette.green, title: style.green('Next steps') }));
}

/**
 * Tras un fallo o cancelación, ofrece reintentar o borrar la carpeta a medio crear.
 * @param dir carpeta del proyecto
 * @param cancelled se canceló (en vez de fallar)
 * @returns true si hay que reintentar (la carpeta ya está borrada)
 */
async function offerCleanup(dir: string, cancelled: boolean): Promise<boolean> {
    const exists = fs.existsSync(dir);
    const message = cancelled
        ? 'Project creation was cancelled.'
        : 'Project setup failed. Check the DevStarter terminal for details.';
    const actions = ['Retry'];
    if (exists) {
        actions.push('Delete partial folder');
    }
    const picked = cancelled
        ? await vscode.window.showWarningMessage(message, ...actions)
        : await vscode.window.showErrorMessage(message, ...actions);
    if (!picked) {
        return false;
    }
    if (exists) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
        } catch (err) {
            vscode.window.showErrorMessage(`Could not delete ${dir}: ${err instanceof Error ? err.message : err}`);
            return false;
        }
    }
    if (picked === 'Retry') {
        return true;
    }
    vscode.window.showInformationMessage(`Deleted ${dir}`);
    return false;
}
