import { describe, expect, it } from 'vitest';

import {
    resolveAgentDefaultConfig,
    resolveAgentDefaultEffortLevel,
    setAgentDefaultOverride,
} from './agentDefaults';

describe('agent defaults', () => {
    it('uses a canonical Claude model slug by default', () => {
        expect(resolveAgentDefaultConfig(undefined, 'claude').modelMode).toBe('claude-opus-5');
        expect(resolveAgentDefaultConfig(undefined, 'claude').effortLevel).toBe('max');
    });

    it('migrates a persisted Claude alias to its canonical slug', () => {
        expect(resolveAgentDefaultConfig({
            claude: { modelMode: 'opus' },
        }, 'claude').modelMode).toBe('claude-opus-5');
    });

    it('defaults fresh Codex users to the highest advertised effort', () => {
        expect(resolveAgentDefaultConfig(undefined, 'codex').effortLevel).toBe('max');
        expect(resolveAgentDefaultEffortLevel(undefined, 'codex', [
            { key: 'low' },
            { key: 'max' },
            { key: 'ultra' },
        ])).toBe('ultra');
    });

    it('falls back to the highest advertised effort when max is unsupported', () => {
        expect(resolveAgentDefaultEffortLevel(undefined, 'codex', [
            { key: 'low' },
            { key: 'xhigh' },
        ])).toBe('xhigh');
        expect(resolveAgentDefaultEffortLevel(undefined, 'codex', [
            { key: 'medium' },
            { key: 'ultra' },
        ])).toBe('ultra');
        expect(resolveAgentDefaultEffortLevel(undefined, 'claude', [
            { key: 'low' },
            { key: 'xhigh' },
        ])).toBe('xhigh');
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

    it('keeps GrokBuild defaults neutral and isolated from Claude', () => {
        expect(resolveAgentDefaultConfig(undefined, 'grok')).toEqual({
            permissionMode: 'default',
            modelMode: 'default',
            effortLevel: null,
        });

        const overrides = setAgentDefaultOverride({}, 'grok', 'modelMode', 'grok-runtime-model');
        expect(resolveAgentDefaultConfig(overrides, 'grok').modelMode).toBe('grok-runtime-model');
        expect(resolveAgentDefaultConfig(overrides, 'claude').modelMode).toBe('claude-opus-5');
    });

    it('only forwards a saved GrokBuild effort while ACP advertises it', () => {
        const overrides = setAgentDefaultOverride({}, 'grok', 'effortLevel', 'thorough');
        expect(resolveAgentDefaultEffortLevel(overrides, 'grok', [
            { key: 'fast' },
            { key: 'thorough' },
        ])).toBe('thorough');
        expect(resolveAgentDefaultEffortLevel(overrides, 'grok', [
            { key: 'fast' },
        ])).toBeNull();
    });
});
