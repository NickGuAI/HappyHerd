import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findSession: vi.fn(),
    findUsage: vi.fn(),
    upsertUsage: vi.fn(),
    emitEphemeral: vi.fn(),
}));

vi.mock('@/storage/db', () => ({
    db: {
        session: { findFirst: mocks.findSession },
        usageReport: {
            findUnique: mocks.findUsage,
            upsert: mocks.upsertUsage,
        },
    },
}));

vi.mock('@/app/events/eventRouter', () => ({
    buildUsageEphemeral: vi.fn(() => ({ type: 'usage' })),
    eventRouter: { emitEphemeral: mocks.emitEphemeral },
}));

vi.mock('@/utils/log', () => ({ log: vi.fn() }));

import { usageHandler } from './usageHandler';

describe('usageHandler socket persistence', () => {
    it('acknowledges an idempotent retry under the session key without moving its occurrence time', async () => {
        const handlers = new Map<string, (...args: any[]) => Promise<void>>();
        const socket = {
            data: { sessionId: 'session-1' },
            on: vi.fn((event: string, handler: (...args: any[]) => Promise<void>) => handlers.set(event, handler)),
        };
        const originalOccurrence = 1_788_436_800_000;
        mocks.findSession.mockResolvedValue({ id: 'session-1' });
        mocks.findUsage.mockResolvedValue({
            id: 'report-1',
            createdAt: new Date(originalOccurrence + 1_000),
            data: { occurredAt: originalOccurrence },
        });
        mocks.upsertUsage.mockImplementation(async ({ update }: any) => ({
            id: 'report-1',
            createdAt: new Date(originalOccurrence + 1_000),
            updatedAt: update.updatedAt,
        }));
        usageHandler('account-1', socket as never);
        const callback = vi.fn();

        await handlers.get('usage-report')?.({
            key: 'usage-v2:codex:thread:turn:snapshot',
            sessionId: 'session-1',
            provider: 'codex',
            model: 'gpt-5.6-sol',
            source: 'codex-thread-token-usage',
            occurredAt: originalOccurrence + 60_000,
            tokens: { total: 50, input: 40, output: 10 },
            cost: { total: 0 },
            costBasis: 'unavailable',
            tokensAvailable: true,
            costAvailable: false,
            limitations: ['cost-not-reported-by-provider'],
        }, callback);

        expect(mocks.upsertUsage).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                accountId_sessionId_key: {
                    accountId: 'account-1',
                    sessionId: 'session-1',
                    key: 'usage-v2:codex:thread:turn:snapshot',
                },
            },
            update: expect.objectContaining({
                data: expect.objectContaining({ occurredAt: originalOccurrence }),
            }),
        }));
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({ success: true, reportId: 'report-1' }));
        expect(mocks.emitEphemeral).toHaveBeenCalledOnce();
    });
});
