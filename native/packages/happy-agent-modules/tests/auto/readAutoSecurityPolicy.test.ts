import { describe, expect, it } from "vitest";

import { readAutoSecurityPolicy } from "../../sources/auto/impl/readAutoSecurityPolicy.js";

describe("readAutoSecurityPolicy", () => {
    it("joins both files under the exact v1 headings", async () => {
        const policy = await readAutoSecurityPolicy({
            readGlobalSecurity: async () => "Global rule.",
            readProjectSecurity: async () => "Project rule.",
        });

        expect(policy).toBe(
            "## Global SECURITY.md\n\nGlobal rule.\n\n## Project AGENTS_SECURITY.md\n\nProject rule.",
        );
    });

    it("omits the heading of an absent file", async () => {
        expect(
            await readAutoSecurityPolicy({
                readGlobalSecurity: async () => undefined,
                readProjectSecurity: async () => "Project rule.",
            }),
        ).toBe("## Project AGENTS_SECURITY.md\n\nProject rule.");

        expect(
            await readAutoSecurityPolicy({
                readGlobalSecurity: async () => "Global rule.",
                readProjectSecurity: async () => undefined,
            }),
        ).toBe("## Global SECURITY.md\n\nGlobal rule.");
    });

    it("returns undefined when neither file is present", async () => {
        expect(
            await readAutoSecurityPolicy({
                readGlobalSecurity: async () => undefined,
                readProjectSecurity: async () => undefined,
            }),
        ).toBeUndefined();
    });

    it("propagates a reader failure so the caller can make the review unavailable", async () => {
        await expect(
            readAutoSecurityPolicy({
                readGlobalSecurity: async () => {
                    throw new Error("disk error");
                },
                readProjectSecurity: async () => undefined,
            }),
        ).rejects.toThrow("disk error");
    });

    it("reads both policies concurrently", async () => {
        let globalStarted = false;
        let projectStarted = false;
        let release!: () => void;
        const bothStarted = new Promise<void>((resolve) => {
            release = resolve;
        });

        const policy = readAutoSecurityPolicy({
            readGlobalSecurity: async () => {
                globalStarted = true;
                if (projectStarted) release();
                await bothStarted;
                return "global";
            },
            readProjectSecurity: async () => {
                projectStarted = true;
                if (globalStarted) release();
                await bothStarted;
                return "project";
            },
        });

        await expect(policy).resolves.toContain("global");
        expect(globalStarted).toBe(true);
        expect(projectStarted).toBe(true);
    });
});
