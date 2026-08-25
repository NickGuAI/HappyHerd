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
import { HEARTBEAT_COMMAND } from './heartbeatCommand';

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
