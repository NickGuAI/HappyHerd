import { Socket } from "socket.io";
import { AsyncLock } from "@/utils/lock";
import { db } from "@/storage/db";
import { buildUsageEphemeral, eventRouter } from "@/app/events/eventRouter";
import { log } from "@/utils/log";

type NormalizedUsagePayload = {
    key: string;
    sessionId: string;
    usageData: PrismaJson.UsageReportData;
};

type ValidationResult =
    | { success: true; value: NormalizedUsagePayload }
    | { success: false; error: string };

const SUPPORTED_PROVIDERS = new Set(['claude', 'codex', 'grok', 'dsh']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericMap(
    value: unknown,
    options: { integers: boolean },
): Record<string, number> | null {
    if (!isRecord(value) || typeof value.total !== 'number') return null;
    const result: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
        if (options.integers && !Number.isInteger(raw)) return null;
        result[key] = raw;
    }
    return result;
}

export function validateUsagePayload(data: unknown): ValidationResult {
    if (!isRecord(data)) return { success: false, error: 'Invalid payload' };
    if (typeof data.key !== 'string' || data.key.length === 0 || data.key.length > 512) {
        return { success: false, error: 'Invalid key' };
    }
    if (typeof data.sessionId !== 'string' || data.sessionId.length === 0) {
        return { success: false, error: 'Invalid sessionId' };
    }
    const tokens = numericMap(data.tokens, { integers: true });
    if (!tokens) return { success: false, error: 'Invalid tokens object' };
    const cost = numericMap(data.cost, { integers: false });
    if (!cost) return { success: false, error: 'Invalid cost object' };

    const provider = data.provider;
    if (provider !== undefined && (typeof provider !== 'string' || !SUPPORTED_PROVIDERS.has(provider))) {
        return { success: false, error: 'Invalid provider' };
    }
    const model = data.model;
    if (model !== undefined && model !== null && typeof model !== 'string') {
        return { success: false, error: 'Invalid model' };
    }
    const source = data.source;
    if (source !== undefined && (typeof source !== 'string' || source.length === 0)) {
        return { success: false, error: 'Invalid source' };
    }
    const occurredAt = data.occurredAt;
    if (occurredAt !== undefined && (
        typeof occurredAt !== 'number'
        || !Number.isInteger(occurredAt)
        || occurredAt <= 0
    )) {
        return { success: false, error: 'Invalid occurredAt' };
    }
    const costBasis = data.costBasis;
    if (costBasis !== undefined && !['provider-reported', 'provider-estimate', 'unavailable'].includes(String(costBasis))) {
        return { success: false, error: 'Invalid costBasis' };
    }
    const tokensAvailable = data.tokensAvailable;
    if (tokensAvailable !== undefined && typeof tokensAvailable !== 'boolean') {
        return { success: false, error: 'Invalid tokensAvailable' };
    }
    const costAvailable = data.costAvailable;
    if (costAvailable !== undefined && typeof costAvailable !== 'boolean') {
        return { success: false, error: 'Invalid costAvailable' };
    }
    if (tokensAvailable === false && Object.values(tokens).some((value) => value !== 0)) {
        return { success: false, error: 'Unavailable tokens must be zero' };
    }
    if (costAvailable === false && Object.values(cost).some((value) => value !== 0)) {
        return { success: false, error: 'Unavailable cost must be zero' };
    }
    if (costAvailable === false && costBasis !== undefined && costBasis !== 'unavailable') {
        return { success: false, error: 'Unavailable cost must use unavailable basis' };
    }
    if (costAvailable === true && costBasis === 'unavailable') {
        return { success: false, error: 'Available cost must use a reported or estimated basis' };
    }
    const limitations = data.limitations;
    if (limitations !== undefined && (
        !Array.isArray(limitations)
        || limitations.some((limitation) => typeof limitation !== 'string' || limitation.length === 0)
    )) {
        return { success: false, error: 'Invalid limitations' };
    }

    return {
        success: true,
        value: {
            key: data.key,
            sessionId: data.sessionId,
            usageData: {
                tokens: tokens as PrismaJson.UsageReportData['tokens'],
                cost: cost as PrismaJson.UsageReportData['cost'],
                ...(typeof provider === 'string' ? { provider } : {}),
                ...(typeof model === 'string' || model === null ? { model } : {}),
                ...(typeof source === 'string' ? { source } : {}),
                ...(typeof occurredAt === 'number' ? { occurredAt } : {}),
                ...(costBasis === 'provider-reported' || costBasis === 'provider-estimate' || costBasis === 'unavailable'
                    ? { costBasis }
                    : {}),
                ...(typeof tokensAvailable === 'boolean' ? { tokensAvailable } : {}),
                ...(typeof costAvailable === 'boolean' ? { costAvailable } : {}),
                ...(Array.isArray(limitations) ? { limitations: limitations as string[] } : {}),
            },
        },
    };
}

export function usageSessionMatchesSocketScope(reportedSessionId: string, scopedSessionId?: string): boolean {
    return scopedSessionId === undefined || scopedSessionId === reportedSessionId;
}

export function preserveUsageOccurrenceTime(
    incoming: PrismaJson.UsageReportData,
    existing?: { data: unknown; createdAt: Date } | null,
): PrismaJson.UsageReportData {
    if (!existing) return incoming;
    const existingData = existing.data as PrismaJson.UsageReportData;
    return {
        ...incoming,
        occurredAt: existingData.occurredAt ?? existing.createdAt.getTime(),
    };
}

export function usageHandler(userId: string, socket: Socket) {
    const receiveUsageLock = new AsyncLock();
    socket.on('usage-report', async (data: any, callback?: (response: any) => void) => {
        await receiveUsageLock.inLock(async () => {
            try {
                const validated = validateUsagePayload(data);
                if (!validated.success) {
                    callback?.({ success: false, error: validated.error });
                    return;
                }
                const { key, sessionId, usageData } = validated.value;
                const scopedSessionId = socket.data.sessionId as string | undefined;
                if (!usageSessionMatchesSocketScope(sessionId, scopedSessionId)) {
                    callback?.({ success: false, error: 'Session does not match socket scope' });
                    return;
                }

                try {
                    // If sessionId provided, verify it belongs to the user
                    if (sessionId) {
                        const session = await db.session.findFirst({
                            where: {
                                id: sessionId,
                                accountId: userId
                            }
                        });

                        if (!session) {
                            if (callback) {
                                callback({ success: false, error: 'Session not found' });
                            }
                            return;
                        }
                    }

                    // Preserve the first event occurrence across retry/upsert.
                    // Mutable provider snapshots may update their totals, but
                    // a late retry must never move the event into a new period.
                    const existing = await db.usageReport.findUnique({
                        where: {
                            accountId_sessionId_key: {
                                accountId: userId,
                                sessionId,
                                key,
                            },
                        },
                    });
                    const persistedUsageData = preserveUsageOccurrenceTime(usageData, existing);

                    // Upsert the usage report
                    const report = await db.usageReport.upsert({
                        where: {
                            accountId_sessionId_key: {
                                accountId: userId,
                                sessionId,
                                key
                            }
                        },
                        update: {
                            data: persistedUsageData,
                            updatedAt: new Date()
                        },
                        create: {
                            accountId: userId,
                            sessionId,
                            key,
                            data: persistedUsageData
                        }
                    });

                    log({ module: 'websocket' }, `Usage report saved: key=${key}, sessionId=${sessionId || 'none'}, userId=${userId}`);

                    // Emit usage ephemeral update if sessionId is provided
                    if (sessionId) {
                        const usageEvent = buildUsageEphemeral(sessionId, key, persistedUsageData.tokens, persistedUsageData.cost);
                        eventRouter.emitEphemeral({
                            userId,
                            payload: usageEvent,
                            recipientFilter: { type: 'user-scoped-only' }
                        });
                    }

                    if (callback) {
                        callback({
                            success: true,
                            reportId: report.id,
                            createdAt: report.createdAt.getTime(),
                            updatedAt: report.updatedAt.getTime()
                        });
                    }
                } catch (error) {
                    log({ module: 'websocket', level: 'error' }, `Failed to save usage report: ${error}`);
                    if (callback) {
                        callback({ success: false, error: 'Failed to save usage report' });
                    }
                }
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in usage-report handler: ${error}`);
                if (callback) {
                    callback({ success: false, error: 'Internal error' });
                }
            }
        });
    });
}
