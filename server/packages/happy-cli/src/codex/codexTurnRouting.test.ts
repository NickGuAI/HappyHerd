import { describe, expect, it } from 'vitest';

import { shouldSteerCodexUserInput } from './codexTurnRouting';

describe('Codex turn routing', () => {
    it('starts a new turn when Codex is idle', () => {
        expect(shouldSteerCodexUserInput('follow up', null)).toBe(false);
    });

    it('steers ordinary input into the active provider turn', () => {
        expect(shouldSteerCodexUserInput('follow up', 'turn-1')).toBe(true);
        expect(shouldSteerCodexUserInput('', 'turn-1')).toBe(true);
    });

    it('keeps local control commands out of turn steering', () => {
        expect(shouldSteerCodexUserInput('/clear', 'turn-1')).toBe(false);
        expect(shouldSteerCodexUserInput('/goal verify the release', 'turn-1')).toBe(false);
        expect(shouldSteerCodexUserInput('/goal clear', 'turn-1')).toBe(false);
    });
});
