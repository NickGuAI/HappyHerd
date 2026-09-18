import { beforeEach, describe, expect, it, vi } from 'vitest';

const { machineRPC, refreshSessions, getState } = vi.hoisted(() => ({
    machineRPC: vi.fn(),
    refreshSessions: vi.fn(),
    getState: vi.fn(() => ({ sessions: {} })),
}));

const resource = {
    status: 'ok',
    sampledAt: '2026-09-03T10:00:00.000Z',
    cpu: { busyPercent: 25, sampleWindowMs: 250 },
    loadAverage: { oneMinute: 1, fiveMinutes: 2, fifteenMinutes: 3 },
    memory: { usedBytes: 4, totalBytes: 10, availableBytes: 6, swapUsedBytes: 1 },
};

vi.mock('./apiSocket', () => ({
    apiSocket: { machineRPC },
}));

vi.mock('./sync', () => ({
    sync: { refreshSessions },
}));

// ops.ts imports storage (for sessionSetAgentModes), which transitively pulls
// in react-native — mock it out, these tests never touch it.
vi.mock('./storage', () => ({
    storage: { getState },
}));

describe('codex fork ops', () => {
    beforeEach(() => {
        machineRPC.mockReset();
        refreshSessions.mockReset();
        getState.mockReturnValue({ sessions: {} });
    });

    it.each(['claude', 'codex'] as const)('inherits current permission and Commander for %s forks and duplicates', async (provider) => {
        const permissionMode = provider === 'claude' ? 'bypassPermissions' : 'yolo';
        getState.mockReturnValue({ sessions: {
            'happy-source': {
                permissionMode,
                metadata: {
                    commanderId: 'athena',
                    permissionMode: 'default',
                    spawnSettings: { provider, permission: 'default' },
                },
            },
        } });
        machineRPC.mockImplementation(async (_machineId: string, method: string) => method === 'spawn-happy-session'
            ? { type: 'success', sessionId: 'happy-child' }
            : { type: 'success', newClaudeSessionId: 'claude-child', newCodexThreadId: 'codex-child' });
        const { forkAndSpawn } = await import('./ops');
        const source = provider === 'claude'
            ? { kind: provider, sessionId: 'happy-source', machineId: 'machine-1', directory: '/tmp/project', claudeSessionId: 'claude-parent' }
            : { kind: provider, sessionId: 'happy-source', machineId: 'machine-1', directory: '/tmp/project', codexThreadId: 'codex-parent' };

        for (const options of [{}, { cutAfterUuid: 'user-1', cutAfterItemId: 'user-1' }]) {
            await expect(forkAndSpawn(source, options)).resolves.toMatchObject({ type: 'success' });
            expect(machineRPC).toHaveBeenLastCalledWith('machine-1', 'spawn-happy-session', expect.objectContaining({
                agent: provider,
                directory: '/tmp/project',
                permissionMode,
                commanderId: 'athena',
                parentSessionId: 'happy-source',
            }));
        }
    });

    it('passes new-session mode defaults through spawn RPC', async () => {
        machineRPC.mockResolvedValue({ type: 'success', sessionId: 'happy-new' });

        const { machineSpawnNewSession } = await import('./ops');
        const result = await machineSpawnNewSession({
            machineId: 'machine-1',
            directory: '/tmp/project',
            agent: 'claude',
            permissionMode: 'bypassPermissions',
            modelMode: 'opus',
            effortLevel: 'xhigh',
            commanderId: 'athena',
        });

        expect(result).toEqual({ type: 'success', sessionId: 'happy-new' });
        expect(machineRPC).toHaveBeenCalledWith(
            'machine-1',
            'spawn-happy-session',
            expect.objectContaining({
                directory: '/tmp/project',
                agent: 'claude',
                permissionMode: 'bypassPermissions',
                modelMode: 'opus',
                effortLevel: 'xhigh',
                commanderId: 'athena',
            }),
        );
    });

    it.each([
        { receipt: { provider: 'claude', permission: 'dontAsk' }, metadataPermission: 'default', expected: 'dontAsk' },
        { receipt: undefined, metadataPermission: 'acceptEdits', expected: 'acceptEdits' },
        { receipt: { provider: 'codex', permission: 'yolo' }, metadataPermission: 'acceptEdits', expected: 'acceptEdits' },
        { receipt: { provider: 'claude', permission: null }, metadataPermission: 'bypassPermissions', expected: undefined },
    ])('resolves missing local permission from the matching receipt or legacy metadata: $expected', async ({ receipt, metadataPermission, expected }) => {
        getState.mockReturnValue({ sessions: {
            parent: { permissionMode: null, metadata: { permissionMode: metadataPermission, spawnSettings: receipt } },
        } });
        machineRPC.mockResolvedValueOnce({ type: 'success', newClaudeSessionId: 'child' })
            .mockResolvedValueOnce({ type: 'success', sessionId: 'happy-child' });
        const { forkAndSpawn } = await import('./ops');
        await forkAndSpawn({ sessionId: 'parent', machineId: 'machine-1', directory: '/tmp/project', claudeSessionId: 'source' });
        expect(machineRPC).toHaveBeenLastCalledWith('machine-1', 'spawn-happy-session', expect.objectContaining({
            permissionMode: expected,
            commanderId: undefined,
        }));
    });

    it('routes automation CRUD through encrypted machine RPC methods', async () => {
        machineRPC.mockResolvedValueOnce({ automations: [] });
        const { machineListAutomations, machineCreateAutomation, machineUpdateAutomation } = await import('./ops');

        await machineListAutomations('machine-1');
        expect(machineRPC).toHaveBeenNthCalledWith(1, 'machine-1', 'happyherd-automations-list', {});

        const input = {
            name: 'Daily',
            kind: 'scheduled' as const,
            instruction: 'Review.',
            schedule: '0 8 * * *',
            timezone: 'UTC',
            workspace: '/tmp/project',
            rail: 'codex' as const,
            commanderId: null,
            status: 'paused' as const,
            maxRetries: 0,
            tags: ['Project Beacon', 'Operations'],
        };
        machineRPC.mockResolvedValueOnce({ id: 'automation-1' });
        await machineCreateAutomation('machine-1', input);
        expect(machineRPC).toHaveBeenNthCalledWith(2, 'machine-1', 'happyherd-automations-create', input);

        machineRPC.mockResolvedValueOnce({ id: 'automation-1', tags: [] });
        await machineUpdateAutomation('machine-1', 'automation-1', { tags: [] });
        expect(machineRPC).toHaveBeenNthCalledWith(3, 'machine-1', 'happyherd-automations-update', {
            id: 'automation-1',
            patch: { tags: [] },
        });
    });

    it('turns encrypted automation handler failures into client errors', async () => {
        machineRPC.mockResolvedValue({ error: 'Invalid or unsafe cron expression' });
        const { machineListAutomations } = await import('./ops');
        await expect(machineListAutomations('machine-1')).rejects.toThrow('Invalid or unsafe cron expression');
    });

    it('creates a Human side chat through the dedicated RPC without a brief and hydrates sessions', async () => {
        machineRPC.mockResolvedValue({
            schemaVersion: 2,
            type: 'side-chat',
            action: 'create',
            success: true,
            parentSessionId: 'happy-source',
            sessionId: 'happy-child',
            phases: [],
            resource,
        });
        const { machineCreateSideChat } = await import('./ops');

        const result = await machineCreateSideChat('machine-1', 'happy-source');

        expect(result).toMatchObject({ success: true, sessionId: 'happy-child' });
        expect(machineRPC).toHaveBeenCalledWith('machine-1', 'happyherd-side-chat-create', {
            parentSessionId: 'happy-source',
        });
        expect(refreshSessions).toHaveBeenCalledOnce();
    });

    it('keeps a successful Human creation receipt when immediate session hydration fails', async () => {
        machineRPC.mockResolvedValue({
            schemaVersion: 2,
            type: 'side-chat',
            action: 'create',
            success: true,
            parentSessionId: 'happy-source',
            sessionId: 'happy-child',
            phases: [],
            resource,
        });
        refreshSessions.mockRejectedValueOnce(new Error('refresh unavailable'));
        const { machineCreateSideChat } = await import('./ops');

        const result = await machineCreateSideChat('machine-1', 'happy-source');

        expect(result).toMatchObject({ success: true, sessionId: 'happy-child' });
        expect(refreshSessions).toHaveBeenCalledOnce();
    });

    it('does not hydrate sessions after a failed side-chat lifecycle receipt', async () => {
        machineRPC.mockResolvedValue({
            schemaVersion: 2,
            type: 'side-chat',
            action: 'create',
            success: false,
            parentSessionId: 'happy-source',
            sessionId: null,
            phases: [{ phase: 'resolve', status: 'failed', message: 'Parent unavailable' }],
            resource,
        });
        const { machineCreateSideChat } = await import('./ops');

        const result = await machineCreateSideChat('machine-1', 'happy-source');

        expect(result.success).toBe(false);
        expect(refreshSessions).not.toHaveBeenCalled();
    });

    it('forks a full Codex thread and spawns a Codex session resumed to the new thread', async () => {
        machineRPC.mockImplementation(async (_machineId: string, method: string) => {
            if (method === 'codex-fork-thread') {
                return { type: 'success', newCodexThreadId: 'thread-forked' };
            }
            if (method === 'spawn-happy-session') {
                return { type: 'success', sessionId: 'happy-forked' };
            }
            throw new Error(`unexpected method ${method}`);
        });

        const { forkAndSpawn } = await import('./ops');
        const result = await forkAndSpawn({
            kind: 'codex',
            sessionId: 'happy-source',
            machineId: 'machine-1',
            directory: '/tmp/project',
            codexThreadId: 'thread-source',
        });

        expect(result).toEqual({ type: 'success', sessionId: 'happy-forked' });
        expect(machineRPC).toHaveBeenNthCalledWith(
            1,
            'machine-1',
            'codex-fork-thread',
            { directory: '/tmp/project', codexThreadId: 'thread-source' },
        );
        expect(machineRPC).toHaveBeenNthCalledWith(
            2,
            'machine-1',
            'spawn-happy-session',
            expect.objectContaining({
                agent: 'codex',
                directory: '/tmp/project',
                resumeCodexThreadId: 'thread-forked',
                parentSessionId: 'happy-source',
            }),
        );
        expect(machineRPC.mock.calls[1]?.[2]).not.toHaveProperty('isSideChat');
        expect(refreshSessions).toHaveBeenCalledTimes(1);
    });

    it('duplicates a Codex thread from a selected user item before spawning', async () => {
        machineRPC.mockImplementation(async (_machineId: string, method: string) => {
            if (method === 'codex-duplicate-thread') {
                return { type: 'success', newCodexThreadId: 'thread-cut' };
            }
            if (method === 'spawn-happy-session') {
                return { type: 'success', sessionId: 'happy-cut' };
            }
            throw new Error(`unexpected method ${method}`);
        });

        const { forkAndSpawn } = await import('./ops');
        const result = await forkAndSpawn({
            kind: 'codex',
            sessionId: 'happy-source',
            machineId: 'machine-1',
            directory: '/tmp/project',
            codexThreadId: 'thread-source',
        }, {
            cutAfterItemId: 'user-item-2',
            forkedFromMessageId: 'message-2',
        });

        expect(result).toEqual({ type: 'success', sessionId: 'happy-cut' });
        expect(machineRPC).toHaveBeenNthCalledWith(
            1,
            'machine-1',
            'codex-duplicate-thread',
            { directory: '/tmp/project', codexThreadId: 'thread-source', cutAfterItemId: 'user-item-2' },
        );
        expect(machineRPC).toHaveBeenNthCalledWith(
            2,
            'machine-1',
            'spawn-happy-session',
            expect.objectContaining({
                agent: 'codex',
                resumeCodexThreadId: 'thread-cut',
                forkedFromMessageId: 'message-2',
            }),
        );
    });
});
