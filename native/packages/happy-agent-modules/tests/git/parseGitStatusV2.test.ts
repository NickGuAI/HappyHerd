import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseGitStatusV2 } from "../../sources/git/parseGitStatusV2.js";
import { runScanGit } from "../../sources/git/runScanGit.js";
import { cleanupRoots, commitFile, createRepository, git } from "./helpers.js";

afterEach(cleanupRoots);

describe("parseGitStatusV2", () => {
    it("separates staged, unstaged, untracked, rename, and branch facts from real Git", async () => {
        const repository = await createRepository();
        await writeFile(join(repository, "rename-me.txt"), "rename\n");
        await commitFile(repository, "both.txt", "one\n");
        await writeFile(join(repository, "both.txt"), "one\ntwo\n");
        await git(repository, ["add", "both.txt"]);
        await writeFile(join(repository, "both.txt"), "one\ntwo\nthree\n");
        await writeFile(join(repository, "fresh.txt"), "new\n");
        await git(repository, ["mv", "rename-me.txt", "renamed file.txt"]);
        const result = await runScanGit({
            args: ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
            cwd: repository,
        });

        const status = parseGitStatusV2(result.stdout);
        expect(status.branch).toBe("main");
        expect(status.detached).toBe(false);
        expect(status.entries.find((entry) => entry.path === "both.txt")).toMatchObject({
            staged: true,
            unstaged: true,
        });
        expect(status.entries.find((entry) => entry.path === "fresh.txt")).toMatchObject({
            untracked: true,
        });
        expect(status.entries.find((entry) => entry.path === "renamed file.txt")).toMatchObject({
            from: "rename-me.txt",
            staged: true,
        });
    });
});
