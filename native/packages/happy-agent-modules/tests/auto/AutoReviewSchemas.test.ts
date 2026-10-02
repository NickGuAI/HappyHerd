import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import {
    autoEvidenceEntrySchema,
    autoEvidenceStateSchema,
    autoReviewerCursorSchema,
} from "../../sources/auto/AutoReviewTranscript.js";
import { userInputAnsweredSchema } from "../../sources/auto/AutoModule.js";
import { autoTranscriptMessageSchema } from "../../sources/auto/impl/createAutoPermissionTranscript.js";
import { autoReviewerRouteSchema } from "../../sources/auto/impl/reviewerModelForAgent.js";

const message = {
    role: "user",
    blocks: [{ type: "text", text: "inspect this file" }],
} as const;

describe("Auto durable and runtime schemas", () => {
    it("accepts valid evidence entries and rejects malformed nested messages", () => {
        expect(
            Value.Check(autoEvidenceEntrySchema, {
                category: "message",
                entry: message,
                trustedUserEvidence: true,
                trustedUserEvidenceTruncated: false,
            }),
        ).toBe(true);
        expect(
            Value.Check(autoEvidenceEntrySchema, {
                category: "message",
                entry: { role: "user", blocks: [{ type: "unknown" }] },
                trustedUserEvidence: true,
                trustedUserEvidenceTruncated: false,
            }),
        ).toBe(false);
        expect(
            Value.Check(autoEvidenceEntrySchema, {
                category: "message",
                entry: message,
                trustedUserEvidence: "yes",
                trustedUserEvidenceTruncated: false,
            }),
        ).toBe(false);
    });

    it("enforces non-negative integer state and cursor invariants", () => {
        expect(
            Value.Check(autoEvidenceStateSchema, {
                generation: 0,
                nextPosition: 0,
                archiveHealthy: true,
            }),
        ).toBe(true);
        expect(
            Value.Check(autoReviewerCursorSchema, {
                evidenceGeneration: 3,
                reviewedPosition: 12,
                reportedOwnEntryCount: 4,
                lastReviewNormal: false,
            }),
        ).toBe(true);

        for (const invalid of [
            { generation: -1, nextPosition: 0, archiveHealthy: true },
            { generation: 0.5, nextPosition: 0, archiveHealthy: true },
            { generation: 0, nextPosition: -1, archiveHealthy: true },
            { generation: 0, nextPosition: 0, archiveHealthy: "yes" },
            { generation: 0, nextPosition: 0, archiveHealthy: true, extra: true },
        ]) {
            expect(Value.Check(autoEvidenceStateSchema, invalid)).toBe(false);
        }
    });

    it("rejects extra keys in durable cursor and route records", () => {
        expect(
            Value.Check(autoReviewerCursorSchema, {
                evidenceGeneration: 0,
                reviewedPosition: 0,
                reportedOwnEntryCount: 0,
                lastReviewNormal: true,
                extra: true,
            }),
        ).toBe(false);
        expect(
            Value.Check(autoReviewerRouteSchema, {
                providerId: "codex",
                modelId: "openai/gpt-5.6-sol",
                effort: "low",
                extra: true,
            }),
        ).toBe(false);
        expect(
            Value.Check(autoReviewerRouteSchema, {
                providerId: "",
                modelId: "model",
                effort: "low",
            }),
        ).toBe(false);
    });

    it("validates the user-input evidence event and its bounded answer", () => {
        expect(
            Value.Check(userInputAnsweredSchema, {
                type: "user_input_answered",
                agentId: "agent",
                requestId: "request",
                answer: "yes",
            }),
        ).toBe(true);
        expect(
            Value.Check(userInputAnsweredSchema, {
                type: "user_input_answered",
                agentId: "",
                requestId: "request",
                answer: "yes",
            }),
        ).toBe(false);
        expect(
            Value.Check(userInputAnsweredSchema, {
                type: "user_input_answered",
                agentId: "agent",
                requestId: "request",
                answer: "a".repeat(65_537),
            }),
        ).toBe(false);
        expect(
            Value.Check(userInputAnsweredSchema, {
                type: "wrong",
                agentId: "agent",
                requestId: "request",
                answer: "yes",
            }),
        ).toBe(false);
    });

    it("accepts intentional forward-compatible transcript fields but not invalid core fields", () => {
        expect(
            Value.Check(autoTranscriptMessageSchema, {
                ...message,
                futureMetadata: { source: "host" },
            }),
        ).toBe(true);
        expect(
            Value.Check(autoTranscriptMessageSchema, {
                role: "user",
                blocks: [],
                provenance: "agent",
                internal: true,
                outcome: "retried",
                context: "excluded",
            }),
        ).toBe(true);
        expect(
            Value.Check(autoTranscriptMessageSchema, {
                role: "user",
                blocks: [],
                provenance: "user",
            }),
        ).toBe(false);
    });
});
