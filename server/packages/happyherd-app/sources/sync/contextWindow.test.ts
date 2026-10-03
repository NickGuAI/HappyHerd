import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Machine, Session } from './storageTypes';
import { settingsDefaults, settingsParse, settingsToSyncPayload } from './settings';

const machineRPC = vi.hoisted(() => vi.fn());
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC } }));
import { readSessionContextWindow } from './contextWindow';

const machine = { id: 'machine-1', active: true } as Machine;
function session(metadata: Record<string, unknown> = {}): Session {
    return { id: 'session-1', metadata: { machineId: 'machine-1', path: '/fixture/project', homeDir: '/fixture', flavor: 'claude', claudeSessionId: 'claude-1', ...metadata } } as Session;
}
const reply = { type: 'success', provider: 'claude', entries: [{ kind: 'attachment:session_context', content: 'Full first line\nFull second line' }], limitations: ['claude_system_prompt_unrecorded', 'claude_tool_definitions_unrecorded'] };
beforeEach(() => { machineRPC.mockReset(); machineRPC.mockResolvedValue(reply); });

describe('Context window encrypted machine RPC', () => {
    it('is disabled by default, including older account settings, and round trips the opt-in through sync', () => {
        expect(settingsDefaults.expContextWindow).toBe(false);
        expect(settingsParse({}).expContextWindow).toBe(false);
        const enabled = settingsParse({ expContextWindow: true });
        expect(settingsParse(settingsToSyncPayload(enabled)).expContextWindow).toBe(true);
    });

    it.each(['claude', 'codex'] as const)('reads the exact %s session on its owning machine, preserving full reply content', async (provider) => {
        const input = session({ flavor: provider, claudeSessionId: provider === 'claude' ? 'claude-1' : undefined, codexThreadId: provider === 'codex' ? 'thread-1' : undefined, codexHome: '/fixture/provider-state' });
        machineRPC.mockResolvedValue({ ...reply, provider });
        await expect(readSessionContextWindow(input, machine)).resolves.toEqual({ ...reply, provider });
        expect(machineRPC).toHaveBeenCalledExactlyOnceWith('machine-1', 'session-context-window', {
            provider, directory: '/fixture/project', homeDir: '/fixture', codexHome: '/fixture/provider-state',
            claudeSessionId: provider === 'claude' ? 'claude-1' : undefined,
            codexThreadId: provider === 'codex' ? 'thread-1' : undefined,
        });
    });

    it('uses Claude for retained legacy metadata without a flavor', async () => {
        await readSessionContextWindow(session({ flavor: undefined }), machine);
        expect(machineRPC.mock.calls[0][2].provider).toBe('claude');
    });

    it.each(['grok', 'dsh', 'agy'])('reports unsupported %s without requesting a trace', async (flavor) => {
        await expect(readSessionContextWindow(session({ flavor }), machine)).resolves.toEqual({ type: 'error', reason: 'unsupported' });
        expect(machineRPC).not.toHaveBeenCalled();
    });

    it.each(['claude', 'codex', 'rig'])('maps native HappyHerd with %s model flavor to its remote identity only', async (flavor) => {
        const nativeReply = { ...reply, provider: 'rig', limitations: ['rig_runtime_input_not_recorded'] };
        machineRPC.mockResolvedValue(nativeReply);
        await expect(readSessionContextWindow(session({ flavor, client: { id: 'rig' },
            codexThreadId: 'not-a-native-id', codexHome: '/not-native-state',
        }), machine)).resolves.toEqual(nativeReply);
        expect(machineRPC).toHaveBeenCalledExactlyOnceWith('machine-1', 'session-context-window', {
            provider: 'rig', directory: '/fixture/project', sessionId: 'session-1',
        });
    });

    it('reads explicit native flavor without requiring a CLI identity', async () => {
        await readSessionContextWindow(session({ flavor: 'rig', claudeSessionId: undefined }), machine);
        expect(machineRPC.mock.calls[0][2]).toEqual({ provider: 'rig', directory: '/fixture/project', sessionId: 'session-1' });
    });

    it('requires the remote session identity for native context', async () => {
        await expect(readSessionContextWindow({ ...session({ client: { id: 'rig' } }), id: '' }, machine))
            .resolves.toEqual({ type: 'error', reason: 'missing' });
        expect(machineRPC).not.toHaveBeenCalled();
    });

    it.each([undefined, null, { ...machine, active: false }])('reports an unavailable machine without an RPC', async (unavailable) => {
        await expect(readSessionContextWindow(session(), unavailable)).resolves.toEqual({ type: 'error', reason: 'offline' });
        expect(machineRPC).not.toHaveBeenCalled();
    });

    it.each([{ path: '' }, { claudeSessionId: undefined }, { flavor: 'codex', codexThreadId: undefined }])('reports missing native identity: %j', async (metadata) => {
        await expect(readSessionContextWindow(session(metadata), machine)).resolves.toEqual({ type: 'error', reason: 'missing' });
        expect(machineRPC).not.toHaveBeenCalled();
    });

    it.each(['claude', 'rig'].flatMap((provider) => ['unsupported', 'missing', 'unreadable'].map((reason) => ({ provider, reason }))))('preserves the $provider machine reader failure $reason', async ({ provider, reason }) => {
        machineRPC.mockResolvedValue({ type: 'error', reason });
        await expect(readSessionContextWindow(session({ flavor: provider }), machine)).resolves.toEqual({ type: 'error', reason });
    });

    it.each(['claude', 'rig'])('reports %s RPC or malformed replies as unreadable, and allows the next retry to succeed', async (provider) => {
        const recovered = { ...reply, provider };
        machineRPC.mockRejectedValueOnce(new Error('machine disconnected')).mockResolvedValueOnce({ entries: [] }).mockResolvedValueOnce(recovered);
        await expect(readSessionContextWindow(session({ flavor: provider }), machine)).resolves.toEqual({ type: 'error', reason: 'unreadable' });
        await expect(readSessionContextWindow(session({ flavor: provider }), machine)).resolves.toEqual({ type: 'error', reason: 'unreadable' });
        await expect(readSessionContextWindow(session({ flavor: provider }), machine)).resolves.toEqual(recovered);
    });
});
