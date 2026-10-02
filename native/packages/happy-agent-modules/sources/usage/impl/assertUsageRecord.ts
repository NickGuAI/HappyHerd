import { Value } from "@sinclair/typebox/value";

import {
    usageRecordSchema,
    usageTokensSchema,
    type UsageRecord,
    type UsageTokens,
} from "../Usage.js";

/**
 * Everything one usage record must be true about itself.
 *
 * The shape alone is not enough: a record whose duration disagrees with its own timestamps is
 * structurally fine and semantically a lie, and once summed it becomes a total nobody can trace
 * back. Every path that turns stored bytes into a record — a page read and an aggregate read
 * alike — goes through this, so an unusable row is refused rather than counted.
 */
export function assertUsageRecord(value: unknown): asserts value is UsageRecord {
    if (!Value.Check(usageRecordSchema, value)) {
        throw new Error("Usage record is invalid.");
    }
    if (value.finishedAt < value.startedAt) {
        throw new Error("Usage record timestamps are out of order.");
    }
    if (value.durationMs !== value.finishedAt - value.startedAt) {
        throw new Error("Usage record duration does not match its timestamps.");
    }
    if (value.kind === "inference") {
        assertUsageTokens(value.tokens);
    }
}

/** The provider token counts a recorded inference must carry. */
export function assertUsageTokens(value: unknown): asserts value is UsageTokens {
    if (!Value.Check(usageTokensSchema, value)) {
        throw new Error("Usage provider token counts are invalid.");
    }
}
