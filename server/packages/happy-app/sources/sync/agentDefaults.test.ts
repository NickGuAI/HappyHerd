import { describe, expect, it } from 'vitest';

import {
    AgentDefaultOverridesSchema,
    agentKeys,
    getAgentDefaultOverride,
    resolveAgentDefaultConfig,
    resolveAgentDefaultEffortLevel,
    setAgentDefaultOverride,
} from './agentDefaults';
import { HARNESS_NAMES, HARNESS_ORDER, isRetiredHarness } from '@/utils/harnessCatalog';

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
            permissionMode: '',
            modelMode: '',
            effortLevel: null,
        });

        const overrides = setAgentDefaultOverride({}, 'grok', 'modelMode', 'grok-runtime-model');
        expect(resolveAgentDefaultConfig(overrides, 'grok').modelMode).toBe('grok-runtime-model');
        expect(resolveAgentDefaultConfig(overrides, 'claude').modelMode).toBe('claude-opus-5');
    });

    it('retains GrokBuild dontAsk as its provider-owned launch token', () => {
        const overrides = setAgentDefaultOverride({}, 'grok', 'permissionMode', 'dontAsk');

        expect(resolveAgentDefaultConfig(overrides, 'grok').permissionMode).toBe('dontAsk');
        expect(resolveAgentDefaultConfig({
            claude: { permissionMode: 'dontAsk' },
        }, 'claude').permissionMode).toBe('acceptEdits');
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

    it('wires every active harness into the defaults schema and registry', () => {
        expect(agentKeys).toEqual(HARNESS_ORDER);
        expect(new Set(agentKeys)).toEqual(new Set(
            Object.keys(HARNESS_NAMES).filter((agent) => !isRetiredHarness(agent)),
        ));

        const values = Object.fromEntries(agentKeys.map((agent) => [
            agent,
            { modelMode: `${agent}-model` },
        ]));
        const parsed = AgentDefaultOverridesSchema.parse(values);

        for (const agent of HARNESS_ORDER) {
            expect(getAgentDefaultOverride(parsed, agent).modelMode).toBe(`${agent}-model`);
        }
    });

    it('keeps Rig defaults byte-faithful and independent from Claude', () => {
        let overrides = setAgentDefaultOverride({}, 'claude', 'modelMode', 'claude-model');
        overrides = setAgentDefaultOverride(overrides, 'rig', 'modelMode', 'provider:model');
        overrides = setAgentDefaultOverride(overrides, 'rig', 'permissionMode', 'dontAsk');

        expect(resolveAgentDefaultConfig(overrides, 'rig')).toEqual({
            permissionMode: 'dontAsk',
            modelMode: 'provider:model',
            effortLevel: null,
        });
        expect(resolveAgentDefaultConfig(overrides, 'claude').modelMode).toBe('claude-model');

        overrides = setAgentDefaultOverride(overrides, 'rig', 'modelMode', null);
        expect(getAgentDefaultOverride(overrides, 'rig').modelMode).toBeUndefined();
        expect(resolveAgentDefaultConfig(overrides, 'claude').modelMode).toBe('claude-model');

        overrides = setAgentDefaultOverride(overrides, 'rig', 'permissionMode', null);
        expect(overrides.rig).toBeUndefined();
        expect(overrides.claude).toEqual({ modelMode: 'claude-model' });
    });

    it('does not alias an unknown provider to Claude', () => {
        const overrides = { claude: { modelMode: 'claude-model' } };

        expect(resolveAgentDefaultConfig(overrides, 'future-provider')).toEqual({
            permissionMode: '',
            modelMode: '',
            effortLevel: null,
        });
        expect(getAgentDefaultOverride(overrides, 'future-provider')).toEqual({});
        expect(setAgentDefaultOverride(overrides, 'future-provider', 'modelMode', 'future-model'))
            .toEqual(overrides);
    });
});
