import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import {
    AWAY_PRESENCE,
    BUILT_IN_PRESENCES,
    ONLINE_PRESENCE,
    assertPresenceCatalog,
} from "../../sources/presence/PresenceCatalog.js";
import { formatPresenceInstruction } from "../../sources/presence/PresenceModule.js";
import {
    assertPresenceMutationInput,
    assertPresenceState,
    assertPresenceStoredState,
    assertTemporaryPresenceInput,
    MAX_PRESENCE_EMOJI_LENGTH,
    MAX_PRESENCE_ID_LENGTH,
    MAX_PRESENCE_MESSAGE_LENGTH,
    MAX_PRESENCE_PROMPT_LENGTH,
    MAX_PRESENCE_TITLE_LENGTH,
    MAX_PRESENCE_TIMESTAMP,
    presenceDefinitionSchema,
    presenceMutationInputSchema,
    presenceStateSchema,
    presenceStoredStateSchema,
    presenceToolInputSchema,
    temporaryPresenceInputSchema,
    type PresenceDefinition,
} from "../../sources/presence/PresenceState.js";
import {
    assertPresenceSchedule,
    assertPresenceScheduleInput,
    presenceScheduleInputSchema,
    presenceScheduleSchema,
} from "../../sources/presence/PresenceSchedule.js";
import { presenceEventSchema } from "../../sources/presence/PresenceEvent.js";

const focus: PresenceDefinition = {
    id: "focus",
    status: "custom",
    title: "Focus",
    emoji: "🎧",
    prompt: "Continue without waiting unless an answer is essential.",
    answerWaitMs: 15 * 60 * 1000,
};

describe("presence schemas and pure contracts", () => {
    it("accepts every documented boundary and rejects values just outside it", () => {
        expect(
            Value.Check(presenceDefinitionSchema, {
                id: "i".repeat(MAX_PRESENCE_ID_LENGTH),
                status: "custom",
                title: "t".repeat(MAX_PRESENCE_TITLE_LENGTH),
                emoji: "e".repeat(MAX_PRESENCE_EMOJI_LENGTH),
                prompt: "p".repeat(MAX_PRESENCE_PROMPT_LENGTH),
                answerWaitMs: MAX_PRESENCE_TIMESTAMP,
            }),
        ).toBe(true);
        expect(
            Value.Check(presenceDefinitionSchema, {
                ...focus,
                id: "i".repeat(MAX_PRESENCE_ID_LENGTH + 1),
            }),
        ).toBe(false);
        expect(
            Value.Check(presenceDefinitionSchema, {
                ...focus,
                title: "t".repeat(MAX_PRESENCE_TITLE_LENGTH + 1),
            }),
        ).toBe(false);
        expect(
            Value.Check(presenceDefinitionSchema, {
                ...focus,
                emoji: "e".repeat(MAX_PRESENCE_EMOJI_LENGTH + 1),
            }),
        ).toBe(false);
        expect(
            Value.Check(presenceDefinitionSchema, {
                ...focus,
                prompt: "p".repeat(MAX_PRESENCE_PROMPT_LENGTH + 1),
            }),
        ).toBe(false);
        expect(
            Value.Check(presenceDefinitionSchema, {
                ...focus,
                answerWaitMs: MAX_PRESENCE_TIMESTAMP + 1,
            }),
        ).toBe(false);
        expect(
            Value.Check(presenceStoredStateSchema, {
                presenceId: "focus",
                message: "m".repeat(MAX_PRESENCE_MESSAGE_LENGTH),
                effectiveFrom: 0,
                expiresAt: MAX_PRESENCE_TIMESTAMP,
            }),
        ).toBe(true);
        expect(
            Value.Check(presenceStoredStateSchema, {
                presenceId: "focus",
                message: "m".repeat(MAX_PRESENCE_MESSAGE_LENGTH + 1),
            }),
        ).toBe(false);
    });

    it("keeps the built-in catalog complete and rejects duplicate custom identities", () => {
        expect(BUILT_IN_PRESENCES).toEqual([
            ONLINE_PRESENCE,
            AWAY_PRESENCE,
            expect.objectContaining({ id: "offline", status: "offline" }),
            expect.objectContaining({ id: "dnd", status: "dnd" }),
        ]);
        expect(() => assertPresenceCatalog([focus, { ...focus, title: "Duplicate" }])).toThrow(
            "duplicate IDs",
        );
        expect(() => assertPresenceCatalog([{ ...focus, id: "" }])).toThrow("invalid");
    });

    it("rejects impossible timing, expiry, and fallback relationships", () => {
        expect(() =>
            assertPresenceStoredState({
                presenceId: "focus",
                effectiveFrom: 100,
                expiresAt: 100,
            }),
        ).toThrow("expiry must be after");
        expect(() =>
            assertPresenceMutationInput({
                presenceId: "focus",
                effectiveFrom: 101,
                expiresAt: 100,
            }),
        ).toThrow("expiry must be after");
        expect(() =>
            assertTemporaryPresenceInput({
                presenceId: "focus",
                expiresAt: 100,
                effectiveFrom: 101,
            }),
        ).toThrow("expiry must be after");
        expect(() =>
            assertPresenceMutationInput({
                presenceId: "focus",
                fallbackPresenceId: "online",
                fallback: { presenceId: "away" },
            }),
        ).not.toThrow();
        expect(() =>
            assertPresenceState({
                presenceId: "focus",
                status: "custom",
                title: focus.title,
                emoji: focus.emoji,
                prompt: focus.prompt,
                answerWaitMs: focus.answerWaitMs,
                expiresAt: 100,
                changesAt: 99,
            }),
        ).toThrow("changesAt");
        expect(() =>
            assertPresenceState({
                presenceId: "focus",
                status: "custom",
                title: focus.title,
                emoji: focus.emoji,
                prompt: focus.prompt,
                answerWaitMs: focus.answerWaitMs,
                fallbackPresenceId: "online",
                fallback: { status: "away" },
            }),
        ).toThrow("fallback identity");
    });

    it("requires temporary and model inputs to use their distinct contracts", () => {
        expect(
            Value.Check(temporaryPresenceInputSchema, {
                presenceId: "focus",
                expiresAt: 10,
            }),
        ).toBe(true);
        expect(
            Value.Check(temporaryPresenceInputSchema, {
                presenceId: "focus",
            }),
        ).toBe(false);
        expect(
            Value.Check(presenceMutationInputSchema, {
                presenceId: "focus",
                expiresAt: 10,
            }),
        ).toBe(true);
        expect(
            Value.Check(presenceToolInputSchema, {
                presenceId: "focus",
                until: 10,
            }),
        ).toBe(true);
        expect(
            Value.Check(presenceToolInputSchema, {
                presenceId: "focus",
                expiresAt: 10,
            }),
        ).toBe(false);
        expect(() => assertTemporaryPresenceInput({ presenceId: "focus" })).toThrow("invalid");
    });

    it("normalizes the full model instruction while retaining bounded status text", () => {
        expect(
            formatPresenceInstruction({
                presenceId: "focus",
                status: "custom",
                title: " Focus ",
                emoji: " 🎧 ",
                prompt: " Keep working. ",
                answerWaitMs: 0,
                message: "In a meeting",
            }),
        ).toBe(
            "Current user presence: Focus   🎧. The user's status message is: In a meeting. Keep working.",
        );
    });

    it("validates schedule shape and rejects duplicate days or malformed times", () => {
        const valid = {
            days: [1, 3],
            startTime: "09:00",
            endTime: "17:00",
            timeZone: "UTC",
            presence: { status: "away" as const },
        };
        expect(Value.Check(presenceScheduleInputSchema, valid)).toBe(true);
        expect(Value.Check(presenceScheduleSchema, { id: "s", ...valid })).toBe(true);
        assertPresenceScheduleInput(valid);
        assertPresenceSchedule({ id: "s", ...valid });
        expect(
            Value.Check(presenceScheduleInputSchema, {
                ...valid,
                days: [1, 1],
            }),
        ).toBe(false);
        expect(
            Value.Check(presenceScheduleInputSchema, {
                ...valid,
                startTime: "9:00",
            }),
        ).toBe(false);
        expect(() =>
            assertPresenceScheduleInput({
                ...valid,
                endTime: "25:00",
            }),
        ).toThrow("invalid");
    });

    it("validates event payloads as closed, discriminated records", () => {
        expect(
            Value.Check(presenceEventSchema, {
                type: "presence_schedule_cleared",
                eventId: "event-1",
                at: 100,
                scheduleId: "schedule-1",
            }),
        ).toBe(true);
        expect(
            Value.Check(presenceEventSchema, {
                type: "presence_schedule_cleared",
                eventId: "event-1",
                at: 100,
                scheduleId: "schedule-1",
                extra: true,
            }),
        ).toBe(false);
    });
});
