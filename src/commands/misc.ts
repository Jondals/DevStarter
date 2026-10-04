/**
 * commands/misc.ts
 * ─────────────────
 * Comandos pequeños: bienvenida, nivel de experiencia, guía del proyecto y ayuda.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { showLog } from '../log';
import { WELCOMED_KEY, extensionId } from '../state';

/**
 * Mensaje de bienvenida solo la primera vez que se instala.
 * @param context contexto de la extensión
 */
export async function greetOnce(context: vscode.ExtensionContext): Promise<void> {
    if (context.globalState.get(WELCOMED_KEY)) {
        return;
    }
    await context.globalState.update(WELCOMED_KEY, true);
    const choice = await vscode.window.showInformationMessage(
        '✨ DevStarter is ready! It creates a project for you in a few clicks, even if you have never programmed.',
        'Create a project',
        'Take the tour',
        'Check my tools',
    );
    if (choice === 'Create a project') {
        void vscode.commands.executeCommand('devstarter.newProject');
    } else if (choice === 'Take the tour') {
        void vscode.commands.executeCommand(
            'workbench.action.openWalkthrough',
            `${extensionId()}#devstarter.welcome`,
            false,
        );
    } else if (choice === 'Check my tools') {
        void vscode.commands.executeCommand('devstarter.checkTools');
    }
}

/** Comando "Change Experience Level". */
export async function changeExperience(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
        [
            { label: '$(heart) Beginner', description: 'more explanations and guides', value: 'beginner' },
            { label: '$(zap) Experienced', description: 'compact, shows commands', value: 'experienced' },
        ],
        { placeHolder: 'How should DevStarter talk to you?' },
    );
    if (picked) {
        await vscode.workspace
            .getConfiguration('devstarter')
            .update('experienceLevel', picked.value, vscode.ConfigurationTarget.Global);
    }
}

/** Comando "Open Getting Started Guide". */
export async function openGuide(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const guide = folder ? path.join(folder, 'GETTING_STARTED.md') : undefined;
    if (guide && fs.existsSync(guide)) {
        await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(guide));
        return;
    }
    const choice = await vscode.window.showInformationMessage(
        'No GETTING_STARTED.md in this workspace. Create a project with DevStarter first!',
        'New Project',
    );
    if (choice) {
        void vscode.commands.executeCommand('devstarter.newProject');
    }
}

// ─── Ayuda ──────────────────────────────────────────────────────────

/** Comando "Help": un menú con lo que suele hacer falta cuando algo no sale. */
export async function showHelp(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
        [
            {
                label: '$(sparkle) Create a new project',
                detail: 'Start from an idea or pick a technology',
                value: 'new',
            },
            {
                label: '$(tools) Check & update my tools',
                detail: 'See what is installed (Node.js, Python, Git…) and fix what is missing',
                value: 'tools',
            },
            { label: '$(book) Take the tour', detail: 'A short walkthrough of what DevStarter can do', value: 'tour' },
            {
                label: '$(cloud-download) Update my project libraries',
                detail: 'Keep the open project up to date',
                value: 'update',
            },
            {
                label: '$(output) Show the DevStarter log',
                detail: 'Technical details, useful if something goes wrong',
                value: 'log',
            },
            { label: '$(gear) Settings', detail: 'Change how DevStarter works', value: 'settings' },
        ],
        { placeHolder: 'How can DevStarter help?' },
    );
    switch (picked?.value) {
        case 'new':
            return void (await vscode.commands.executeCommand('devstarter.newProject'));
        case 'tools':
            return void (await vscode.commands.executeCommand('devstarter.checkTools'));
        case 'tour':
            return void (await vscode.commands.executeCommand(
                'workbench.action.openWalkthrough',
                `${extensionId()}#devstarter.welcome`,
                false,
            ));
        case 'update':
            return void (await vscode.commands.executeCommand('devstarter.updateProject'));
        case 'log':
            return showLog();
        case 'settings':
            return void (await vscode.commands.executeCommand(
                'workbench.action.openSettings',
                `@ext:${extensionId()}`,
            ));
    }
}
