import { Type, type Static } from "@sinclair/typebox";

import { runGitCommandOrThrow, type GitCommandRunner } from "./GitCommandRunner.js";
import { resolveGitCommit } from "./resolveGitCommit.js";

const WORKSPACE_FETCH_TIMEOUT_MS = 5 * 60 * 1_000;

export const workspaceBaseSchema = Type.Object(
    {
        commit: Type.String({ pattern: "^[a-f0-9]{40,64}$" }),
        ref: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
);
export type WorkspaceBase = Static<typeof workspaceBaseSchema>;

export async function resolveWorkspaceBase(options: {
    defaultBranch?: string;
    git: GitCommandRunner;
    projectPath: string;
    requestedRef?: string;
    signal?: AbortSignal;
}): Promise<WorkspaceBase> {
    const needsRemote =
        options.requestedRef === undefined || options.requestedRef.startsWith("origin/");
    if (needsRemote && (await hasOrigin(options.git, options.projectPath, options.signal))) {
        try {
            await runGitCommandOrThrow(options.git, options.projectPath, ["fetch", "origin"], {
                ...(options.signal === undefined ? {} : { signal: options.signal }),
                timeoutMs: WORKSPACE_FETCH_TIMEOUT_MS,
            });
        } catch {
            options.signal?.throwIfAborted();
            // Offline workspaces use the last fetched remote state.
        }
    }
    if (options.requestedRef !== undefined) {
        const commit = await tryResolve(
            options.git,
            options.projectPath,
            options.requestedRef,
            options.signal,
        );
        if (commit === undefined) {
            throw new Error(
                `The workspace base "${options.requestedRef}" did not resolve to a commit in this repository.`,
            );
        }
        return { commit, ref: options.requestedRef };
    }
    if (options.defaultBranch === undefined) {
        throw new Error(
            "This project has no branch to start a workspace from. Name an explicit base to fork.",
        );
    }
    const remoteRef = `refs/remotes/origin/${options.defaultBranch}`;
    const remoteCommit = await tryResolve(
        options.git,
        options.projectPath,
        remoteRef,
        options.signal,
    );
    if (remoteCommit !== undefined) {
        return { commit: remoteCommit, ref: `origin/${options.defaultBranch}` };
    }
    const localCommit = await tryResolve(
        options.git,
        options.projectPath,
        `refs/heads/${options.defaultBranch}`,
        options.signal,
    );
    if (localCommit === undefined) {
        throw new Error(
            `This project's branch "${options.defaultBranch}" has no commit to start a workspace from. Name an explicit base to fork.`,
        );
    }
    return { commit: localCommit, ref: options.defaultBranch };
}

async function hasOrigin(
    git: GitCommandRunner,
    path: string,
    signal?: AbortSignal,
): Promise<boolean> {
    try {
        await runGitCommandOrThrow(
            git,
            path,
            ["remote", "get-url", "origin"],
            signal === undefined ? undefined : { signal },
        );
        return true;
    } catch {
        signal?.throwIfAborted();
        return false;
    }
}

async function tryResolve(
    git: GitCommandRunner,
    path: string,
    ref: string,
    signal?: AbortSignal,
): Promise<string | undefined> {
    try {
        return await resolveGitCommit(
            git,
            path,
            ref,
            signal === undefined ? undefined : { signal },
        );
    } catch {
        signal?.throwIfAborted();
        return undefined;
    }
}
