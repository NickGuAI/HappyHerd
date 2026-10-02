import type { ProviderUsageWindow } from "@/core/ProviderUsage.js";

/** Reads optional JSON metadata without letting it invalidate a primary response. */
export async function optionalResponseJson(response: Response | null): Promise<unknown | null> {
    if (response === null || !response.ok) return null;
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/** A percentage a vendor reported, or null when the value is missing or absurd. */
export function usagePercent(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
        ? value
        : null;
}

/** Epoch milliseconds from a vendor's epoch-seconds field. */
export function epochMsFromSeconds(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.round(value * 1_000)
        : null;
}

/** Epoch milliseconds from a vendor's ISO 8601 timestamp. */
export function epochMsFromIso(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Builds a window, or returns null when the vendor gave no usable percentage.
 * A window without a percentage says nothing, so it is better left unknown
 * than reported as zero.
 */
export function providerUsageWindow(options: {
    usedPercent: unknown;
    resetsAt?: number | null;
    startsAt?: number | null;
    durationMs?: number | null;
}): ProviderUsageWindow | null {
    const percent = usagePercent(options.usedPercent);
    if (percent === null) return null;
    return {
        usedPercent: percent,
        resetsAt: options.resetsAt ?? null,
        startsAt: options.startsAt ?? null,
        durationMs: options.durationMs ?? null,
    };
}

/** Turns a vendor's plan identifier into something a person would read. */
export function providerPlanName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const spaced = trimmed
        .replace(/[_-]+/gu, " ")
        // Split camel case both ways, so "XPremium" reads as "X Premium".
        .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
        .trim();
    return spaced
        .split(/\s+/u)
        .map((word) =>
            word.toUpperCase() === word && word.length <= 3
                ? word
                : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
}
