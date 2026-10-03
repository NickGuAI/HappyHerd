import { z } from 'zod';
import { readDaemonState } from '@/persistence';

export const SessionTransportErrorCodeSchema = z.enum(['dns', 'http', 'connect', 'closed', 'recovery-timeout', 'unknown']);
export type SessionTransportErrorCode = z.infer<typeof SessionTransportErrorCodeSchema>;
export const SessionTransportStateSchema = z.object({
    state: z.enum(['connected', 'disconnected', 'reconnecting', 'error']),
    endpoint: z.string(),
    errorCode: SessionTransportErrorCodeSchema.optional(),
    updatedAt: z.number(),
    httpStatus: z.number().int().optional(),
});
export const SessionTransportRecoveryResultSchema = z.object({
    id: z.string(), state: z.enum(['succeeded', 'failed']), errorCode: SessionTransportErrorCodeSchema.optional(),
});
export const SessionTransportExchangeRequestSchema = z.object({
    sessionId: z.string(), pid: z.number().int().positive(), transport: SessionTransportStateSchema,
    recovery: SessionTransportRecoveryResultSchema.optional(),
});
export const SessionTransportRecoveryCommandSchema = z.object({ id: z.string(), endpoint: z.string().url() });
export const SessionTransportExchangeResponseSchema = z.object({ recovery: SessionTransportRecoveryCommandSchema.optional() });
export type SessionTransportState = z.infer<typeof SessionTransportStateSchema>;
export type SessionTransportExchangeRequest = z.infer<typeof SessionTransportExchangeRequestSchema>;
export type SessionTransportRecoveryResult = z.infer<typeof SessionTransportRecoveryResultSchema>;
export type SessionTransportRecoveryCommand = z.infer<typeof SessionTransportRecoveryCommandSchema>;

/** Never publish arbitrary exception text, headers, query strings, or credentials. */
export function sessionTransportEndpoint(endpoint: string): string {
    try { const url = new URL(endpoint); return `${url.origin}${url.pathname.replace(/\/$/, '')}`; }
    catch { return 'invalid-endpoint'; }
}
export function sessionTransportHttpStatus(error: unknown): number | undefined {
    const value = error as { response?: { status?: unknown }; context?: { status?: unknown } } | null;
    const status = value?.response?.status ?? value?.context?.status;
    return typeof status === 'number' && status >= 100 && status <= 599 ? status : undefined;
}
export function sessionTransportErrorCode(error: unknown, depth = 0): SessionTransportErrorCode {
    if (depth > 4) return 'unknown';
    const value = error as { code?: string; message?: string; description?: unknown; cause?: unknown; error?: unknown } | null;
    const text = [value?.code, value?.message, typeof value?.description === 'string' ? value.description : ''].join(' ');
    if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(text)) return 'dns';
    if (sessionTransportHttpStatus(error) || /unexpected server response|HTTP \d/i.test(text)) return 'http';
    if (/timeout|ETIMEDOUT/i.test(text)) return 'recovery-timeout';
    if (/closed|disconnect|transport close/i.test(text)) return 'closed';
    for (const nested of [value?.cause, value?.error, value?.description]) {
        if (!nested || typeof nested !== 'object') continue;
        const code = sessionTransportErrorCode(nested, depth + 1);
        if (code !== 'unknown') return code;
    }
    if (/ECONN|websocket|connection|network|fetch failed/i.test(text)) return 'connect';
    return 'unknown';
}
export async function exchangeSessionTransport(request: SessionTransportExchangeRequest) {
    const daemon = await readDaemonState();
    if (!daemon?.httpPort) return {};
    const response = await fetch(`http://127.0.0.1:${daemon.httpPort}/session-transport`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
        signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`Session transport exchange HTTP ${response.status}`);
    return SessionTransportExchangeResponseSchema.parse(await response.json());
}

export const SessionTransportReportSchema = SessionTransportExchangeRequestSchema;
export type SessionTransportReport = SessionTransportExchangeRequest;
export type SessionTransportCommand = SessionTransportRecoveryCommand;

export const SessionTransportStatusSchema = z.object({
    sessionId: z.string(), providerRunning: z.boolean(),
    state: z.enum(['connected', 'disconnected', 'reconnecting', 'error']),
    endpoint: z.string().nullable(), currentEndpoint: z.string(),
    errorCode: z.string().optional(), httpStatus: z.number().int().optional(), recoveryId: z.string().optional(),
    pendingMessages: z.literal('replay-on-reconnect'), canRecover: z.boolean(),
});
export type SessionTransportStatus = z.infer<typeof SessionTransportStatusSchema>;
