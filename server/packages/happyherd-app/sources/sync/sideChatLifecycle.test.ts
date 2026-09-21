import { describe, expect, it, vi } from 'vitest';

import {
    closeSideChatSession,
    resolveSideChatCloseReconciliation,
    type SideChatOperationReceipt,
} from './sideChatLifecycle';

describe('closeSideChatSession', () => {
    it('stops on the exact daemon and archives so a closed tab stays closed after reload', async () => {
        const calls: string[] = [];
        const stopOnMachine = vi.fn(async () => { calls.push('daemon-stop'); return { success: true }; });
        const stopSession = vi.fn(async () => { calls.push('session-stop'); return { success: true }; });
        const archive = vi.fn(async () => { calls.push('archive'); return { success: true }; });
        const refresh = vi.fn(async () => { calls.push('refresh'); });

        await expect(closeSideChatSession(
            { sessionId: 'child-one', machineId: 'machine-one', active: true },
            { stopOnMachine, stopSession, archive, refresh },
        )).resolves.toEqual({ success: true, stopped: true, archived: true });

        expect(stopOnMachine).toHaveBeenCalledWith('machine-one', 'child-one');
        expect(stopSession).not.toHaveBeenCalled();
        expect(archive).toHaveBeenCalledWith('child-one');
        expect(refresh).toHaveBeenCalledOnce();
        expect(calls).toEqual(['daemon-stop', 'archive', 'refresh']);
    });

    it('falls back to the session RPC but still archives when the daemon stop fails', async () => {
        const archive = vi.fn(async () => ({ success: true }));

        await expect(closeSideChatSession(
            { sessionId: 'child-one', machineId: 'machine-one', active: true },
            {
                stopOnMachine: vi.fn(async () => ({ success: false })),
                stopSession: vi.fn(async () => ({ success: true })),
                archive,
                refresh: vi.fn(async () => undefined),
            },
        )).resolves.toEqual({ success: true, stopped: true, archived: true });

        expect(archive).toHaveBeenCalledWith('child-one');
    });

    it('reports resolved stop and archive failures instead of hiding them as success', async () => {
        const stopSession = vi.fn(async () => ({ success: false }));
        const archive = vi.fn(async () => ({ success: false }));

        await expect(closeSideChatSession(
            { sessionId: 'child-one', machineId: 'machine-one', active: true },
            {
                stopOnMachine: vi.fn(async () => ({ success: false })),
                stopSession,
                archive,
                refresh: vi.fn(async () => undefined),
            },
        )).resolves.toEqual({ success: false, stopped: false, archived: false });

        expect(stopSession).toHaveBeenCalledWith('child-one');
        expect(archive).toHaveBeenCalledWith('child-one');
    });

    it('does not treat inactive server presence as proof that the provider stopped', async () => {
        const stopOnMachine = vi.fn(async () => ({ success: false }));
        const stopSession = vi.fn(async () => ({ success: false }));

        await expect(closeSideChatSession(
            { sessionId: 'child-one', machineId: 'machine-one', active: false },
            {
                stopOnMachine,
                stopSession,
                archive: vi.fn(async () => ({ success: true })),
                refresh: vi.fn(async () => undefined),
            },
        )).resolves.toEqual({ success: false, stopped: false, archived: true });

        expect(stopOnMachine).toHaveBeenCalledWith('machine-one', 'child-one');
        expect(stopSession).toHaveBeenCalledWith('child-one');
    });

    it('retries both stop mechanisms after a partial archive made the child inactive', async () => {
        const stopOnMachine = vi.fn(async () => ({ success: false }));
        const stopSession = vi.fn(async () => ({ success: false }));
        const archive = vi
            .fn<() => Promise<SideChatOperationReceipt>>()
            .mockResolvedValueOnce({ success: false })
            .mockResolvedValueOnce({ success: true });
        const dependencies = {
            stopOnMachine,
            stopSession,
            archive,
            refresh: vi.fn(async () => undefined),
        };

        await expect(closeSideChatSession(
            { sessionId: 'child-one', machineId: 'machine-one', active: true },
            dependencies,
        )).resolves.toEqual({ success: false, stopped: false, archived: false });

        await expect(closeSideChatSession(
            { sessionId: 'child-one', machineId: 'machine-one', active: false },
            dependencies,
        )).resolves.toEqual({ success: false, stopped: false, archived: true });

        expect(stopOnMachine).toHaveBeenCalledTimes(2);
        expect(stopSession).toHaveBeenCalledTimes(2);
        expect(archive).toHaveBeenCalledTimes(2);
    });

    it('restores only a durably unarchived tab and surfaces every incomplete close', () => {
        expect(resolveSideChatCloseReconciliation({ success: true, stopped: true, archived: true }))
            .toEqual({ restoreTab: false, error: null });
        expect(resolveSideChatCloseReconciliation({ success: false, stopped: false, archived: true }))
            .toEqual({ restoreTab: false, error: 'stop-unconfirmed' });
        expect(resolveSideChatCloseReconciliation({ success: false, stopped: true, archived: false }))
            .toEqual({ restoreTab: true, error: 'archive-failed' });
    });
});
