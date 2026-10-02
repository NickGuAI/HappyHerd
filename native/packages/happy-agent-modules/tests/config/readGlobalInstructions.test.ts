import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createRootContext } from "@steve.kite/stdlib";
import { afterEach, describe, expect, it } from "vitest";

import { readGlobalInstructions } from "../../sources/config/impl/readGlobalInstructions.js";

const createdDirectories = new Set<string>();
const ctx = createRootContext().named("read-global-instructions-test");

afterEach(async () => {
    await Promise.all(
        [...createdDirectories].map(async (directory) => {
            await rm(directory, { force: true, recursive: true });
        }),
    );
    createdDirectories.clear();
});

describe("readGlobalInstructions", () => {
    it("treats missing, non-directory-parent, and directory paths as absent", async () => {
        const directory = await createTestDirectory();

        await expect(
            readGlobalInstructions(ctx, join(directory, "missing", "AGENTS.md"), 1_024),
        ).resolves.toBeUndefined();

        const nonDirectory = join(directory, "not-a-directory");
        await writeFile(nonDirectory, "content");
        await expect(
            readGlobalInstructions(ctx, join(nonDirectory, "AGENTS.md"), 1_024),
        ).resolves.toBeUndefined();

        const instructionsDirectory = join(directory, "AGENTS.md");
        await mkdir(instructionsDirectory);
        await expect(
            readGlobalInstructions(ctx, instructionsDirectory, 1_024),
        ).resolves.toBeUndefined();
    });

    it("keeps ordinary read failures visible", async () => {
        await expect(readGlobalInstructions(ctx, "\u0000", 1_024)).rejects.toThrow();
    });

    it("does not replace a Unicode code point crossing the byte bound", async () => {
        const directory = await createTestDirectory();
        const path = join(directory, "AGENTS.md");
        const maxBytes = 32;
        const prefix = "a".repeat(maxBytes - 2);
        await writeFile(path, `${prefix}😀tail`);

        const instructions = await readGlobalInstructions(ctx, path, maxBytes);

        expect(instructions).toBe(`${prefix}😀`);
        expect(instructions).not.toContain("�");
        expect(new TextEncoder().encode(instructions).byteLength).toBeGreaterThan(maxBytes);
    });
});

async function createTestDirectory(): Promise<string> {
    const scratch = resolve(import.meta.dirname, "../../../.context");
    await mkdir(scratch, { recursive: true });
    const directory = await mkdtemp(join(scratch, "global-instructions-"));
    createdDirectories.add(directory);
    return directory;
}
