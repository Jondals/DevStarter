/**
 * psPolicy.ts
 * ───────────
 * Windows only: detects and fixes the PowerShell "execution policy" problem.
 *
 * On a fresh Windows install PowerShell runs with the "Restricted" policy, so typing
 * `npm run dev` in a VS Code terminal fails with:
 *     npm.ps1 cannot be loaded because running scripts is disabled on this system.
 * (npm, npx and pnpm are launched through small .ps1 wrapper scripts in PowerShell.)
 *
 * The usual fix is `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, which needs no admin
 * rights and only affects the current user. DevStarter offers to apply it, and meanwhile starts
 * the dev servers through the .cmd wrappers, which are not affected by the policy.
 */
import * as cp from 'child_process';
import * as vscode from 'vscode';
import { log } from './log';

/** Policies that block npm.ps1 and friends. "Undefined" everywhere means "Restricted" on Windows clients. */
const BLOCKING = new Set(['restricted', 'allsigned', 'undefined']);

/** Cached answer: the policy does not change often, and asking PowerShell takes ~1 s. */
let cached: boolean | undefined;

/**
 * Runs a PowerShell command and returns its trimmed output.
 * @param command PowerShell code to run
 */
function powershell(command: string): Promise<string> {
    return new Promise(function (resolve, reject) {
        cp.execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', command],
            { windowsHide: true, timeout: 15000 },
            function (err, stdout) {
                if (err) {
                    reject(err);
                } else {
                    resolve(stdout.trim());
                }
            },
        );
    });
}

/**
 * Whether PowerShell would refuse to run npm.ps1 for this user.
 * ? We ask a *new* PowerShell (not this process), so the answer matches what VS Code terminals see.
 * @returns false on other platforms or if PowerShell cannot be asked
 */
export async function scriptsBlocked(): Promise<boolean> {
    if (process.platform !== 'win32') {
        return false;
    }
    if (cached === undefined) {
        try {
            cached = BLOCKING.has((await powershell('Get-ExecutionPolicy')).toLowerCase());
        } catch (err) {
            log(`Could not read the PowerShell execution policy: ${err}`);
            cached = false;
        }
    }
    return cached;
}

/**
 * Lets the current user run local scripts (RemoteSigned, CurrentUser scope: no admin needed).
 * ! A company Group Policy can override this; we check the effective policy afterwards.
 * @returns true if scripts can run now
 */
export async function allowScripts(): Promise<boolean> {
    try {
        await powershell('Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force');
    } catch (err) {
        log(`Set-ExecutionPolicy failed: ${err}`);
    }
    cached = undefined;
    return !(await scriptsBlocked());
}

/**
 * Rewrites a command so it works even when scripts are blocked: `npm run dev` → `npm.cmd run dev`.
 * Only the JavaScript tools that ship .ps1 wrappers are touched (bun is a real .exe).
 * @param command command typed into a terminal
 */
export function useCmdWrappers(command: string): string {
    return command.replace(/(^|&&\s*|;\s*)(npm|npx|pnpm|pnpx|yarn)(?=\s|$)/g, '$1$2.cmd');
}

/** The fix was already offered in this VS Code session. */
let offered = false;

/**
 * If PowerShell blocks scripts, explains it and offers to fix it with one click.
 * Shown at most once per VS Code session.
 */
export async function offerScriptsFix(): Promise<void> {
    if (offered || !(await scriptsBlocked())) {
        return;
    }
    offered = true;
    const fix = 'Fix it for me';
    const learn = 'What is this?';
    const picked = await vscode.window.showWarningMessage(
        'PowerShell is blocking scripts on this computer, so commands like "npm run dev" fail in the terminal ' +
            '("running scripts is disabled on this system"). DevStarter can allow scripts for your user ' +
            '(Set-ExecutionPolicy -Scope CurrentUser RemoteSigned). No admin rights needed.',
        fix,
        learn,
    );
    if (picked === learn) {
        await vscode.env.openExternal(
            vscode.Uri.parse(
                'https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies',
            ),
        );
    } else if (picked === fix) {
        if (await allowScripts()) {
            void vscode.window.showInformationMessage('Done! npm and friends now work in PowerShell terminals.');
        } else {
            void vscode.window.showErrorMessage(
                'Could not change the policy (it may be managed by your organization). ' +
                    'Use "Command Prompt" as the terminal profile instead, or ask your administrator.',
            );
        }
    }
}
