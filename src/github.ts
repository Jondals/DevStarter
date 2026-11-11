/**
 * github.ts
 * ─────────
 * Publishing to GitHub without installing anything: DevStarter signs in with the GitHub account
 * built into VS Code (one "Allow" click), creates the repository through the GitHub API and pushes
 * with plain Git. No GitHub CLI, no "gh auth login", no tokens to copy.
 *
 *   - New repository:       creates <name> (private) on the person's account and pushes.
 *   - Existing repository:  the person picks one of their repositories; the project is merged
 *                           on top of what is there (the new files win) and pushed.
 *
 * ! The token only lives in memory and is handed to Git through environment variables
 * ! (GIT_CONFIG_*), so it never ends up in .git/config, the command line or the logs.
 */
import * as vscode from 'vscode';
import * as cp from 'child_process';

/** Where the project goes on GitHub, decided before the build starts. */
export interface GithubTarget {
    token: string;
    login: string;
    /** Commit e-mail that keeps the real address private (id+login@users.noreply.github.com). */
    email: string;
    /** Existing repository ("owner/name"); undefined = create a new one. */
    existing?: { fullName: string; cloneUrl: string; defaultBranch: string };
    private: boolean;
}

interface GithubUser {
    id: number;
    login: string;
    name: string | null;
}

interface GithubRepo {
    full_name: string;
    clone_url: string;
    default_branch: string;
    private: boolean;
    description: string | null;
    pushed_at: string;
}

/**
 * Calls the GitHub REST API.
 * @param token OAuth token
 * @param route path such as /user/repos
 * @param init fetch options
 */
async function api<T>(token: string, route: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`https://api.github.com${route}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'DevStarter-VSCode',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
    });
    if (!res.ok) {
        const text = await res.text();
        let message = text;
        try {
            message =
                (JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> }).errors?.[0]?.message ??
                (JSON.parse(text) as { message?: string }).message ??
                text;
        } catch {
            // Not JSON: keep the raw text.
        }
        throw new Error(`GitHub: ${message} (HTTP ${res.status})`);
    }
    return (await res.json()) as T;
}

/**
 * Signs in with the GitHub account of VS Code and, for "existing", lets the person pick a repository.
 * @param mode new or existing repository
 * @param name project name (to suggest a repository)
 * @returns the target, or undefined if the person cancelled
 */
export async function prepareGithub(mode: 'new' | 'existing', name: string): Promise<GithubTarget | undefined> {
    let session: vscode.AuthenticationSession;
    try {
        session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    } catch {
        return undefined; // the person closed the sign-in prompt
    }
    const user = await api<GithubUser>(session.accessToken, '/user');
    const target: GithubTarget = {
        token: session.accessToken,
        login: user.login,
        email: `${user.id}+${user.login}@users.noreply.github.com`,
        private: true,
    };
    if (mode === 'new') {
        const visibility = await vscode.window.showQuickPick(
            [
                { label: '$(lock) Private', description: 'only you (recommended)', value: true },
                { label: '$(globe) Public', description: 'anyone can see the code', value: false },
            ],
            {
                title: `New GitHub repository: ${user.login}/${name}`,
                placeHolder: 'Who can see it?',
                ignoreFocusOut: true,
            },
        );
        if (!visibility) {
            return undefined;
        }
        target.private = visibility.value;
        return target;
    }
    const repos = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Loading your GitHub repositories…' },
        function () {
            return api<GithubRepo[]>(
                session.accessToken,
                '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
            );
        },
    );
    const picked = await vscode.window.showQuickPick(
        repos.map(function (r) {
            return {
                label: `$(${r.private ? 'lock' : 'repo'}) ${r.full_name}`,
                description: r.description ?? '',
                detail: `Last push ${new Date(r.pushed_at).toLocaleDateString()}`,
                repo: r,
            };
        }),
        {
            title: 'Add the project to one of your GitHub repositories',
            placeHolder: 'Type to search. The new files are added on top of what the repository has.',
            matchOnDescription: true,
            ignoreFocusOut: true,
        },
    );
    if (!picked) {
        return undefined;
    }
    target.existing = {
        fullName: picked.repo.full_name,
        cloneUrl: picked.repo.clone_url,
        defaultBranch: picked.repo.default_branch || 'main',
    };
    target.private = picked.repo.private;
    return target;
}

/**
 * Runs Git in a folder with the token available only to this process.
 * @param cwd folder
 * @param args git arguments
 * @param token OAuth token
 * @returns exit code and output
 */
function git(cwd: string, args: string[], token?: string): Promise<{ code: number; output: string }> {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    if (token) {
        // * Same effect as "git -c http.extraheader=..." but invisible in the process list.
        env.GIT_CONFIG_COUNT = '1';
        env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
        env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
    }
    return new Promise(function (resolve) {
        const child = cp.spawn('git', args, { cwd, env, windowsHide: true });
        let output = '';
        child.stdout.on('data', function (d: Buffer) {
            output += d.toString();
        });
        child.stderr.on('data', function (d: Buffer) {
            output += d.toString();
        });
        child.on('error', function (err) {
            resolve({ code: 1, output: String(err) });
        });
        child.on('close', function (code) {
            resolve({ code: code ?? 1, output: output.trim() });
        });
    });
}

/**
 * Runs Git and throws with its output if it fails.
 * @param cwd folder
 * @param args git arguments
 * @param token OAuth token
 */
async function gitOrThrow(cwd: string, args: string[], token?: string): Promise<string> {
    const { code, output } = await git(cwd, args, token);
    if (code !== 0) {
        throw new Error(`git ${args[0]} failed: ${output.split('\n').slice(-3).join(' ')}`);
    }
    return output;
}

/**
 * Makes sure commits have an author: if Git has no name/e-mail yet, uses the GitHub account
 * (only for this repository, so nothing global changes).
 * @param dir repository folder
 * @param target GitHub account
 */
export async function ensureCommitIdentity(dir: string, target: GithubTarget): Promise<void> {
    if ((await git(dir, ['config', 'user.name'])).code !== 0) {
        await gitOrThrow(dir, ['config', 'user.name', target.login]);
    }
    if ((await git(dir, ['config', 'user.email'])).code !== 0) {
        await gitOrThrow(dir, ['config', 'user.email', target.email]);
    }
}

/**
 * Publishes the repository in `dir` (with at least one commit) to GitHub.
 * @param dir project root (a Git repository)
 * @param name repository name for a new one
 * @param target account and destination
 * @param log progress messages
 * @returns the repository web address
 */
export async function publishToGithub(
    dir: string,
    name: string,
    target: GithubTarget,
    log: (message: string) => void,
): Promise<string> {
    // * Make sure there is a commit to push (the first-commit step may have been skipped).
    await ensureCommitIdentity(dir, target);
    if ((await git(dir, ['rev-parse', '--verify', 'HEAD'])).code !== 0) {
        await gitOrThrow(dir, ['add', '-A']);
        await gitOrThrow(dir, ['commit', '-q', '-m', 'Initial commit from DevStarter']);
    }

    let cloneUrl: string;
    let branch: string;
    let fullName: string;
    if (target.existing) {
        ({ cloneUrl, fullName } = target.existing);
        branch = target.existing.defaultBranch;
        await git(dir, ['remote', 'remove', 'origin']);
        await gitOrThrow(dir, ['remote', 'add', 'origin', cloneUrl]);
        await gitOrThrow(dir, ['branch', '-M', branch]);
        const fetched = await git(dir, ['fetch', 'origin', branch], target.token);
        if (fetched.code === 0) {
            // * The repository already has commits: keep its history and put the project on top.
            log(`Merging with what ${fullName} already has (your new files win on conflicts)`);
            await gitOrThrow(dir, [
                'merge',
                `origin/${branch}`,
                '--allow-unrelated-histories',
                '-X',
                'ours',
                '-m',
                'Add project created with DevStarter',
            ]);
        }
    } else {
        log(`Creating ${target.private ? 'private' : 'public'} repository ${target.login}/${name}`);
        const repo = await api<GithubRepo>(target.token, '/user/repos', {
            method: 'POST',
            body: JSON.stringify({ name, private: target.private, description: 'Created with DevStarter' }),
        });
        ({ clone_url: cloneUrl, full_name: fullName } = repo);
        branch = 'main';
        await git(dir, ['remote', 'remove', 'origin']);
        await gitOrThrow(dir, ['remote', 'add', 'origin', cloneUrl]);
        await gitOrThrow(dir, ['branch', '-M', branch]);
    }
    log(`Uploading to ${fullName}`);
    await gitOrThrow(dir, ['push', '-u', 'origin', branch], target.token);
    return `https://github.com/${fullName}`;
}

/**
 * Command "Publish This Folder to GitHub": for a project that already exists (made with
 * DevStarter or not). Initialises Git if needed and publishes to a new or existing repository.
 */
export async function publishFolderCommand(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        vscode.window.showWarningMessage('Open the project folder first (File → Open Folder…).');
        return;
    }
    const dir = folder.uri.fsPath;
    const mode = await vscode.window.showQuickPick(
        [
            { label: '$(add) Create a new repository', description: folder.name, value: 'new' as const },
            { label: '$(repo) Add to one of my repositories', value: 'existing' as const },
        ],
        { title: `Publish "${folder.name}" to GitHub` },
    );
    if (!mode) {
        return;
    }
    const target = await prepareGithub(mode.value, folder.name);
    if (!target) {
        return;
    }
    try {
        const url = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Publishing to GitHub' },
            async function (progress) {
                if ((await git(dir, ['rev-parse', '--is-inside-work-tree'])).code !== 0) {
                    await gitOrThrow(dir, ['init', '-q']);
                }
                await ensureCommitIdentity(dir, target);
                await gitOrThrow(dir, ['add', '-A']);
                // ? Nothing to commit is fine (the folder may already be committed).
                await git(dir, ['commit', '-q', '-m', 'Publish with DevStarter']);
                return publishToGithub(dir, sanitizeRepoName(folder.name), target, function (message) {
                    progress.report({ message });
                });
            },
        );
        const open = await vscode.window.showInformationMessage(`Published to ${url}`, 'Open on GitHub');
        if (open) {
            void vscode.env.openExternal(vscode.Uri.parse(url));
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Could not publish: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Turns a folder name into a valid GitHub repository name.
 * @param name folder name
 */
export function sanitizeRepoName(name: string): string {
    return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project';
}
