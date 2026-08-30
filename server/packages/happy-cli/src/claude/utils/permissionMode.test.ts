import { describe, it, expect } from 'vitest';
import {
    applySandboxPermissionPolicy,
    buildClaudeNativeCliArgs,
    extractPermissionModeFromClaudeArgs,
    mapToClaudeMode,
    normalizeRemotePermissionMode,
    resolveInitialClaudePermissionMode,
    resolveRemoteClaudePermissionMode,
} from './permissionMode';
import { MessageMetaSchema, type PermissionMode } from '@/api/types';

describe('mapToClaudeMode', () => {
    describe('Codex-only modes are rejected', () => {
        it.each(['yolo', 'safe-yolo', 'read-only'] as const)('rejects %s', (mode) => {
            expect(() => mapToClaudeMode(mode)).toThrow(`Unsupported Claude permission mode: ${mode}`);
        });
    });

    describe('Claude modes pass through unchanged', () => {
        it('passes through default', () => {
            expect(mapToClaudeMode('default')).toBe('default');
        });

        it('passes through acceptEdits', () => {
            expect(mapToClaudeMode('acceptEdits')).toBe('acceptEdits');
        });

        it('passes through bypassPermissions', () => {
            expect(mapToClaudeMode('bypassPermissions')).toBe('bypassPermissions');
        });

        it('passes through plan', () => {
            expect(mapToClaudeMode('plan')).toBe('plan');
        });

        it('passes through dontAsk', () => {
            expect(mapToClaudeMode('dontAsk')).toBe('dontAsk');
        });
    });

    describe('Claude SDK modes', () => {
        // auto is Claude's own mode, not a Codex one, so it must not be
        // rewritten on the way to the SDK.
        it('passes through auto', () => {
            expect(mapToClaudeMode('auto')).toBe('auto');
        });
    });

    // "Default" in the picker sends no mode at all. Coercing undefined to
    // 'default' here would pin an unset session to prompting mode instead of
    // letting Claude apply its own configuration.
    it('keeps an unset mode unset rather than inventing one', () => {
        expect(mapToClaudeMode(undefined)).toBeUndefined();
    });
});

describe('resolveInitialClaudePermissionMode with no override', () => {
    // Regression: this used to fall back to a hardcoded 'yolo', so choosing
    // Default — the safest-sounding option — started Claude with full access
    // and ignored the user's own configuration.
    it('stays unset when nothing is picked and no args force a mode', () => {
        expect(resolveInitialClaudePermissionMode(undefined, [])).toBeUndefined();
        expect(resolveInitialClaudePermissionMode(undefined, undefined)).toBeUndefined();
    });

    it('still honours an explicit mode and the skip-permissions flag', () => {
        expect(resolveInitialClaudePermissionMode('plan', [])).toBe('plan');
        expect(resolveInitialClaudePermissionMode(undefined, ['--dangerously-skip-permissions']))
            .toBe('bypassPermissions');
    });
});

describe('extractPermissionModeFromClaudeArgs', () => {
    it('extracts mode from --permission-mode VALUE', () => {
        expect(extractPermissionModeFromClaudeArgs(['--permission-mode', 'bypassPermissions'])).toBe('bypassPermissions');
    });

    it('extracts mode from --permission-mode=VALUE', () => {
        expect(extractPermissionModeFromClaudeArgs(['--foo', '--permission-mode=plan'])).toBe('plan');
    });

    it('rejects an invalid provider mode', () => {
        expect(() => extractPermissionModeFromClaudeArgs(['--permission-mode', 'read-only']))
            .toThrow('Unsupported Claude permission mode: read-only');
    });
});

describe('resolveInitialClaudePermissionMode', () => {
    it('uses --dangerously-skip-permissions as highest priority', () => {
        expect(resolveInitialClaudePermissionMode('default', ['--permission-mode', 'plan', '--dangerously-skip-permissions'])).toBe('bypassPermissions');
    });

    it('uses mode from claude args when present', () => {
        expect(resolveInitialClaudePermissionMode('default', ['--permission-mode', 'acceptEdits'])).toBe('acceptEdits');
    });

    it('falls back to option mode when claude args have no mode', () => {
        expect(resolveInitialClaudePermissionMode('bypassPermissions', ['--foo'])).toBe('bypassPermissions');
    });
});

describe('buildClaudeNativeCliArgs', () => {
    it('passes an exact bypass selection to local Claude with its required companion flag', () => {
        expect(buildClaudeNativeCliArgs(
            ['--permission-mode=plan', '--chrome'],
            { permissionMode: 'bypassPermissions', model: 'claude-opus-4-1', effort: 'high' },
        )).toEqual([
            '--chrome',
            '--permission-mode', 'bypassPermissions',
            '--dangerously-skip-permissions',
            '--model', 'claude-opus-4-1',
            '--effort', 'high',
        ]);
    });

    it('passes explicit default so local Claude leaves a prior non-default mode', () => {
        expect(buildClaudeNativeCliArgs([], {
            permissionMode: 'default',
            model: 'default',
            effort: 'max',
        })).toEqual(['--permission-mode', 'default', '--effort', 'max']);
    });
});

describe('applySandboxPermissionPolicy', () => {
    it('uses bypassPermissions only for an ambient mode when sandbox is enabled', () => {
        expect(applySandboxPermissionPolicy(undefined, true)).toBe('bypassPermissions');
    });

    it('preserves exact Human selections when sandbox is enabled', () => {
        expect(applySandboxPermissionPolicy('default', true)).toBe('default');
        expect(applySandboxPermissionPolicy('plan', true)).toBe('plan');
    });

    it('returns original mode when sandbox is disabled', () => {
        expect(applySandboxPermissionPolicy('acceptEdits', false)).toBe('acceptEdits');
    });
});

describe('resolveRemoteClaudePermissionMode', () => {
    it('applies explicit default after bypassPermissions', () => {
        expect(resolveRemoteClaudePermissionMode('bypassPermissions', 'default', false)).toBe('default');
    });

    it('applies explicit default after bypassPermissions when the OS sandbox is enabled', () => {
        expect(resolveRemoteClaudePermissionMode('bypassPermissions', 'default', true)).toBe('default');
    });

    it('still allows explicit plan mode after bypassPermissions was active', () => {
        expect(resolveRemoteClaudePermissionMode('bypassPermissions', 'plan', false)).toBe('plan');
    });

    it('keeps an explicit incoming mode exact when the OS sandbox is enabled', () => {
        expect(resolveRemoteClaudePermissionMode('default', 'plan', true)).toBe('plan');
    });
});

// The wire schema accepts any string so a newer app can name a mode this CLI
// does not know yet; the unknown value is dropped here rather than the message.
describe('normalizeRemotePermissionMode', () => {
    it('passes through every Claude-native mode', () => {
        const allModes: PermissionMode[] = [
            'auto', 'default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk',
        ];
        allModes.forEach(mode => {
            expect(normalizeRemotePermissionMode(mode)).toBe(mode);
        });
    });

    it.each(['mode-from-the-future', 'read-only', 'safe-yolo', 'yolo'])(
      'drops unsupported mode %s instead of the whole message', (mode) => {
        expect(normalizeRemotePermissionMode(mode)).toBeUndefined();
      },
    );

    it('leaves an absent mode absent', () => {
        expect(normalizeRemotePermissionMode(undefined)).toBeUndefined();
    });
});

describe('MessageMetaSchema permission mode', () => {
    it('accepts a mode this CLI does not know without failing the message', () => {
        const parsed = MessageMetaSchema.safeParse({ permissionMode: 'mode-from-the-future' });
        expect(parsed.success).toBe(true);
    });
});
