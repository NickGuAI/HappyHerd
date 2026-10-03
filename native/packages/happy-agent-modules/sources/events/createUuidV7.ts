import { randomBytes } from "node:crypto";

const RANDOM_BITS = 74n;
const RANDOM_MASK = (1n << RANDOM_BITS) - 1n;
const RAND_B_MASK = (1n << 62n) - 1n;
const MAX_TIMESTAMP = (1n << 48n) - 1n;

/**
 * Creates process-monotonic UUIDv7 identifiers.
 *
 * UUIDv7 puts its millisecond timestamp first, so ordinary string comparison is chronological.
 * Within one millisecond we increment the random tail, preserving that ordering without replacing
 * its process-unique seed with a small counter.
 */
export function createUuidV7Factory(now: () => number = Date.now, after?: string): () => string {
    const initial = after === undefined ? undefined : parseUuidV7(after);
    let lastTimestamp = initial?.timestamp ?? -1n;
    let randomTail = initial?.randomTail ?? 0n;

    return () => {
        let timestamp = BigInt(Math.max(0, Math.trunc(now())));
        if (timestamp < lastTimestamp) timestamp = lastTimestamp;
        if (timestamp === lastTimestamp) {
            randomTail = (randomTail + 1n) & RANDOM_MASK;
            if (randomTail === 0n) timestamp += 1n;
        } else {
            randomTail = random74();
        }
        if (timestamp > MAX_TIMESTAMP) {
            throw new Error("The system clock is outside the UUIDv7 timestamp range.");
        }
        lastTimestamp = timestamp;

        const randA = randomTail >> 62n;
        const randB = randomTail & RAND_B_MASK;
        const value = (timestamp << 80n) | (7n << 76n) | (randA << 64n) | (2n << 62n) | randB;
        const hex = value.toString(16).padStart(32, "0");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
}

function parseUuidV7(value: string): { readonly randomTail: bigint; readonly timestamp: bigint } {
    // Only the canonical hyphenated form is a UUID. Accepting a bare hex string would let a cursor
    // that no other reader can parse resume the sequence.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
        throw new Error("The UUIDv7 high-water mark is invalid.");
    }
    const parsed = BigInt(`0x${value.replaceAll("-", "")}`);
    return {
        randomTail: (((parsed >> 64n) & 0xfffn) << 62n) | (parsed & RAND_B_MASK),
        timestamp: parsed >> 80n,
    };
}

function random74(): bigint {
    const bytes = randomBytes(10);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value & RANDOM_MASK;
}
