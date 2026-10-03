import { describe, expect, it } from "vitest";

import { createUuidV7Factory } from "../../sources/events/createUuidV7.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function formatUuid(hex: string): string {
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join("-");
}

describe("createUuidV7Factory", () => {
    it("generates strict UUIDv7 values in lexical order within one millisecond", () => {
        const create = createUuidV7Factory(() => 1_000);
        const ids = [create(), create(), create(), create()];

        expect(ids.every((id) => uuidPattern.test(id))).toBe(true);
        expect(ids).toEqual([...ids].sort());
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("keeps IDs monotonic across a backwards clock and resumes after a high-water mark", () => {
        let now = 2_000;
        const create = createUuidV7Factory(() => now);
        const first = create();
        now = 1_000;
        const second = create();
        expect(second > first).toBe(true);

        const resumed = createUuidV7Factory(() => 2_000, first);
        const resumedId = resumed();
        expect(resumedId > first).toBe(true);
        expect(uuidPattern.test(resumedId)).toBe(true);
    });

    it("rejects an invalid persisted high-water mark", () => {
        expect(() => createUuidV7Factory(() => 0, "not-a-uuid")).toThrow(
            "UUIDv7 high-water mark is invalid",
        );
        expect(() => createUuidV7Factory(() => 0, "00000000-0000-4000-8000-000000000000")).toThrow(
            "UUIDv7 high-water mark is invalid",
        );
        expect(() => createUuidV7Factory(() => 0, "00000000000070008000000000000000")).toThrow(
            "UUIDv7 high-water mark is invalid",
        );
    });

    it("fails instead of wrapping when the timestamp and random tail are exhausted", () => {
        const maxTimestamp = (1n << 48n) - 1n;
        const timestampHex = maxTimestamp.toString(16).padStart(12, "0");
        const highWater = formatUuid(`${timestampHex}7${"f".repeat(3)}b${"f".repeat(15)}`);
        const create = createUuidV7Factory(() => Number(maxTimestamp), highWater);

        expect(() => create()).toThrow("outside the UUIDv7 timestamp range");
    });
});
