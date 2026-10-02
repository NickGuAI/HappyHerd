import { runGitCommandOrThrow, type GitCommandRunner } from "./GitCommandRunner.js";
import { remoteProjectName } from "./remoteProjectName.js";

export async function selectGitRemoteUrl(
    git: GitCommandRunner,
    cwd: string,
): Promise<string | undefined> {
    try {
        const branch = await runGitCommandOrThrow(git, cwd, [
            "symbolic-ref",
            "--quiet",
            "--short",
            "HEAD",
        ]);
        const trackedRemote = await runGitCommandOrThrow(git, cwd, [
            "config",
            "--get",
            `branch.${branch}.remote`,
        ]);
        if (trackedRemote !== ".") {
            return await runGitCommandOrThrow(git, cwd, [
                "config",
                "--get",
                `remote.${trackedRemote}.url`,
            ]);
        }
    } catch {
        // Try origin and then stable remote order.
    }
    try {
        return await runGitCommandOrThrow(git, cwd, ["config", "--get", "remote.origin.url"]);
    } catch {
        // Try every remote.
    }
    try {
        const remotes = (await runGitCommandOrThrow(git, cwd, ["remote"]))
            .split(/\r?\n/gu)
            .map((value) => value.trim())
            .filter(Boolean);
        for (const remote of remotes) {
            const url = await runGitCommandOrThrow(git, cwd, [
                "config",
                "--get",
                `remote.${remote}.url`,
            ]);
            if (remoteProjectName(url) !== undefined) return url;
        }
    } catch {
        // No usable remote is an ordinary repository state.
    }
    return undefined;
}
