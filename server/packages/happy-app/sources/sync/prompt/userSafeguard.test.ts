import { describe, expect, it } from 'vitest';

import { userSafeguardMessageMeta } from './userSafeguard';

describe('userSafeguardMessageMeta', () => {
    it.each(['claude', 'codex', null, undefined])('captures the current selection for supported %s turns', (flavor) => {
        expect(userSafeguardMessageMeta(flavor, true)).toEqual({ userSafeguardEnabled: true });
        expect(userSafeguardMessageMeta(flavor, false)).toEqual({ userSafeguardEnabled: false });
    });

    it.each(['gemini', 'grok', 'dsh', 'agy', 'rig'])('does not claim unsupported %s coverage', (flavor) => {
        expect(userSafeguardMessageMeta(flavor, true)).toEqual({});
    });
});
