import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computePermissions } from "../../sources/ComputePermissions.js";
import { assertCanReadPath } from "../../sources/sandbox/assertCanReadPath.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
    );
});

describe("assertCanReadPath", () => {
    it("refuses a denied workspace path even where the mode would allow it", async () => {
        const workspace = await makeDirectory("workspace");
        const denied = join(workspace, "credentials");
        await mkdir(denied);

        await expect(
            assertCanReadPath(
                workspace,
                join(denied, "token"),
                computePermissions("auto", { deniedReadPaths: [denied] }),
            ),
        ).rejects.toThrow("denied path");
    });

    it("lets a read denial beat a grant for the same path", async () => {
        const workspace = await makeDirectory("workspace");
        const outside = await makeDirectory("outside");

        await expect(
            assertCanReadPath(
                workspace,
                join(outside, "secret"),
                computePermissions("workspace_write", {
                    allowedReadPaths: [outside],
                    deniedReadPaths: [outside],
                }),
                {},
                { homeDirectory: outside, platform: "win32" },
            ),
        ).rejects.toThrow("denied path");
    });

    it("uses an explicit grant to read a private path on restricted platforms", async () => {
        const workspace = await makeDirectory("workspace");
        const home = await makeDirectory("home");
        const skills = join(home, ".codex", "skills");
        await mkdir(skills, { recursive: true });

        await expect(
            assertCanReadPath(
                workspace,
                join(skills, "skill.md"),
                computePermissions("workspace_write", { allowedReadPaths: [skills] }),
                {},
                { homeDirectory: home, platform: "win32" },
            ),
        ).resolves.toBeUndefined();
    });

    it("lets a host-policy private path beat operation and policy read grants", async () => {
        const workspace = await makeDirectory("workspace");
        const privateDirectory = await makeDirectory("private");

        await expect(
            assertCanReadPath(
                workspace,
                join(privateDirectory, "secret"),
                computePermissions("full_access", {
                    allowedReadPaths: [privateDirectory],
                }),
                {
                    privateDirectories: [privateDirectory],
                    readableDirectories: [privateDirectory],
                },
            ),
        ).rejects.toThrow("denied path");
    });

    it("uses a host-policy readable directory as a restricted-platform read grant", async () => {
        const workspace = await makeDirectory("workspace");
        const readableDirectory = await makeDirectory("readable");

        await expect(
            assertCanReadPath(
                workspace,
                join(readableDirectory, "reference.txt"),
                computePermissions("workspace_write"),
                { readableDirectories: [readableDirectory] },
                { homeDirectory: readableDirectory, platform: "win32" },
            ),
        ).resolves.toBeUndefined();
    });
});

async function makeDirectory(label: string): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), `compute-read-${label}-`));
    temporaryDirectories.push(path);
    return path;
}
