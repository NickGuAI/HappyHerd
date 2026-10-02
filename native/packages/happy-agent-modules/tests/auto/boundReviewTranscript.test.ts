import {
    permissionReviewDecisionSchema,
    permissionReviewTranscriptSchema,
    type PermissionReviewTranscriptEntry,
    type PermissionReviewUsage,
} from "../../sources/permissions/PermissionReviewer.js";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
    MAX_TRANSCRIPT_ENTRIES,
    MAX_TRANSCRIPT_ENTRY_CHARACTERS,
    boundReviewTranscript,
} from "../../sources/auto/impl/boundReviewTranscript.js";

const usage: PermissionReviewUsage = {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
};

function textEntry(text: string): PermissionReviewTranscriptEntry {
    return { type: "text", text };
}

describe("boundReviewTranscript", () => {
    it("returns undefined when nothing inferred and there are no entries", () => {
        expect(
            boundReviewTranscript({
                entries: [],
                usage,
                inferred: false,
                modelId: "m",
                providerId: "p",
            }),
        ).toBeUndefined();
    });

    it("returns a transcript when an inference ran even with no entries", () => {
        const transcript = boundReviewTranscript({
            entries: [],
            usage,
            inferred: true,
            modelId: "m",
            providerId: "p",
        });
        expect(transcript).toEqual({ entries: [], usage, modelId: "m", providerId: "p" });
    });

    it("returns a transcript when entries exist even if inference was not marked", () => {
        const transcript = boundReviewTranscript({
            entries: [textEntry("captured before settlement")],
            usage,
            inferred: false,
            modelId: "m",
            providerId: "p",
        });

        expect(transcript?.entries).toEqual([textEntry("captured before settlement")]);
    });

    it("keeps only the newest entries, since the verdict is the tail", () => {
        const entries = Array.from({ length: MAX_TRANSCRIPT_ENTRIES + 5 }, (_, index) =>
            textEntry(`entry-${index}`),
        );
        const transcript = boundReviewTranscript({
            entries,
            usage,
            inferred: true,
            modelId: "m",
            providerId: "p",
        });
        expect(transcript?.entries).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
        expect(transcript?.entries.at(0)).toEqual(textEntry("entry-5"));
        expect(transcript?.entries.at(-1)).toEqual(
            textEntry(`entry-${MAX_TRANSCRIPT_ENTRIES + 4}`),
        );
    });

    it("truncates an over-long entry with the exact v1 marker", () => {
        const long = "x".repeat(MAX_TRANSCRIPT_ENTRY_CHARACTERS + 100);
        const transcript = boundReviewTranscript({
            entries: [textEntry(long)],
            usage,
            inferred: true,
            modelId: "m",
            providerId: "p",
        });
        const entry = transcript?.entries[0];
        expect(entry?.type).toBe("text");
        expect(entry).toMatchObject({
            text: `${"x".repeat(MAX_TRANSCRIPT_ENTRY_CHARACTERS)}\n[...truncated...]`,
        });
    });

    it("produces a truncated transcript that still validates against the review schema", () => {
        // The truncation marker pushes an entry past the raw text budget. If the schema bound did
        // not leave room for it, `PermissionsModule` would reject the whole decision as invalid and
        // the reviewed action would silently become unproven — a long, well-reasoned review turned
        // into a refusal. This asserts the produced transcript survives that gate as a real
        // reviewer decision, not just that the text was truncated.
        const longText = "x".repeat(MAX_TRANSCRIPT_ENTRY_CHARACTERS + 100);
        const longArguments = "y".repeat(MAX_TRANSCRIPT_ENTRY_CHARACTERS + 100);
        const transcript = boundReviewTranscript({
            entries: [
                textEntry(longText),
                { type: "thinking", text: longText },
                { type: "tool_call", name: "read_file", arguments: longArguments },
                { type: "tool_result", name: "read_file", isError: false, text: longText },
            ],
            usage,
            inferred: true,
            modelId: "sonnet",
            providerId: "claude",
        });
        expect(transcript).toBeDefined();
        for (const entry of transcript?.entries ?? []) {
            const text = entry.type === "tool_call" ? entry.arguments : entry.text;
            expect(text.length).toBeGreaterThan(MAX_TRANSCRIPT_ENTRY_CHARACTERS);
        }
        expect(Value.Check(permissionReviewTranscriptSchema, transcript)).toBe(true);
        const decision = {
            outcome: "allowed" as const,
            reason: "The reviewer allowed this action.",
            risk: "low" as const,
            userAuthorization: "high" as const,
            transcript,
        };
        expect(Value.Check(permissionReviewDecisionSchema, decision)).toBe(true);
    });

    it("truncates a tool_call's arguments field rather than a text field", () => {
        const long = "y".repeat(MAX_TRANSCRIPT_ENTRY_CHARACTERS + 1);
        const transcript = boundReviewTranscript({
            entries: [{ type: "tool_call", name: "read_file", arguments: long }],
            usage,
            inferred: true,
            modelId: "m",
            providerId: "p",
        });
        expect(transcript?.entries[0]).toMatchObject({
            type: "tool_call",
            name: "read_file",
            arguments: `${"y".repeat(MAX_TRANSCRIPT_ENTRY_CHARACTERS)}\n[...truncated...]`,
        });
    });

    it("leaves an entry exactly at the boundary unchanged", () => {
        const exact = "x".repeat(MAX_TRANSCRIPT_ENTRY_CHARACTERS);
        const entries: PermissionReviewTranscriptEntry[] = [
            { type: "text", text: exact },
            { type: "thinking", text: exact },
            { type: "tool_call", name: "read_file", arguments: exact },
            { type: "tool_result", name: "read_file", isError: true, text: exact },
        ];

        const transcript = boundReviewTranscript({
            entries,
            usage,
            inferred: true,
            modelId: "m",
            providerId: "p",
        });

        expect(transcript?.entries).toEqual(entries);
        expect(entries).toEqual([
            { type: "text", text: exact },
            { type: "thinking", text: exact },
            { type: "tool_call", name: "read_file", arguments: exact },
            { type: "tool_result", name: "read_file", isError: true, text: exact },
        ]);
    });

    it("preserves optional reasoning usage while bounding content", () => {
        const transcript = boundReviewTranscript({
            entries: [textEntry("verdict")],
            usage: { ...usage, reasoning: 9 },
            inferred: true,
            modelId: "m",
            providerId: "p",
        });

        expect(transcript?.usage).toEqual({ ...usage, reasoning: 9 });
    });

    it("carries usage through unchanged", () => {
        const transcript = boundReviewTranscript({
            entries: [textEntry("ok")],
            usage,
            inferred: true,
            modelId: "sonnet",
            providerId: "claude",
        });
        expect(transcript?.usage).toEqual(usage);
        expect(transcript?.modelId).toBe("sonnet");
        expect(transcript?.providerId).toBe("claude");
    });
});
