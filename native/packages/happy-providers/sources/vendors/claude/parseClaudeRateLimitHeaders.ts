import type { ProviderUsage, ProviderUsageCredits } from "@/core/ProviderUsage.js";
import { epochMsFromSeconds, providerUsageWindow } from "@/core/providerUsageValues.js";

const PREFIX = "anthropic-ratelimit-unified-";

/**
 * Reads Anthropic's unified rate-limit headers, which ride along on every
 * inference response.
 *
 * These headers are account-wide rather than per-model, and unlike the OAuth
 * usage endpoint they need no `user:profile` scope, so they are the only way
 * to observe an inference-only token from `claude setup-token`.
 *
 * Returns null when the response carries no unified headers at all, which is
 * the case for API-key, Bedrock, and Vertex traffic.
 */
export function parseClaudeRateLimitHeaders(
    headers: Headers,
    context: { capturedAt: number; planName?: string | null; providerId: string },
): ProviderUsage | null {
    const status = headers.get(`${PREFIX}status`);
    if (status === null) return null;

    const credits = parseOverageCredits(headers);
    return {
        providerId: context.providerId,
        vendor: "claude",
        capturedAt: context.capturedAt,
        planName: context.planName ?? null,
        // The account-wide verdict already accounts for every window; overage
        // is the one thing that can still keep a rejected account working.
        exhausted: status === "rejected" && credits?.available !== true,
        windows: {
            fiveHour: parseWindow(headers, "5h", 5 * 60 * 60 * 1_000),
            weekly: parseWindow(headers, "7d", 7 * 24 * 60 * 60 * 1_000),
            monthly: null,
        },
        credits,
    };
}

function parseWindow(
    headers: Headers,
    key: "5h" | "7d",
    durationMs: number,
): ProviderUsage["windows"]["fiveHour"] {
    const utilization = headers.get(`${PREFIX}${key}-utilization`);
    if (utilization === null) return null;
    const fraction = Number(utilization);
    if (!Number.isFinite(fraction)) return null;
    const resetsAt = epochMsFromSeconds(Number(headers.get(`${PREFIX}${key}-reset`)));
    return providerUsageWindow({
        // These headers report a fraction of the limit, where the OAuth usage
        // endpoint already reports a percentage.
        usedPercent: fraction * 100,
        resetsAt,
        startsAt: resetsAt === null ? null : resetsAt - durationMs,
        durationMs,
    });
}

/**
 * Overage is Anthropic's pay-past-the-limit credit. It is only spendable when
 * the account is actually allowed to use it, which the disabled reason and the
 * overage status together decide.
 */
function parseOverageCredits(headers: Headers): ProviderUsageCredits | null {
    const status = headers.get(`${PREFIX}overage-status`);
    if (status === null) return null;
    return {
        available: status !== "rejected",
        remainingCents: null,
        unlimited: false,
        usedPercent: null,
    };
}
