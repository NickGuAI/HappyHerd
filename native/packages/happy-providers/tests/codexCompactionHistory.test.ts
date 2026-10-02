import { describe, expect, it } from "vitest";

import {
    preserveCodexCompactionMessages,
    preserveCodexLocalCompactionMessages,
    truncateCodexText,
} from "@/vendors/codex/impl/codexCompaction.js";
import { context_checkpoint_summary_prefix } from "@/vendors/codex/prompts/context_checkpoint_compaction_instructions.js";

describe("Codex remote-v2 compaction history", () => {
    it("retains only user messages and middle-truncates at 64k UTF-8 approximate tokens", () => {
        const oversized = `prefix-${"x".repeat(300_000)}-suffix`;

        const preserved = preserveCodexCompactionMessages([
            {
                role: "system",
                content: [{ type: "text" as const, text: "regenerated initial context" }],
            },
            {
                role: "user",
                content: [{ type: "text" as const, text: "old user message" }],
            },
            {
                role: "assistant",
                content: [{ type: "text" as const, text: "old assistant response" }],
            },
            {
                role: "user",
                content: [{ type: "text" as const, text: oversized }],
            },
        ]);

        expect(preserved).toHaveLength(1);
        expect(preserved[0]?.role).toBe("user");
        const text = preserved[0]?.content[0]?.type === "text" ? preserved[0].content[0].text : "";
        expect(Buffer.byteLength(text)).toBeLessThan(64_000 * 4 + 64);
        expect(text).toMatch(/^prefix-/u);
        expect(text).toMatch(/-suffix$/u);
        expect(text).toContain("tokens truncated");
    });

    it("counts non-ASCII bytes and never expands the one-token remainder", () => {
        const newest = "x".repeat(63_999 * 4);
        const older = `begin-${"😀".repeat(100)}-end`;
        const preserved = preserveCodexCompactionMessages([
            {
                role: "user",
                content: [{ type: "text" as const, text: older }],
            },
            {
                role: "user",
                content: [{ type: "text" as const, text: newest }],
            },
        ]);

        expect(preserved).toHaveLength(2);
        const text = preserved[0]?.content[0]?.type === "text" ? preserved[0].content[0].text : "";
        expect(text).not.toBe(older);
        expect(text).toMatch(/^be/u);
        expect(text).toMatch(/nd$/u);
        expect(text).not.toContain("�");
        expect(Buffer.byteLength(text)).toBeLessThan(100);
    });
});

describe("Codex local compaction history", () => {
    it("drops prior summaries and middle-truncates the newest 20k approximate user tokens", () => {
        const newest = `newest-${"x".repeat(100_000)}-ending`;
        const preserved = preserveCodexLocalCompactionMessages([
            {
                role: "user",
                content: [{ type: "text" as const, text: "old user message" }],
            },
            {
                role: "user",
                content: [
                    {
                        type: "text" as const,
                        text: `${context_checkpoint_summary_prefix}\nold synthetic summary`,
                    },
                ],
            },
            {
                role: "assistant",
                content: [{ type: "text" as const, text: "assistant response" }],
            },
            {
                role: "user",
                content: [{ type: "text" as const, text: newest }],
            },
        ]);

        expect(preserved).toEqual([
            {
                role: "user",
                content: [{ type: "text", text: truncateCodexText(newest, 20_000) }],
            },
        ]);
        const text = preserved[0]?.content[0]?.type === "text" ? preserved[0].content[0].text : "";
        expect(text).toMatch(/^newest-/u);
        expect(text).toMatch(/-ending$/u);
        expect(text).toContain("tokens truncated");
        expect(JSON.stringify(preserved)).not.toContain("old synthetic summary");
    });

    it("uses UTF-8 bytes without splitting multi-byte characters", () => {
        const truncated = truncateCodexText(`start-${"😀".repeat(20)}-end`, 4);
        expect(truncated).toMatch(/^start-/u);
        expect(truncated).toMatch(/-end$/u);
        expect(truncated).not.toContain("�");
    });
});
