import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { reviewerAgentId } from "../../sources/auto/impl/reviewerAgentId.js";

describe("reviewerAgentId", () => {
    it("derives a stable 32-character cuid2-shaped id beginning with a letter", () => {
        const id = reviewerAgentId("main-agent-1");
        expect(id).toHaveLength(32);
        expect(id).toMatch(/^r[0-9a-f]{31}$/);
    });

    it("is deterministic for the same main agent id", () => {
        expect(reviewerAgentId("abc")).toBe(reviewerAgentId("abc"));
    });

    it("differs for different main agent ids", () => {
        expect(reviewerAgentId("abc")).not.toBe(reviewerAgentId("abd"));
    });

    it("matches the r + first-31-hex-of-sha256 construction exactly", () => {
        const digest = createHash("sha256").update("main-agent-1", "utf8").digest("hex");
        expect(reviewerAgentId("main-agent-1")).toBe(`r${digest.slice(0, 31)}`);
    });
});
