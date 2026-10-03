import { resolve } from "node:path";

import { runGitCommandOrThrow, type GitCommandRunner } from "./GitCommandRunner.js";
import { normalizeProjectCwd } from "./normalizeProjectCwd.js";

export async function readGitCommonDir(git: GitCommandRunner, path: string): Promise<string> {
    const reported = await runGitCommandOrThrow(git, path, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
    ]);
    return normalizeProjectCwd(resolve(path, reported));
}
