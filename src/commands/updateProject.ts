/**
 * commands/updateProject.ts
 * ──────────────────────────
 * Comando "Update Project Libraries": actualiza las librerías del proyecto abierto.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DevStarterTerminal } from '../terminal';
import { detectParts, kindNames, updateSteps, UpdateMode } from '../updater';
import { palette, style, symbols } from '../ui';

// ─── Actualizar el proyecto ─────────────────────────────────────────

/** Carpeta del proyecto a actualizar: la del espacio de trabajo o una elegida a mano. */
async function pickProjectFolder(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 1) {
        return folders[0].uri.fsPath;
    }
    if (folders.length > 1) {
        return (await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Which project do you want to update?' }))
            ?.uri.fsPath;
    }
    const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Update this project',
    });
    return picked?.[0]?.fsPath;
}

/** Comando "Update Project": actualiza las librerías de todas las partes del proyecto. */
export async function updateProject(): Promise<void> {
    // Instalar paquetes ejecuta los scripts de instalación del proyecto (y de sus dependencias):
    // en una carpeta no confiable (Restricted Mode) no se hace hasta que la persona la marque como segura.
    if (!vscode.workspace.isTrusted) {
        const choice = await vscode.window.showWarningMessage(
            'Updating libraries runs the install scripts of this project, so VS Code first needs you to trust this folder.',
            'Manage Workspace Trust',
        );
        if (choice) {
            await vscode.commands.executeCommand('workbench.trust.manage');
        }
        return;
    }
    const root = await pickProjectFolder();
    if (!root) {
        return;
    }
    const parts = detectParts(root);
    if (!parts.length) {
        vscode.window.showInformationMessage(
            'No project found here (looked for package.json, requirements.txt with .venv, composer.json, Cargo.toml, go.mod and pubspec.yaml).',
        );
        return;
    }
    const summary: string[] = [];
    for (const part of parts) {
        summary.push(
            `${part.label === '.' ? '' : part.label + ' · '}${kindNames[part.kind]}${part.pm ? ` (${part.pm})` : ''}`,
        );
    }
    const mode = await vscode.window.showQuickPick(
        [
            {
                label: '$(shield) Safe update',
                description: 'recommended',
                detail: 'Minor versions and bug fixes only. Your code keeps working.',
                value: 'safe' as UpdateMode,
            },
            {
                label: '$(rocket) Latest versions',
                description: 'may need code changes',
                detail: 'Also new major versions. They can include breaking changes.',
                value: 'latest' as UpdateMode,
            },
        ],
        { placeHolder: `Update ${path.basename(root)}: ${summary.join(', ')}` },
    );
    if (!mode) {
        return;
    }
    const isGit = fs.existsSync(path.join(root, '.git'));
    const optionItems: Array<vscode.QuickPickItem & { value: string }> = [];
    if (isGit) {
        optionItems.push({
            label: '$(git-commit) Save a Git checkpoint first',
            description: 'recommended',
            detail: 'So you can undo everything with one command if something breaks.',
            picked: true,
            value: 'checkpoint',
        });
    }
    optionItems.push({ label: '$(check) Check that it still builds afterwards', picked: true, value: 'verify' });
    const options = await vscode.window.showQuickPick(optionItems, {
        canPickMany: true,
        placeHolder: 'Options (Space to toggle, Enter to start)',
    });
    if (!options) {
        return;
    }
    const chosen = new Set<string>();
    for (const o of options) {
        chosen.add(o.value);
    }

    const beginner =
        vscode.workspace.getConfiguration('devstarter').get<string>('experienceLevel', 'beginner') !== 'experienced';
    const term = await DevStarterTerminal.create(`DevStarter · Update ${path.basename(root)}`, {
        verbose: false,
        beginner,
    });
    term.section(`Updating ${path.basename(root)} · ${mode.value === 'safe' ? 'safe update' : 'latest versions'}`);
    for (const line of summary) {
        term.result(palette.teal, line, [], symbols.logo);
    }
    term.line();
    const result = await term.runSteps(
        updateSteps(parts, {
            root,
            mode: mode.value,
            checkpoint: chosen.has('checkpoint'),
            verify: chosen.has('verify'),
        }),
    );
    term.line();
    if (result === 'success') {
        term.result(palette.green, style.bold('Your project is up to date.'));
        if (isGit) {
            term.line(style.gray(`  ${symbols.branch} Something broke? Undo every change with:  git restore .`));
        }
    } else {
        term.result(palette.rose, 'The update stopped. Scroll up to see what happened.', [], symbols.fail);
        if (isGit) {
            term.line(style.gray(`  ${symbols.branch} Undo the partial changes with:  git restore .`));
        }
    }
    term.finish();
}
