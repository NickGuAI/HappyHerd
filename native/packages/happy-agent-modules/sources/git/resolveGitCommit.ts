import {
    runGitCommandOrThrow,
    type GitCommandOptions,
    type GitCommandRunner,
} from "./GitCommandRunner.js";

export async function resolveGitCommit(
    git: GitCommandRunner,
    cwd: string,
    ref: string,
    options?: GitCommandOptions,
): Promise<string | undefined> {
    const commit = await runGitCommandOrThrow(
        git,
        cwd,
        ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
        options,
    );
    return /^[a-f0-9]{40,64}$/iu.test(commit) ? commit.toLocaleLowerCase() : undefined;
}
