import { describe, expect, it } from "vitest";

import {
    AGENT_MESSAGE_ORIGIN_METADATA,
    MESSAGE_ORIGIN_METADATA_KEY,
    SENDER_AGENT_ID_METADATA_KEY,
    USER_MESSAGE_ORIGIN_METADATA,
    isUserOriginMetadata,
    senderAgentIdMetadata,
    senderAgentIdOf,
} from "../../sources/impl/messageOrigin.js";

describe("message origin metadata", () => {
    it("exports frozen, exact origin stamps", () => {
        expect(USER_MESSAGE_ORIGIN_METADATA).toEqual({
            [MESSAGE_ORIGIN_METADATA_KEY]: "user",
        });
        expect(AGENT_MESSAGE_ORIGIN_METADATA).toEqual({
            [MESSAGE_ORIGIN_METADATA_KEY]: "agent",
        });
        expect(Object.isFrozen(USER_MESSAGE_ORIGIN_METADATA)).toBe(true);
        expect(Object.isFrozen(AGENT_MESSAGE_ORIGIN_METADATA)).toBe(true);
    });

    it("requires an explicit user marker and fails closed for every other value", () => {
        expect(isUserOriginMetadata(undefined)).toBe(false);
        expect(isUserOriginMetadata({})).toBe(false);
        expect(isUserOriginMetadata({ [MESSAGE_ORIGIN_METADATA_KEY]: "agent" })).toBe(false);
        expect(isUserOriginMetadata({ [MESSAGE_ORIGIN_METADATA_KEY]: "" })).toBe(false);
        expect(isUserOriginMetadata({ [MESSAGE_ORIGIN_METADATA_KEY]: true })).toBe(false);
        expect(isUserOriginMetadata(USER_MESSAGE_ORIGIN_METADATA)).toBe(true);
    });

    it("does not treat an inherited marker as an explicit provenance stamp", () => {
        const inherited = Object.create({
            [MESSAGE_ORIGIN_METADATA_KEY]: "user",
        }) as Record<string, unknown>;

        expect(isUserOriginMetadata(inherited as never)).toBe(false);
    });

    it("round-trips valid sender IDs and does not confuse attribution with authorization", () => {
        const metadata = senderAgentIdMetadata("agent-123");

        expect(metadata).toEqual({ [SENDER_AGENT_ID_METADATA_KEY]: "agent-123" });
        expect(Object.isFrozen(metadata)).toBe(true);
        expect(senderAgentIdOf(metadata)).toBe("agent-123");
        expect(isUserOriginMetadata(metadata)).toBe(false);
    });

    it("accepts the complete bounded sender ID range", () => {
        const max = "a".repeat(256);

        expect(senderAgentIdMetadata("a")).toEqual({ senderAgentId: "a" });
        expect(senderAgentIdMetadata(max)).toEqual({ senderAgentId: max });
        expect(senderAgentIdOf({ senderAgentId: max })).toBe(max);
    });

    it.each([
        ["", "empty"],
        ["a".repeat(257), "too long"],
        ["has\nnewline", "newline"],
        ["has\rcarriage return", "carriage return"],
        ["has\u0000nul", "NUL"],
    ])("rejects a sender ID containing %s", (value, _description) => {
        expect(() => senderAgentIdMetadata(value)).toThrow(
            "The sender agent ID is not a valid metadata value.",
        );
    });

    it("returns undefined for malformed sender attribution without throwing", () => {
        expect(senderAgentIdOf(undefined)).toBeUndefined();
        expect(senderAgentIdOf({ senderAgentId: "" })).toBeUndefined();
        expect(senderAgentIdOf({ senderAgentId: "a".repeat(257) })).toBeUndefined();
        expect(senderAgentIdOf({ senderAgentId: "has\nnewline" })).toBeUndefined();
        expect(senderAgentIdOf({ senderAgentId: 123 })).toBeUndefined();
        expect(senderAgentIdOf({ senderAgentId: null })).toBeUndefined();
    });
});
