import { lstat, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createGitWorktree } from "../../sources/git/createGitWorktree.js";
import { isGitWorktreeAt } from "../../sources/git/isGitWorktreeAt.js";
import { readGitCommonDir } from "../../sources/git/readGitCommonDir.js";
import { removeGitWorktree } from "../../sources/git/removeGitWorktree.js";
import { cleanupRoots, commitFile, createRepository, createRoot, gitRunner } from "./helpers.js";

afterEach(cleanupRoots);

describe("managed Git worktrees", () => {
    it("creates an anchored branch, proves identity, then removes and prunes it", async () => {
        const repository = await createRepository();
        const commit = await commitFile(repository, "README.md", "fixture\n");
        const commonDir = await readGitCommonDir(gitRunner, repository);
        const workspace = join(await createRoot(), "workspace");

        await createGitWorktree({
            branch: "worktree/feature",
            commit,
            expectedCommonDir: commonDir,
            git: gitRunner,
            projectPath: repository,
            workspacePath: workspace,
        });
        expect(await isGitWorktreeAt({ commonDir, git: gitRunner, path: workspace })).toBe(true);

        await removeGitWorktree({
            expectedCommonDir: commonDir,
            git: gitRunner,
            projectPath: repository,
            removeDirectory: true,
            workspacePath: workspace,
        });
        await expect(lstat(workspace)).rejects.toThrow();
    });

    it("refuses a symlink before asking Git to force-remove its target", async () => {
        const repository = await createRepository();
        await commitFile(repository, "README.md", "fixture\n");
        const commonDir = await readGitCommonDir(gitRunner, repository);
        const root = await createRoot();
        const target = join(root, "target");
        const link = join(root, "link");
        await mkdir(target);
        await symlink(target, link);

        await expect(
            removeGitWorktree({
                expectedCommonDir: commonDir,
                git: gitRunner,
                projectPath: repository,
                removeDirectory: true,
                workspacePath: link,
            }),
        ).rejects.toThrow("not a real directory");
    });
});

describe("worktree checkout time budget", () => {
    it("gives the checkout and removal an explicit budget beyond the local default", async () => {
        const repository = await createRepository();
        const commit = await commitFile(repository, "README.md", "fixture\n");
        const commonDir = await readGitCommonDir(gitRunner, repository);
        const workspace = join(await createRoot(), "workspace");
        const budgets = new Map<string, number | undefined>();
        const recording: typeof gitRunner = {
            run: (cwd, args, options) => {
                if (args[0] === "worktree") budgets.set(args[1] ?? "", options?.timeoutMs);
                return gitRunner.run(cwd, args, options);
            },
        };

        await createGitWorktree({
            branch: "worktree/budget",
            commit,
            expectedCommonDir: commonDir,
            git: recording,
            projectPath: repository,
            workspacePath: workspace,
        });
        await removeGitWorktree({
            expectedCommonDir: commonDir,
            git: recording,
            projectPath: repository,
            removeDirectory: true,
            workspacePath: workspace,
        });

        // A checkout writes the whole tree, so the 5-second local-command default starves it.
        expect(budgets.get("add")).toBeGreaterThan(60_000);
        expect(budgets.get("remove")).toBeGreaterThan(60_000);
    });
});
