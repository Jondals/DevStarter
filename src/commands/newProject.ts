/**
 * commands/newProject.ts
 * ───────────────────────
 * "New Project" command: wizard (visual or quick) → terminal → tools → steps → open the project.
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
import { WizardContext } from '../wizardModel';
import { openWizardPanel, PanelResult } from '../webview/wizardPanel';
import { PendingLaunch } from '../state';
import { checkProjectTools, planInstalls, recoverFromFailure } from './install';
import { afterCreate } from './launch';
import { rememberProject } from './recent';

/** Prevents creating two projects at the same time. */
let running = false;

// ─── Creating a project ─────────────────────────────────────────────

/**
 * "New Project" command.
 * @param context extension context
 * @param templateId template chosen beforehand (from the walkthrough)
 */
export async function newProject(context: vscode.ExtensionContext, templateId?: string): Promise<void> {
    if (running) {
        vscode.window.showWarningMessage(
            'DevStarter is already creating a project. Wait for it to finish (or cancel it with Ctrl+C in its terminal).',
        );
        return;
    }
    // * Start detecting tools right away so the wizard does not have to wait for them.
    clearToolCache();
    await refreshPath();
    const wizardContext: WizardContext = {
        globalState: context.globalState,
        packageManagers: detectPackageManagers(),
        git: detectTool('git'),
        gh: detectTool('gh'),
        preselect: typeof templateId === 'string' ? templateId : undefined,
    };
    const wizardStyle = vscode.workspace.getConfiguration('devstarter').get<string>('wizardStyle', 'visual');
    let result: PanelResult =
        wizardStyle === 'quick' ? 'quick' : await openWizardPanel(context.extensionUri, wizardContext);
    if (result === 'quick') {
        result = await runWizard(wizardContext);
    }
    const choice = result;
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
 * The whole creation process once the wizard has finished.
 * @param context extension context
 * @param choice the wizard's choice
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
    // * If a step fails because a newer Node.js is needed, try to fix it.
    term.setRecovery(recoverFromFailure);

    // ── Welcome
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

    // ── Tools
    term.section('Checking your tools');
    const { missing, python } = await checkProjectTools(term, choice);
    const installSteps = await planInstalls(term, missing);
    if (!installSteps) {
        term.finish();
        return;
    }

    // ── Project steps
    // ? If Python is being installed right now we do not know its command yet: use the usual one.
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
            // * "Retry": the folder is already deleted; start again with the same choice.
            return createProject(context, choice);
        }
        return;
    }

    // ── Done
    const mainFile = findExisting(root, project.mainFiles);
    await showSummary(term, choice, project, mainFile, started);
    term.finish();
    await rememberProject(context, { name: choice.name, root, stack: describe(choice), createdAt: Date.now() });

    const servers: PendingLaunch['servers'] = [];
    for (const s of project.servers) {
        servers.push({ label: s.label, cwd: path.join(root, s.folder), command: s.command, url: s.url });
    }
    // ! No await: the notification may stay open and must not block another project.
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
 * First file of the list that exists in `root`.
 * @param root project folder
 * @param files relative paths
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
 * Final screen: animation and a box with the next steps.
 * @param term terminal
 * @param choice the wizard's choice
 * @param project built plan
 * @param mainFile main file (if it exists)
 * @param started when everything started
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
    // * If a library created demo pages, link to their index.
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
 * After a failure or cancellation, offers to retry or to delete the half-created folder.
 * @param dir project folder
 * @param cancelled it was cancelled (instead of failing)
 * @returns true if we must retry (the folder is already deleted)
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
