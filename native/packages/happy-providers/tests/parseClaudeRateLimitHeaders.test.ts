import { describe, expect, it } from "vitest";

import { parseClaudeRateLimitHeaders } from "@/vendors/claude/parseClaudeRateLimitHeaders.js";

const context = { capturedAt: 1_000, providerId: "kirill_claude" };

describe("parseClaudeRateLimitHeaders", () => {
    it("reports the same percentages Claude shows the user", () => {
        // Captured from a live response for an account Claude's own usage
        // dialog showed as 15% of the session and 42% of the week.
        const usage = parseClaudeRateLimitHeaders(
            new Headers({
                "anthropic-ratelimit-unified-status": "allowed",
                "anthropic-ratelimit-unified-5h-utilization": "0.15",
                "anthropic-ratelimit-unified-5h-reset": "1785559800",
                "anthropic-ratelimit-unified-7d-utilization": "0.42",
                "anthropic-ratelimit-unified-7d-reset": "1785844800",
            }),
            context,
        );

        expect(usage?.windows.fiveHour?.usedPercent).toBe(15);
        expect(usage?.windows.weekly?.usedPercent).toBe(42);
    });

    it("reads a fully consumed window as one hundred percent", () => {
        const usage = parseClaudeRateLimitHeaders(
            new Headers({
                "anthropic-ratelimit-unified-status": "rejected",
                "anthropic-ratelimit-unified-7d-utilization": "1",
            }),
            context,
        );

        expect(usage?.windows.weekly?.usedPercent).toBe(100);
        expect(usage?.exhausted).toBe(true);
    });

    it("turns the reset header into a millisecond timestamp", () => {
        const usage = parseClaudeRateLimitHeaders(
            new Headers({
                "anthropic-ratelimit-unified-status": "allowed",
                "anthropic-ratelimit-unified-5h-utilization": "0.5",
                "anthropic-ratelimit-unified-5h-reset": "1785559800",
            }),
            context,
        );

        expect(usage?.windows.fiveHour?.resetsAt).toBe(1_785_559_800_000);
        expect(usage?.windows.fiveHour?.durationMs).toBe(5 * 60 * 60 * 1_000);
    });

    it("keeps an account with usable overage out of the exhausted state", () => {
        const usage = parseClaudeRateLimitHeaders(
            new Headers({
                "anthropic-ratelimit-unified-status": "rejected",
                "anthropic-ratelimit-unified-overage-status": "allowed",
                "anthropic-ratelimit-unified-7d-utilization": "1",
            }),
            context,
        );

        expect(usage?.credits?.available).toBe(true);
        expect(usage?.exhausted).toBe(false);
    });

    it("returns nothing when the response carries no unified headers", () => {
        expect(parseClaudeRateLimitHeaders(new Headers(), context)).toBeNull();
    });

    it("ignores a window whose utilization is not a number", () => {
        const usage = parseClaudeRateLimitHeaders(
            new Headers({
                "anthropic-ratelimit-unified-status": "allowed",
                "anthropic-ratelimit-unified-5h-utilization": "unknown",
            }),
            context,
        );

        expect(usage?.windows.fiveHour).toBeNull();
    });
});
