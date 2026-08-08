import { describe, expect, it } from 'vitest';

import {
    resolveAgentDefaultConfig,
    resolveAgentDefaultEffortLevel,
    setAgentDefaultOverride,
} from './agentDefaults';

describe('agent defaults', () => {
    it('uses a canonical Claude model slug by default', () => {
        expect(resolveAgentDefaultConfig(undefined, 'claude').modelMode).toBe('claude-opus-5');
    });

    it('migrates a persisted Claude alias to its canonical slug', () => {
        expect(resolveAgentDefaultConfig({
            claude: { modelMode: 'opus' },
        }, 'claude').modelMode).toBe('claude-opus-5');
    });

    it('defaults fresh Codex users to the highest effort advertised by the selected model', () => {
        expect(resolveAgentDefaultConfig(undefined, 'codex').effortLevel).toBeNull();
        expect(resolveAgentDefaultEffortLevel(undefined, 'codex', [
            { key: 'low' },
            { key: 'medium' },
            { key: 'high' },
            { key: 'xhigh' },
        ])).toBe('xhigh');
        expect(resolveAgentDefaultEffortLevel(undefined, 'codex', [
            { key: 'medium' },
            { key: 'ultra' },
        ])).toBe('ultra');
    });

    it('keeps a synchronized explicit Codex effort while the selected model supports it', () => {
        const overrides = setAgentDefaultOverride({}, 'codex', 'effortLevel', 'ultra');

        expect(resolveAgentDefaultEffortLevel(overrides, 'codex', [
            { key: 'medium' },
            { key: 'ultra' },
        ])).toBe('ultra');
    });

    it('falls back to a model maximum without deleting an unsupported synchronized preference', () => {
        const overrides = setAgentDefaultOverride({}, 'codex', 'effortLevel', 'ultra');

        expect(resolveAgentDefaultEffortLevel(overrides, 'codex', [
            { key: 'low' },
            { key: 'xhigh' },
        ])).toBe('xhigh');
        expect(resolveAgentDefaultConfig(overrides, 'codex').effortLevel).toBe('ultra');
    });

    it('omits effort when the selected model authoritatively exposes no effort control', () => {
        const overrides = setAgentDefaultOverride({}, 'codex', 'effortLevel', 'xhigh');

        expect(resolveAgentDefaultEffortLevel(overrides, 'codex', [])).toBeNull();
        expect(resolveAgentDefaultConfig(overrides, 'codex').effortLevel).toBe('xhigh');
    });
});
