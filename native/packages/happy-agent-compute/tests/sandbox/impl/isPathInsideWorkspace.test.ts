import { describe, expect, it } from "vitest";

import { isPathInsideWorkspace } from "../../../sources/sandbox/impl/isPathInsideWorkspace.js";

describe("isPathInsideWorkspace", () => {
    it("uses the canonical filesystem's separator without accepting sibling prefixes", async () => {
        const identity = async (path: string) => path;

        await expect(
            isPathInsideWorkspace("/workspace", "/workspace/source", identity),
        ).resolves.toBe(true);
        await expect(
            isPathInsideWorkspace("/workspace", "/workspace-other", identity),
        ).resolves.toBe(false);
        await expect(
            isPathInsideWorkspace("/workspace", "/workspace\\other", identity),
        ).resolves.toBe(false);
        await expect(
            isPathInsideWorkspace("C:\\workspace", "C:\\workspace\\source", identity),
        ).resolves.toBe(true);
        await expect(
            isPathInsideWorkspace("C:\\workspace", "C:\\workspace-other", identity),
        ).resolves.toBe(false);
    });
});
