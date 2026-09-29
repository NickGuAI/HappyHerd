import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { getHarnessChipName, getModelDisplayName, getPermissionModeDisplayName } from './launchChoiceLabels';

describe('launch choice display labels', () => {
    it('falls back to the exact ID without deriving a Claude display name', () => {
        for (const key of ['claude-opus-5-5', 'claude-sonnet-5', 'claude-opus-5[1m]', 'future-model']) {
            expect(getModelDisplayName({ key, name: key })).toBe(key);
            expect(getModelDisplayName({ key, name: '' })).toBe(key);
        }
    });

    it('keeps a display name the machine advertises, and any other ID as it is', () => {
        expect(getModelDisplayName({ key: 'claude-opus-5-5', name: 'Opus 5.5 (preview)' })).toBe('Opus 5.5 (preview)');
        expect(getModelDisplayName({ key: 'gpt-6-astra', name: 'gpt-6 astra' })).toBe('gpt-6 astra');
        expect(getModelDisplayName({ key: 'grok-code', name: 'grok-code' })).toBe('grok-code');
        expect(getModelDisplayName({ key: 'default', name: 'provider default' })).toBe('provider default');
    });

    it('names permission modes with the app copy, else the advertised name', () => {
        expect(getPermissionModeDisplayName({ key: 'default', name: 'default' })).toBe('agentInput.permissionMode.default');
        expect(getPermissionModeDisplayName({ key: 'acceptEdits', name: 'Edits' })).toBe('agentInput.permissionMode.acceptEdits');
        expect(getPermissionModeDisplayName({ key: 'bypassPermissions', name: 'bypassPermissions' })).toBe('agentInput.permissionMode.bypassPermissions');
        expect(getPermissionModeDisplayName({ key: 'safe-yolo', name: 'workspace write' })).toBe('agentInput.codexPermissionMode.safeYolo');
        expect(getPermissionModeDisplayName({ key: 'workspace-write', name: 'workspace-write' })).toBe('workspace-write');
        expect(getPermissionModeDisplayName({ key: 'auto', name: 'Auto' })).toBe('Auto');
    });

    it('calls Claude Code "Claude" on a chip, and every other harness by its name', () => {
        expect(getHarnessChipName('claude')).toBe('Claude');
        expect(getHarnessChipName('codex')).toBe('Codex');
        expect(getHarnessChipName('rig')).toBe('HappyHerd');
    });
});
