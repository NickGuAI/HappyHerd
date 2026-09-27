import { describe, expect, it } from 'vitest';
import { HAPPYHERD_CLAUDE_OPUS_5_5_MODEL_SLUG } from '@happyherd/wire';
import type { AgentCapabilityCatalog, MachineMetadata } from './storageTypes';
import { getCodeAgentDefaults } from './agentDefaults';
import { normalizeStreamlineAgent, resolveStreamlineSelection, STREAMLINE_CODE_DEFAULTS } from './streamlineDefaults';

const option = (code: string, isDefault = false) => ({ code, value: code, isDefault });
function metadata(agent: string, overrides: Partial<AgentCapabilityCatalog> = {}): MachineMetadata {
    const defaults = STREAMLINE_CODE_DEFAULTS[normalizeStreamlineAgent(agent)];
    return {
        host: 'machine-a', platform: 'linux', happyCliVersion: '1.0.0', happyHomeDir: '/home/.happyherd', homeDir: '/home',
        agentCapabilities: {
            [agent]: {
                detectedAt: 1,
                sources: { models: 'machine', effortLevels: 'machine', permissionModes: 'machine' },
                models: [option('first-model'), option(defaults?.modelMode || 'latest-grok', true)],
                permissionModes: [option('first-permission'), option(defaults?.permissionMode || 'default', true)],
                effortLevels: [option('low'), option('medium', true), option('high'), option('xhigh')],
                ...overrides,
            },
        },
    };
}

const empty = { permissionMode: null, modelMode: null, effortLevel: null };

describe('Streamline defaults on the exact selected machine', () => {
    it.each([
        ['claude', HAPPYHERD_CLAUDE_OPUS_5_5_MODEL_SLUG, 'xhigh', 'acceptEdits'],
        ['codex', 'gpt-6-astra', 'xhigh', 'default'],
        ['grok', 'latest-grok', 'high', 'acceptEdits'],
        ['dsh', 'deepseek-v4-flash', 'medium', 'default'],
    ])('uses the advertised Streamline defaults for %s', (agent, modelMode, effortLevel, permissionMode) => {
        expect(resolveStreamlineSelection({ agent, machineMetadata: metadata(agent) })).toEqual({ permissionMode, modelMode, effortLevel });
    });

    it.each(['claude', 'codex', 'grok', 'dsh'])('preserves valid %s overrides independently of Agent Defaults', (agent) => {
        const overrides = { [agent]: { modelMode: 'first-model', permissionMode: 'first-permission', effortLevel: 'low' } };
        expect(resolveStreamlineSelection({
            agent, machineMetadata: metadata(agent), streamlineAgentDefaults: overrides,
            agentDefaultOverrides: { [agent]: { modelMode: 'advanced-model', permissionMode: 'bypassPermissions', effortLevel: 'max' } },
        })).toEqual(overrides[agent]);
    });

    it.each(['claude', 'codex', 'grok', 'dsh'])('falls back from unadvertised %s preferences without rewriting them', (agent) => {
        const overrides = { [agent]: { modelMode: 'removed', permissionMode: 'removed', effortLevel: 'removed' } };
        expect(resolveStreamlineSelection({ agent, machineMetadata: metadata(agent), streamlineAgentDefaults: overrides })).toEqual({
            modelMode: STREAMLINE_CODE_DEFAULTS[normalizeStreamlineAgent(agent)]?.modelMode || 'latest-grok',
            permissionMode: STREAMLINE_CODE_DEFAULTS[normalizeStreamlineAgent(agent)]?.permissionMode,
            effortLevel: agent === 'claude' || agent === 'codex' ? 'xhigh' : 'medium',
        });
        expect(overrides[agent].modelMode).toBe('removed');
    });

    it.each(['claude', 'codex', 'grok', 'dsh'])('prefers %s accept-edits permission over a more permissive catalog default', (agent) => {
        const permission = STREAMLINE_CODE_DEFAULTS[normalizeStreamlineAgent(agent)]!.permissionMode;
        const machineMetadata = metadata(agent, { permissionModes: [option('yolo', true), option(permission)] });
        expect(resolveStreamlineSelection({ agent, machineMetadata, streamlineAgentDefaults: { [agent]: { permissionMode: 'removed' } } }).permissionMode).toBe(permission);
        machineMetadata.agentCapabilities![agent].permissionModes = [option('first'), option('catalog-default', true)];
        expect(resolveStreamlineSelection({ agent, machineMetadata }).permissionMode).toBe('catalog-default');
    });

    it('uses model defaults followed by first options when code defaults are unsupported', () => {
        const machineMetadata = metadata('claude', {
            models: [option('model-a'), { ...option('model-b', true), effortLevels: [option('low', true), option('high')] }],
            permissionModes: [option('mode-a'), option('mode-b', true)],
        });
        expect(resolveStreamlineSelection({ agent: 'claude', machineMetadata })).toEqual({ modelMode: 'model-b', permissionMode: 'mode-b', effortLevel: 'high' });
        machineMetadata.agentCapabilities!.claude.models = [option('model-a')];
        machineMetadata.agentCapabilities!.claude.permissionModes = [option('mode-a')];
        expect(resolveStreamlineSelection({ agent: 'claude', machineMetadata }).modelMode).toBe('model-a');
        expect(resolveStreamlineSelection({ agent: 'claude', machineMetadata }).permissionMode).toBe('mode-a');
    });

    it('follows each Grok machine catalog default instead of choosing by model name or order', () => {
        for (const model of ['grok-new', 'machine-b-private-model']) {
            expect(resolveStreamlineSelection({ agent: 'grok', machineMetadata: metadata('grok', { models: [option('grok-999'), option(model, true)] }) }).modelMode).toBe(model);
        }
    });

    it('keeps model-specific effort authoritative, including explicitly empty lists', () => {
        const machineMetadata = metadata('codex', { models: [
            { ...option('gpt-6-astra', true), effortLevels: [] },
            { ...option('other'), effortLevels: [option('tiny'), option('large')] },
        ] });
        expect(resolveStreamlineSelection({ agent: 'codex', machineMetadata }).effortLevel).toBeNull();
        expect(resolveStreamlineSelection({ agent: 'codex', machineMetadata, streamlineAgentDefaults: { codex: { modelMode: 'other', effortLevel: 'xhigh' } } }).effortLevel).toBe('large');
    });

    it('retains the shared semantic maximum and Claude alias normalization', () => {
        const machineMetadata = metadata('claude', { models: [option('claude-opus-5')], effortLevels: [option('low'), option('max'), option('ultra')] });
        expect(resolveStreamlineSelection({ agent: 'claude', machineMetadata, streamlineAgentDefaults: { claude: { modelMode: 'opus', effortLevel: 'max' } } })).toEqual({ permissionMode: 'acceptEdits', modelMode: 'claude-opus-5', effortLevel: 'ultra' });
    });

    it('inherits existing agy Agent Defaults, with optional Streamline overrides', () => {
        const machineMetadata = metadata('agy', { models: [option('advanced-model'), option('streamline-model')] });
        const agentDefaultOverrides = { agy: { modelMode: 'advanced-model', effortLevel: 'high', permissionMode: 'first-permission' } };
        expect(resolveStreamlineSelection({ agent: 'agy', machineMetadata, agentDefaultOverrides })).toEqual(agentDefaultOverrides.agy);
        expect(resolveStreamlineSelection({ agent: 'agy', machineMetadata, agentDefaultOverrides, streamlineAgentDefaults: { agy: { modelMode: 'streamline-model' } } }).modelMode).toBe('streamline-model');
        expect(STREAMLINE_CODE_DEFAULTS.agy).toBeUndefined();
    });

    it('inherits agy code defaults when no user preference is saved', () => {
        const defaults = getCodeAgentDefaults('agy');
        const machineMetadata = metadata('agy', {
            models: [option(defaults.modelMode)],
            permissionModes: [option(defaults.permissionMode)],
            effortLevels: defaults.effortLevel ? [option(defaults.effortLevel)] : [],
        });
        expect(resolveStreamlineSelection({ agent: 'agy', machineMetadata })).toEqual(defaults);
    });

    it('uses Rig machine catalogs and provider-qualified keys with existing Agent Defaults', () => {
        const machineMetadata = {
            ...metadata('rig'), machineKind: 'rig', capabilities: { newSession: true },
            models: [
                { providerId: 'a', id: 'same', thinkingLevels: ['low', 'high'], defaultThinkingLevel: 'low' },
                { providerId: 'b', id: 'same', thinkingLevels: ['medium', 'max'], defaultThinkingLevel: 'medium' },
            ],
            operatingModes: [option('dontAsk'), option('default')],
            defaults: { providerId: 'b', modelId: 'same', permissionMode: 'default' },
        } as unknown as MachineMetadata;
        expect(resolveStreamlineSelection({ agent: 'rig', machineMetadata })).toEqual({ modelMode: 'b:same', permissionMode: 'default', effortLevel: 'medium' });
        const agentDefaultOverrides = { rig: { modelMode: 'a:same', permissionMode: 'dontAsk', effortLevel: 'high' } };
        expect(resolveStreamlineSelection({ agent: 'rig', machineMetadata, agentDefaultOverrides })).toEqual(agentDefaultOverrides.rig);
        expect(resolveStreamlineSelection({ agent: 'rig', machineMetadata, agentDefaultOverrides: { rig: { modelMode: 'gone', permissionMode: 'gone', effortLevel: 'gone' } } })).toEqual({ modelMode: 'b:same', permissionMode: 'default', effortLevel: 'medium' });
    });

    it.each(['claude', 'codex', 'gemini', 'grok', 'dsh', 'agy', 'rig'])('returns no guessed launch values for %s without its machine catalog', (agent) => {
        expect(resolveStreamlineSelection({ agent, machineMetadata: null })).toEqual(empty);
        expect(resolveStreamlineSelection({ agent, machineMetadata: { ...metadata(agent), agentCapabilities: {} } })).toEqual(empty);
        expect(resolveStreamlineSelection({ agent, machineMetadata: metadata(agent, { models: [], permissionModes: [], effortLevels: [] }) })).toEqual(empty);
    });

    it('keeps independently missing dimensions empty', () => {
        expect(resolveStreamlineSelection({ agent: 'dsh', machineMetadata: metadata('dsh', { permissionModes: [], effortLevels: [] }) })).toEqual({ modelMode: 'deepseek-v4-flash', permissionMode: null, effortLevel: null });
        expect(resolveStreamlineSelection({ agent: 'dsh', machineMetadata: metadata('dsh', { models: [] }) })).toEqual({ modelMode: null, permissionMode: 'default', effortLevel: null });
        expect(resolveStreamlineSelection({ agent: 'rig', machineMetadata: {
            ...metadata('rig'), machineKind: 'rig', capabilities: { newSession: true },
        } as unknown as MachineMetadata })).toEqual(empty);
    });

    it.each([undefined, null, 'future-agent', 'toString'])('normalizes unknown or absent agent %s to Claude on read', (agent) => {
        expect(normalizeStreamlineAgent(agent)).toBe('claude');
        expect(resolveStreamlineSelection({ agent, machineMetadata: metadata('claude') }).modelMode).toBe(HAPPYHERD_CLAUDE_OPUS_5_5_MODEL_SLUG);
    });
});
