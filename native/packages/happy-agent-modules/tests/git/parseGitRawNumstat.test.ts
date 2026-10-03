import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseGitRawNumstat } from "../../sources/git/parseGitRawNumstat.js";
import { runScanGit } from "../../sources/git/runScanGit.js";
import { cleanupRoots, commitFile, createRepository, git } from "./helpers.js";

afterEach(cleanupRoots);

describe("parseGitRawNumstat", () => {
    it("aligns real rename counts and detects binary files", async () => {
        const repository = await createRepository();
        await commitFile(repository, "old name.txt", "one\ntwo\n");
        await writeFile(join(repository, "image.bin"), Buffer.from([0, 1, 2]));
        await git(repository, ["add", "--all"]);
        await git(repository, ["commit", "--quiet", "--message", "binary"]);
        await git(repository, ["mv", "old name.txt", "new name.txt"]);
        await writeFile(join(repository, "image.bin"), Buffer.from([0, 8, 9, 10]));
        const result = await runScanGit({
            args: ["diff", "-z", "--raw", "--numstat", "--find-renames", "HEAD"],
            cwd: repository,
        });

        const changes = parseGitRawNumstat(result.stdout);
        expect(changes.find((change) => change.path === "new name.txt")).toMatchObject({
            kind: "renamed",
            previousPath: "old name.txt",
        });
        const binary = changes.find((change) => change.path === "image.bin");
        expect(binary?.binary).toBe(true);
        expect(binary?.insertions).toBeUndefined();
    });
});
