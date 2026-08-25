import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockStorageState } = vi.hoisted(() => ({
    mockStorageState: { current: { sessions: {} as Record<string, unknown> } },
}));

vi.mock('@/sync/storage', () => ({
    storage: {
        getState: () => mockStorageState.current,
        setState: (next: { sessions: Record<string, unknown> }) => {
            mockStorageState.current = next;
        },
    },
}));

import { storage } from '@/sync/storage';
import { getAllCommands } from '@/sync/suggestionCommands';
import { HEARTBEAT_COMMAND, formatHeartbeatControlResult } from './heartbeatCommand';

const translate = (key: any, params?: Record<string, string | number>) => (
    params?.usage ? `${String(key)}:${params.usage}` : String(key)
);

const resumableCodex = { flavor: 'codex', codexThreadId: 'thread-one' };

afterEach(() => {
    storage.setState({ sessions: {} });
});

describe('HappyHerd heartbeat command descriptor', () => {
    it('owns exact case-insensitive grammar and elapsed duration aliases', () => {
        expect(HEARTBEAT_COMMAND.parse('/HEARTBEAT status')).toEqual({
            recognized: true, valid: true, action: 'status',
        });
        expect(HEARTBEAT_COMMAND.parse('/hb every 45m Check deployment')).toEqual({
            recognized: true,
            valid: true,
            action: 'set',
            intervalSeconds: 2_700,
            instruction: 'Check deployment',
        });
        expect(HEARTBEAT_COMMAND.parse('/heartbeat every 90 minutes')).toMatchObject({
            recognized: true, valid: true, intervalSeconds: 5_400,
        });
        expect(HEARTBEAT_COMMAND.parse('/heartbeat every 59s')).toEqual({ recognized: true, valid: false });
        expect(HEARTBEAT_COMMAND.parse('/heartbeatfoo')).toEqual({ recognized: false });
        expect(HEARTBEAT_COMMAND.parse('please /heartbeat')).toEqual({ recognized: false });
    });

    it('retains malformed or rich input, clears success, and retains RPC failure', async () => {
        const control = vi.fn().mockResolvedValue({
            heartbeat: null,
            currentRun: null,
            lastRun: null,
            deliveryState: null,
            queuedAhead: null,
            observedAt: '2026-08-25T00:00:00.000Z',
        });
        await expect(HEARTBEAT_COMMAND.dispatch({
            text: '/heartbeat nonsense', machineId: 'machine-one', sessionId: 'session-one',
            metadata: resumableCodex, hasAttachments: false, hasWorkspaceContext: false,
            translate, control,
        })).resolves.toMatchObject({ handled: true, clearComposer: false });
        await expect(HEARTBEAT_COMMAND.dispatch({
            text: '/heartbeat status', machineId: 'machine-one', sessionId: 'session-one',
            metadata: resumableCodex, hasAttachments: true, hasWorkspaceContext: false,
            translate, control,
        })).resolves.toMatchObject({ handled: true, clearComposer: false });
        await expect(HEARTBEAT_COMMAND.dispatch({
            text: '/heartbeat status', machineId: 'machine-one', sessionId: 'session-one',
            metadata: resumableCodex, hasAttachments: false, hasWorkspaceContext: false,
            translate, control,
        })).resolves.toMatchObject({ handled: true, clearComposer: true });
        control.mockRejectedValueOnce(new Error('offline'));
        await expect(HEARTBEAT_COMMAND.dispatch({
            text: '/heartbeat pause', machineId: 'machine-one', sessionId: 'session-one',
            metadata: resumableCodex, hasAttachments: false, hasWorkspaceContext: false,
            translate, control,
        })).rejects.toThrow('offline');
    });

    it('formats current queue state, last actual delivery, next countdown, and instruction', () => {
        const statusTranslate = (key: any, params?: Record<string, string | number>) => (
            `${String(key)}${params ? `:${JSON.stringify(params)}` : ''}`
        );
        const message = formatHeartbeatControlResult({
            heartbeat: {
                schemaVersion: 3,
                runtimeOwner: 'happyherd',
                id: '11111111-1111-4111-8111-111111111111',
                machineId: 'machine-one',
                name: 'Session heartbeat',
                kind: 'heartbeat',
                instruction: 'Continue the current task if it remains unfinished and actionable.',
                schedule: null,
                timezone: 'UTC',
                workspace: '/srv/app',
                rail: 'codex',
                commanderId: null,
                status: 'active',
                maxRetries: 0,
                tags: [],
                targetSessionId: 'session-one',
                intervalSeconds: 3_600,
                nextDueAt: '2026-08-25T00:45:00.000Z',
                createdAt: '2026-08-24T00:00:00.000Z',
                updatedAt: '2026-08-25T00:00:00.000Z',
                lastScheduledAt: '2026-08-25T00:00:00.000Z',
                lastRunAt: '2026-08-25T00:00:00.000Z',
            },
            currentRun: {
                id: '22222222-2222-4222-8222-222222222222',
                automationId: '11111111-1111-4111-8111-111111111111',
                source: 'schedule',
                scheduledFor: '2026-08-25T00:15:00.000Z',
                startedAt: '2026-08-25T00:15:00.000Z',
                finishedAt: null,
                status: 'running',
                attempt: 1,
                sessionId: null,
                message: 'Heartbeat is queued in the target session.',
            },
            lastRun: {
                id: '33333333-3333-4333-8333-333333333333',
                automationId: '11111111-1111-4111-8111-111111111111',
                source: 'schedule',
                scheduledFor: '2026-08-25T00:00:00.000Z',
                startedAt: '2026-08-25T00:00:05.000Z',
                finishedAt: '2026-08-25T00:05:00.000Z',
                status: 'completed',
                attempt: 1,
                sessionId: 'session-one',
                message: null,
            },
            deliveryState: 'queued',
            queuedAhead: 2,
            observedAt: '2026-08-25T00:15:00.000Z',
        }, statusTranslate);

        expect(message).toContain('happyHerd.heartbeat.delivery.queued');
        expect(message).toContain('happyHerd.heartbeat.queuedAhead:{"count":2}');
        expect(message).toContain('happyHerd.heartbeat.delivery.completed');
        expect(message).toContain('30m');
        expect(message).toContain('happyHerd.heartbeat.standardContinuation');
    });

    it('reserves collisions only for resumable Claude/Codex sessions', async () => {
        const control = vi.fn();
        await expect(HEARTBEAT_COMMAND.dispatch({
            text: '/heartbeat', machineId: 'machine-one', sessionId: 'session-one',
            metadata: { flavor: 'grok' }, hasAttachments: false, hasWorkspaceContext: false,
            translate, control,
        })).resolves.toEqual({ handled: false, clearComposer: false });
        expect(control).not.toHaveBeenCalled();

        const sessionBase = {
            id: 'session-one', seq: 1, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
            metadataVersion: 1, agentState: null, agentStateVersion: 1, thinking: false,
            thinkingAt: 1, presence: 'online' as const,
        };
        storage.setState({
            sessions: {
                'session-one': {
                    ...sessionBase,
                    metadata: { ...resumableCodex, slashCommands: ['/heartbeat', '/HB', 'custom'] } as any,
                },
            },
        });
        expect(getAllCommands('session-one', translate).filter((item) => ['heartbeat', 'hb'].includes(item.command.toLowerCase())))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ command: 'heartbeat' }),
                expect.objectContaining({ command: 'hb' }),
            ]));

        storage.setState({
            sessions: {
                'session-one': {
                    ...sessionBase,
                    metadata: { flavor: 'grok', slashCommands: ['/heartbeat', '/HB'] } as any,
                },
            },
        });
        expect(getAllCommands('session-one', translate).map((item) => item.command)).toEqual(expect.arrayContaining(['heartbeat', 'HB']));
    });
});
