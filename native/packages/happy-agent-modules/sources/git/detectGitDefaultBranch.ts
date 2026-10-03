import { runGitCommandOrThrow, type GitCommandRunner } from "./GitCommandRunner.js";

export async function detectGitDefaultBranch(
    git: GitCommandRunner,
    path: string,
): Promise<string | undefined> {
    const run = async (args: readonly string[]): Promise<string | undefined> => {
        try {
            const output = (await runGitCommandOrThrow(git, path, args)).trim();
            return output.length === 0 ? undefined : output;
        } catch {
            return undefined;
        }
    };
    const originHead = await run([
        "symbolic-ref",
        "--quiet",
        "--short",
        "refs/remotes/origin/HEAD",
    ]);
    if (originHead !== undefined && originHead.startsWith("origin/")) {
        return originHead.slice("origin/".length);
    }
    for (const candidate of ["main", "master"]) {
        const known =
            (await run(["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`])) ??
            (await run(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${candidate}`]));
        if (known !== undefined) return candidate;
    }
    return await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
}
