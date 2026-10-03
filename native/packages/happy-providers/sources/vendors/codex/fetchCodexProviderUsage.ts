import type { ProviderUsage, ProviderUsageCredits } from "@/core/ProviderUsage.js";
import {
    epochMsFromSeconds,
    providerPlanName,
    providerUsageWindow,
} from "@/core/providerUsageValues.js";
import { CodexSessionCredential } from "@/vendors/codex/CodexSessionCredential.js";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchCodexProviderUsageOptions {
    authPath?: string;
    baseUrl?: string;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof fetch;
    now?: () => number;
    providerId?: string;
    timeoutMs?: number;
}

/**
 * Reads one Codex account's usage from the ChatGPT backend.
 *
 * Returns null when the account cannot be read at all, which keeps "we do not
 * know" distinct from "nothing is left".
 */
export async function fetchCodexProviderUsage(
    options: FetchCodexProviderUsageOptions = {},
): Promise<ProviderUsage | null> {
    const now = options.now ?? Date.now;
    try {
        const credential = await CodexSessionCredential.tryLoad({
            ...(options.authPath === undefined ? {} : { authFile: options.authPath }),
            ...(options.env === undefined ? {} : { env: options.env }),
        });
        if (credential === null) return null;

        const headers = new Headers({
            authorization: `Bearer ${credential.credential.accessToken}`,
        });
        if (credential.credential.accountId !== undefined) {
            headers.set("chatgpt-account-id", credential.credential.accountId);
        }

        const baseUrl = (options.baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/u, "");
        const response = await (options.fetch ?? fetch)(`${baseUrl}/wham/usage`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok) return null;

        return parseCodexProviderUsage(await response.json(), {
            capturedAt: now(),
            providerId: options.providerId ?? "codex",
        });
    } catch {
        return null;
    }
}

interface CodexWindowPayload {
    limit_window_seconds?: unknown;
    reset_at?: unknown;
    used_percent?: unknown;
}

interface CodexUsagePayload {
    plan_type?: unknown;
    rate_limit_reached_type?: { type?: unknown } | null;
    rate_limit?: {
        allowed?: unknown;
        limit_reached?: unknown;
        primary_window?: CodexWindowPayload | null;
        secondary_window?: CodexWindowPayload | null;
    } | null;
    credits?: {
        balance?: unknown;
        has_credits?: unknown;
        unlimited?: unknown;
    } | null;
    spend_control?: { reached?: unknown } | null;
}

export function parseCodexProviderUsage(
    payload: unknown,
    context: { capturedAt: number; providerId: string },
): ProviderUsage {
    const body = (payload ?? {}) as CodexUsagePayload;
    const credits = parseCodexCredits(body.credits);
    return {
        providerId: context.providerId,
        vendor: "codex",
        capturedAt: context.capturedAt,
        planName: providerPlanName(body.plan_type),
        // Credits outlive an exhausted window: an account with money left can
        // still work even though the rate limit says it is finished.
        exhausted:
            hasCodexHardExhaustion(body) ||
            (body.rate_limit?.limit_reached === true && credits?.available !== true),
        windows: parseCodexWindows([
            body.rate_limit?.primary_window,
            body.rate_limit?.secondary_window,
        ]),
        credits,
    };
}

function hasCodexHardExhaustion(body: CodexUsagePayload): boolean {
    if (body.spend_control?.reached === true) return true;
    const reachedType = body.rate_limit_reached_type?.type;
    return (
        reachedType === "workspace_owner_credits_depleted" ||
        reachedType === "workspace_member_credits_depleted" ||
        reachedType === "workspace_owner_usage_limit_reached" ||
        reachedType === "workspace_member_usage_limit_reached"
    );
}

function parseCodexWindows(
    payloads: readonly (CodexWindowPayload | null | undefined)[],
): ProviderUsage["windows"] {
    const windows: ProviderUsage["windows"] = { fiveHour: null, weekly: null, monthly: null };
    for (const payload of payloads) {
        if (payload == null) continue;
        const durationSeconds = payload.limit_window_seconds;
        if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)) continue;
        const name = codexWindowName(durationSeconds);
        if (name === null) continue;
        const resetsAt = epochMsFromSeconds(payload.reset_at);
        const durationMs = Math.round(durationSeconds * 1_000);
        windows[name] = providerUsageWindow({
            usedPercent: payload.used_percent,
            resetsAt,
            startsAt: resetsAt === null ? null : resetsAt - durationMs,
            durationMs,
        });
    }
    return windows;
}

function codexWindowName(durationSeconds: number): keyof ProviderUsage["windows"] | null {
    if (durationMatches(durationSeconds, 5 * 60 * 60)) return "fiveHour";
    if (durationMatches(durationSeconds, 7 * 24 * 60 * 60)) return "weekly";
    if (durationMatches(durationSeconds, 30 * 24 * 60 * 60)) return "monthly";
    return null;
}

function durationMatches(actualSeconds: number, expectedSeconds: number): boolean {
    return Math.abs(actualSeconds - expectedSeconds) <= expectedSeconds * 0.05;
}

function parseCodexCredits(payload: CodexUsagePayload["credits"]): ProviderUsageCredits | null {
    if (payload == null) return null;
    const unlimited = payload.unlimited === true;
    // The balance arrives as a decimal string of dollars.
    const balance = typeof payload.balance === "string" ? Number(payload.balance) : Number.NaN;
    const remainingCents = Number.isFinite(balance) ? Math.round(balance * 100) : null;
    const hasCredits = payload.has_credits === true;
    return {
        available: unlimited || (hasCredits && (remainingCents === null || remainingCents > 0)),
        remainingCents: unlimited ? null : remainingCents,
        unlimited,
        usedPercent: null,
    };
}
