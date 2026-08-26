import { describe, expect, it } from 'vitest';
import { resolveAvatarHarness } from './avatarHarness';

describe('resolveAvatarHarness', () => {
    it('maps every active harness, including GrokBuild', () => {
        expect(resolveAvatarHarness('claude')).toBe('claude');
        expect(resolveAvatarHarness('codex')).toBe('codex');
        expect(resolveAvatarHarness('grok')).toBe('grok');
        expect(resolveAvatarHarness('agy')).toBe('agy');
    });

    it('uses Happy for the Rig client regardless of provider flavor', () => {
        expect(resolveAvatarHarness('codex', 'rig')).toBe('rig');
        expect(resolveAvatarHarness(null, 'rig')).toBe('rig');
    });

    it('does not badge retired or unknown flavors', () => {
        expect(resolveAvatarHarness('gemini')).toBeNull();
        expect(resolveAvatarHarness('future-harness')).toBeNull();
        expect(resolveAvatarHarness(null)).toBeNull();
        expect(resolveAvatarHarness(undefined, 'other-client')).toBeNull();
    });
});
