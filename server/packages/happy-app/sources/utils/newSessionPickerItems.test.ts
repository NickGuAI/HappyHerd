import { describe, expect, it } from 'vitest';
import { getAgentPickerItems, getModePickerItems } from './newSessionPickerItems';

describe('new session picker items', () => {
    it('maps agents to picker item labels', () => {
        expect(getAgentPickerItems([
            { key: 'claude', label: 'claude code' },
            {
                key: 'codex',
                label: 'codex',
                description: 'not installed on this daemon',
                disabled: true,
            },
        ])).toEqual([
            { key: 'claude', label: 'claude code' },
            {
                key: 'codex',
                label: 'codex',
                subtitle: 'not installed on this daemon',
                disabled: true,
            },
        ]);
    });

    it('maps model, effort, and permission options with descriptions', () => {
        expect(getModePickerItems([
            { key: 'default', name: 'default model', description: null },
            { key: 'opus', name: 'opus 4.7', description: 'larger context' },
        ])).toEqual([
            { key: 'default', label: 'default model' },
            { key: 'opus', label: 'opus 4.7', subtitle: 'larger context' },
        ]);
    });
});
