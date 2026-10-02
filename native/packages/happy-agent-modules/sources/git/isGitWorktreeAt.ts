import type { GitCommandRunner } from "./GitCommandRunner.js";
import { normalizeProjectCwd } from "./normalizeProjectCwd.js";
import { readGitWorktreeIdentity } from "./readGitWorktreeIdentity.js";

export async function isGitWorktreeAt(options: {
    commonDir: string;
    git: GitCommandRunner;
    path: string;
}): Promise<boolean> {
    try {
        const identity = await readGitWorktreeIdentity(options.git, options.path);
        return (
            identity.topLevel === normalizeProjectCwd(options.path) &&
            identity.commonDir === normalizeProjectCwd(options.commonDir)
        );
    } catch {
        return false;
    }
}
