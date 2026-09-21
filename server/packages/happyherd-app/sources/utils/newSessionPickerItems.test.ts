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
            {
                key: 'opus',
                name: 'opus 4.7',
                description: 'larger context',
                unavailable: true,
            },
        ])).toEqual([
            { key: 'default', label: 'default model' },
            {
                key: 'opus',
                label: 'opus 4.7',
                subtitle: 'larger context',
                disabled: true,
            },
        ]);
    });

    it('groups provider models in first-seen provider and wire order', () => {
        expect(getModePickerItems([
            { key: 'codex:sol', name: 'Sol', description: 'OpenAI Codex', providerId: 'codex', providerName: 'OpenAI Codex' },
            { key: 'claude:opus', name: 'Opus', description: 'Anthropic Claude', providerId: 'claude', providerName: 'Anthropic Claude' },
            { key: 'codex:terra', name: 'Terra', description: 'OpenAI Codex', providerId: 'codex', providerName: 'OpenAI Codex' },
        ])).toEqual([
            { key: 'codex:sol', label: 'Sol', section: 'OpenAI Codex' },
            { key: 'codex:terra', label: 'Terra', section: 'OpenAI Codex' },
            { key: 'claude:opus', label: 'Opus', section: 'Anthropic Claude' },
        ]);
    });

    it('keeps an unavailable saved model disabled after every active provider', () => {
        expect(getModePickerItems([
            { key: 'saved', name: 'Saved model', providerId: 'codex', providerName: 'OpenAI', unavailable: true },
            { key: 'sol', name: 'Sol', providerId: 'codex', providerName: 'OpenAI' },
            { key: 'opus', name: 'Opus', providerId: 'claude', providerName: 'Anthropic' },
        ])).toEqual([
            { key: 'sol', label: 'Sol', section: 'OpenAI' },
            { key: 'opus', label: 'Opus', section: 'Anthropic' },
            { key: 'saved', label: 'Saved model', disabled: true },
        ]);
    });
});
