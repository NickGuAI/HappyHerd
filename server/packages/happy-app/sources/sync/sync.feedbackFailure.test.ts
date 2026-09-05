import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    state: { sessions: {}, machines: {}, settings: {} } as any,
    getSessionEncryption: vi.fn(),
    refetch: vi.fn(async () => undefined),
    resolveMessageModeMeta: vi.fn(),
    alert: vi.fn(),
}));

// Keep the production sendMessage method and its strict/ordinary branches;
// isolate the native runtime and unrelated singleton services at imports.
vi.mock('expo-constants', () => ({ default: {} }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('expo-notifications', () => ({}));
vi.mock('react-native', () => ({
    Platform: { OS: 'web' },
    AppState: { currentState: 'active', addEventListener: vi.fn() },
}));
vi.mock('@/sync/apiSocket', () => ({}));
vi.mock('@/sync/webTabTitle', () => ({}));
vi.mock('@/sync/encryption/encryption', () => ({}));
vi.mock('@/encryption/base64', () => ({}));
vi.mock('./storage', () => ({ storage: { getState: () => mocks.state } }));
vi.mock('./ops', () => ({}));
vi.mock('./attachmentSupport', () => ({}));
vi.mock('./attachmentDiagnostics', () => ({}));
vi.mock('./apiTypes', () => ({}));
vi.mock('@/utils/sync', () => ({
    InvalidateSync: class { invalidateAndAwait = mocks.refetch; },
}));
vi.mock('@/utils/time', () => ({ delay: async () => undefined }));
vi.mock('./pushRegistration', () => ({}));
vi.mock('@/utils/platform', () => ({}));
vi.mock('./typesRaw', () => ({}));
vi.mock('./settings', () => ({ applySettings: vi.fn() }));
vi.mock('./profile', () => ({}));
vi.mock('./persistence', () => ({ loadPendingSettings: () => ({}) }));
vi.mock('@/track', () => ({}));
vi.mock('@/utils/parseToken', () => ({}));
vi.mock('./revenueCat', () => ({}));
vi.mock('./serverConfig', () => ({}));
vi.mock('@/config', () => ({}));
vi.mock('@/log', () => ({}));
vi.mock('./gitStatusSync', () => ({}));
vi.mock('@/utils/lock', () => ({}));
vi.mock('@/realtime/hooks/voiceHooks', () => ({}));
vi.mock('./encryption/encryptionCache', () => ({ EncryptionCache: class {} }));
vi.mock('./prompt/systemPrompt', () => ({}));
vi.mock('./prompt/userSafeguard', () => ({}));
vi.mock('./apiArtifacts', () => ({}));
vi.mock('./encryption/artifactEncryption', () => ({}));
vi.mock('./apiFriends', () => ({}));
vi.mock('./apiFeed', () => ({ fetchFeed: vi.fn() }));
vi.mock('./controlHandoff', () => ({}));
vi.mock('./messageMeta', () => ({
    resolveMessageModeMeta: mocks.resolveMessageModeMeta,
    UnsupportedPermissionModeError: class extends Error {
        mode = 'auto';
        cliVersion = '1.2.1-beta.1';
    },
}));
vi.mock('./agentDefaults', () => ({
    normalizeAgentKey: () => 'claude',
    resolveAgentDefaultConfig: () => ({ modelMode: 'default' }),
}));
vi.mock('@/components/modelModeOptions', () => ({}));
vi.mock('./apiAttachments', () => ({}));
vi.mock('@/encryption/blob', () => ({}));
vi.mock('@/utils/readFileBytes', () => ({}));
vi.mock('@/modal', () => ({ Modal: { alert: mocks.alert } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./rig', () => ({}));
vi.mock('./visibleSessionReconciliation', () => ({}));
vi.mock('./queueState', () => ({}));
vi.mock('./apiProjects', () => ({}));
vi.mock('./projects', () => ({}));

import { sync } from './sync';
import { UnsupportedPermissionModeError } from './messageMeta';

beforeEach(() => {
    mocks.state = { sessions: {}, machines: {}, settings: {} };
    mocks.getSessionEncryption.mockReset().mockReturnValue(null);
    mocks.resolveMessageModeMeta.mockReset();
    mocks.refetch.mockClear();
    mocks.alert.mockClear();
    sync.encryption = { getSessionEncryption: mocks.getSessionEncryption } as any;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('Workspace strict send early failures', () => {
    it.each(['session', 'encryption'] as const)('rejects strict feedback when %s stays unavailable', async (missing) => {
        if (missing === 'session') mocks.getSessionEncryption.mockReturnValue({});
        else mocks.state.sessions['origin-session'] = { metadata: { flavor: 'claude' } };

        await expect(sync.sendMessage('origin-session', 'Keep this feedback', {
            requireAllAttachments: true,
        })).rejects.toThrow('errors.sessionNotFinishedSyncing');
        expect(mocks.refetch).toHaveBeenCalledTimes(3);
        expect(mocks.resolveMessageModeMeta).not.toHaveBeenCalled();
    });

    it.each(['session', 'encryption'] as const)('preserves ordinary chat handling when %s stays unavailable', async (missing) => {
        if (missing === 'session') mocks.getSessionEncryption.mockReturnValue({});
        else mocks.state.sessions['origin-session'] = { metadata: { flavor: 'claude' } };

        await expect(sync.sendMessage('origin-session', 'Ordinary chat')).resolves.toBeUndefined();
        expect(mocks.refetch).toHaveBeenCalledTimes(3);
        expect(mocks.alert).toHaveBeenCalledWith('common.error', 'errors.sessionNotFinishedSyncing');
    });

    it('rejects strict feedback when the current permission mode is unsupported', async () => {
        mocks.getSessionEncryption.mockReturnValue({});
        mocks.state.sessions['origin-session'] = { metadata: { flavor: 'claude' } };
        const error = new UnsupportedPermissionModeError('auto', '1.2.1-beta.1');
        mocks.resolveMessageModeMeta.mockImplementation(() => { throw error; });

        await expect(sync.sendMessage('origin-session', 'Keep this feedback', {
            requireAllAttachments: true,
        })).rejects.toBe(error);
        expect(mocks.refetch).not.toHaveBeenCalled();
    });

    it('preserves ordinary chat handling for an unsupported permission mode', async () => {
        mocks.getSessionEncryption.mockReturnValue({});
        mocks.state.sessions['origin-session'] = { metadata: { flavor: 'claude' } };
        mocks.resolveMessageModeMeta.mockImplementation(() => {
            throw new UnsupportedPermissionModeError('auto', '1.2.1-beta.1');
        });

        await expect(sync.sendMessage('origin-session', 'Ordinary chat')).resolves.toBeUndefined();
        expect(mocks.alert).toHaveBeenCalledWith('common.error', 'errors.unsupportedPermissionMode');
    });
});
