import { Type, type Static } from "@sinclair/typebox";

import { readGitCommonDir } from "./readGitCommonDir.js";
import { readGitTopLevel } from "./readGitTopLevel.js";
import type { GitCommandRunner } from "./GitCommandRunner.js";

export const gitWorktreeIdentitySchema = Type.Object(
    {
        commonDir: Type.String({ minLength: 1 }),
        topLevel: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
);
export type GitWorktreeIdentity = Static<typeof gitWorktreeIdentitySchema>;

export async function readGitWorktreeIdentity(
    git: GitCommandRunner,
    path: string,
): Promise<GitWorktreeIdentity> {
    const topLevel = await readGitTopLevel(git, path);
    const commonDir = await readGitCommonDir(git, path);
    return { commonDir, topLevel };
}
