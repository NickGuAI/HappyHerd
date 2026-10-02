import { runGitCommandOrThrow, type GitCommandRunner } from "./GitCommandRunner.js";
import { normalizeProjectCwd } from "./normalizeProjectCwd.js";

export async function readGitTopLevel(git: GitCommandRunner, path: string): Promise<string> {
    return normalizeProjectCwd(
        await runGitCommandOrThrow(git, path, ["rev-parse", "--show-toplevel"]),
    );
}
