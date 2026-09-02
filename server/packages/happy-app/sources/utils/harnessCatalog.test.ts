import { describe, expect, it } from 'vitest';

import { HARNESS_NAMES, isRetiredHarness, listAvailableHarnesses } from './harnessCatalog';

describe('harness catalog', () => {
    it('uses product names for harnesses whose CLI ids differ', () => {
        expect(HARNESS_NAMES.rig).toBe('Happy');
        expect(HARNESS_NAMES.agy).toBe('Antigravity');
        expect(HARNESS_NAMES.grok).toBe('GrokBuild');
        expect(HARNESS_NAMES.dsh).toBe('dsh');
    });

    it('retires Gemini only', () => {
        expect(isRetiredHarness('gemini')).toBe(true);
        expect(isRetiredHarness('claude')).toBe(false);
        expect(isRetiredHarness('grok')).toBe(false);
        // Antigravity is what Gemini's own error message redirects people to.
        expect(isRetiredHarness('agy')).toBe(false);
    });

    it('lists only installed harnesses, in pick order', () => {
        const harnesses = listAvailableHarnesses({
            availability: { claude: true, codex: true, grok: true, dsh: true, agy: true },
            happyAgentAvailable: true,
            selected: 'claude',
        });

        expect(harnesses.map((harness) => harness.key)).toEqual(['claude', 'codex', 'grok', 'dsh', 'agy', 'rig']);
        expect(harnesses.map((harness) => harness.name)).toEqual([
            'Claude Code',
            'Codex',
            'GrokBuild',
            'dsh',
            'Antigravity',
            'Happy',
        ]);
    });

    it('never offers a retired harness, even with its CLI installed', () => {
        const harnesses = listAvailableHarnesses({
            availability: { claude: true, gemini: true },
            happyAgentAvailable: false,
            selected: 'claude',
        });

        expect(harnesses.map((harness) => harness.key)).toEqual(['claude']);
    });

    // The "keep the current selection listed" rule must not apply here, or a
    // stale draft would pin someone to an agent they can no longer start.
    it('does not keep a retired harness listed just because it is selected', () => {
        const harnesses = listAvailableHarnesses({
            availability: { claude: true, gemini: true },
            happyAgentAvailable: false,
            selected: 'gemini',
        });

        expect(harnesses.map((harness) => harness.key)).toEqual(['claude']);
    });

    it('keeps a real name for a retired harness so old sessions still read right', () => {
        expect(HARNESS_NAMES.gemini).toBe('Gemini');
    });

    it('drops Happy when no connected machine can run it', () => {
        const harnesses = listAvailableHarnesses({
            availability: { claude: true, codex: true },
            happyAgentAvailable: false,
            selected: 'claude',
        });

        expect(harnesses.map((harness) => harness.key)).toEqual(['claude', 'codex']);
    });

    it('keeps the current selection listed even once its CLI disappears', () => {
        const harnesses = listAvailableHarnesses({
            availability: { claude: false, codex: true },
            happyAgentAvailable: false,
            selected: 'claude',
        });

        expect(harnesses.map((harness) => harness.key)).toEqual(['claude', 'codex']);
    });

    it('never lists detected-only providers without an explicit installation report', () => {
        expect(listAvailableHarnesses({
            availability: { claude: true, grok: false, agy: false },
            happyAgentAvailable: false,
            selected: 'agy',
        }).map((harness) => harness.key)).toEqual(['claude']);

        expect(listAvailableHarnesses({
            availability: null,
            happyAgentAvailable: false,
            selected: 'grok',
        }).map((harness) => harness.key)).toEqual(['claude', 'codex']);

        expect(listAvailableHarnesses({
            availability: { claude: true, dsh: false },
            happyAgentAvailable: false,
            selected: 'dsh',
        }).map((harness) => harness.key)).toEqual(['claude']);
    });

    it('falls back to the whole catalog when a machine reports no capabilities', () => {
        expect(listAvailableHarnesses({
            availability: null,
            happyAgentAvailable: false,
            selected: null,
        }).map((harness) => harness.key)).toEqual(['claude', 'codex']);

        expect(listAvailableHarnesses({
            availability: {},
            happyAgentAvailable: false,
            selected: null,
        }).map((harness) => harness.key)).toEqual(['claude', 'codex', 'rig']);
    });
});
