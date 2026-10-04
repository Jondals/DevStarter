/**
 * commands/recent.ts
 * ───────────────────
 * Proyectos recientes: guarda los proyectos creados y permite volver a abrirlos.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { RecentProject, RECENT_KEY } from '../state';

// ─── Proyectos recientes ────────────────────────────────────────────

/**
 * Guarda el proyecto en la lista de recientes (máximo 20).
 * @param context contexto de la extensión
 * @param project proyecto creado
 */
export async function rememberProject(context: vscode.ExtensionContext, project: RecentProject): Promise<void> {
    const list = context.globalState.get<RecentProject[]>(RECENT_KEY, []);
    const updated = [project];
    for (const p of list) {
        if (p.root !== project.root && updated.length < 20) {
            updated.push(p);
        }
    }
    await context.globalState.update(RECENT_KEY, updated);
}

/**
 * Comando "Recent Projects": lista los proyectos creados y permite abrirlos.
 * @param context contexto de la extensión
 */
export async function recentProjects(context: vscode.ExtensionContext): Promise<void> {
    const items: Array<vscode.QuickPickItem & { project: RecentProject }> = [];
    for (const p of context.globalState.get<RecentProject[]>(RECENT_KEY, [])) {
        if (fs.existsSync(p.root)) {
            items.push({
                label: `$(folder) ${p.name}`,
                description: p.stack,
                detail: `${p.root} · ${new Date(p.createdAt).toLocaleDateString()}`,
                project: p,
            });
        }
    }
    if (!items.length) {
        const choice = await vscode.window.showInformationMessage(
            'You have not created any projects with DevStarter yet.',
            'New Project',
        );
        if (choice) {
            void vscode.commands.executeCommand('devstarter.newProject');
        }
        return;
    }
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Open a project created with DevStarter',
        matchOnDescription: true,
    });
    if (!picked) {
        return;
    }
    const how = await vscode.window.showQuickPick(
        [
            { label: '$(window) Open in this window', value: 'here' },
            { label: '$(empty-window) Open in a new window', value: 'new' },
            { label: '$(file-directory) Show in file explorer', value: 'reveal' },
        ],
        { placeHolder: picked.project.name },
    );
    const uri = vscode.Uri.file(picked.project.root);
    if (how?.value === 'reveal') {
        await vscode.commands.executeCommand('revealFileInOS', uri);
    } else if (how) {
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: how.value === 'new' });
    }
}
