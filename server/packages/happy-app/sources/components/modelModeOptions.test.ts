import { describe, expect, it } from 'vitest';
import {
    getAgyModelModes,
    getAgyPermissionModes,
    getAvailableModels,
    getAvailablePermissionModes,
    getCodexEffortLevels,
    getCodexModelModes,
    getCodexPermissionModes,
    getClaudeModelModes,
    getClaudePermissionModes,
    getGeminiPermissionModes,
    getDefaultEffortKey,
    getDefaultModelKey,
    getEffortLevelsForModel,
    getDefaultPermissionModeKey,
    getMachineAdvertisedEffortLevels,
    getMachineAdvertisedModels,
    getMachineAdvertisedPermissionModes,
    getSessionAvailableModels,
    getSessionAvailablePermissionModes,
    getSessionEffortLevelsForModel,
    includeConfiguredModel,
    getOpenClawPermissionModes,
    mapMetadataOptions,
    resolveCurrentOption,
} from './modelModeOptions';
import { sortPermissionModes } from '@/utils/permissionModeLabels';
import { rigMetadataFixture } from '@/sync/__testdata__/rigMetadata';

const translate = (key: string) => `tr:${key}`;

describe('modelModeOptions', () => {
    it('uses only the selected machine capability catalog', () => {
        const machineMetadata = {
            agentCapabilities: {
                codex: {
                    detectedAt: 1,
                    sources: { models: 'provider', effortLevels: 'provider', permissionModes: 'daemon' },
                    models: [
                        { code: 'default', value: 'default model' },
                        {
                            code: 'gpt-machine-only',
                            value: 'GPT Machine Only',
                            effortLevels: [{ code: 'ultra', value: 'ultra' }],
                        },
                    ],
                    effortLevels: [{ code: 'medium', value: 'medium' }],
                    permissionModes: [{ code: 'read-only', value: 'read only' }],
                },
            },
        } as any;

        expect(getMachineAdvertisedModels(machineMetadata, 'codex', translate).map((model) => model.key)).toEqual([
            'default',
            'gpt-machine-only',
        ]);
        expect(getMachineAdvertisedPermissionModes(machineMetadata, 'codex', translate).map((mode) => mode.key)).toEqual([
            'read-only',
        ]);
        expect(getMachineAdvertisedModels(machineMetadata, 'codex', translate, 'stale-model')[0]).toMatchObject({
            key: 'stale-model',
            description: 'tr:modelMode.unavailableSelectedDaemon',
            unavailable: true,
            disabled: true,
        });
        expect(getMachineAdvertisedEffortLevels(machineMetadata, 'codex', 'gpt-machine-only').map((mode) => mode.key)).toEqual([
            'ultra',
        ]);
    });

    it('resolves the default model effort from the provider-designated default model', () => {
        const machineMetadata = {
            agentCapabilities: {
                codex: {
                    detectedAt: 1,
                    sources: { models: 'provider', effortLevels: 'provider', permissionModes: 'daemon' },
                    models: [
                        { code: 'default', value: 'default model' },
                        {
                            code: 'gpt-default',
                            value: 'GPT Default',
                            isDefault: true,
                            effortLevels: [
                                { code: 'medium', value: 'medium' },
                                { code: 'xhigh', value: 'xhigh' },
                            ],
                        },
                        {
                            code: 'gpt-other',
                            value: 'GPT Other',
                            effortLevels: [{ code: 'ultra', value: 'ultra' }],
                        },
                    ],
                    effortLevels: [
                        { code: 'medium', value: 'medium' },
                        { code: 'xhigh', value: 'xhigh' },
                        { code: 'ultra', value: 'ultra' },
                    ],
                    permissionModes: [{ code: 'yolo', value: 'full access' }],
                },
            },
        } as any;

        expect(getMachineAdvertisedEffortLevels(machineMetadata, 'codex', 'default').map((mode) => mode.key)).toEqual([
            'medium',
            'xhigh',
        ]);
    });

    it('honors an explicit empty effort list instead of borrowing another model\'s efforts', () => {
        const machineMetadata = {
            agentCapabilities: {
                codex: {
                    detectedAt: 1,
                    sources: { models: 'provider', effortLevels: 'provider', permissionModes: 'provider' },
                    models: [
                        {
                            code: 'no-reasoning',
                            value: 'No reasoning',
                            effortLevels: [],
                            isDefault: true,
                        },
                        {
                            code: 'reasoning',
                            value: 'Reasoning',
                            effortLevels: [{ code: 'xhigh', value: 'xhigh' }],
                        },
                    ],
                    effortLevels: [{ code: 'xhigh', value: 'xhigh' }],
                    permissionModes: [],
                },
            },
        } as any;

        expect(getMachineAdvertisedEffortLevels(
            machineMetadata,
            'codex',
            'no-reasoning',
        )).toEqual([]);
        expect(getMachineAdvertisedEffortLevels(
            machineMetadata,
            'codex',
            'stale-model',
        )).toEqual([]);
    });

    it('uses the New Session machine catalog for active session controls', () => {
        const machineMetadata = {
            agentCapabilities: {
                codex: {
                    detectedAt: 1,
                    sources: { models: 'provider', effortLevels: 'provider', permissionModes: 'daemon' },
                    models: [
                        { code: 'default', value: 'default model' },
                        {
                            code: 'gpt-machine-only',
                            value: 'GPT Machine Only',
                            effortLevels: [{ code: 'ultra', value: 'ultra' }],
                        },
                    ],
                    effortLevels: [{ code: 'medium', value: 'medium' }],
                    permissionModes: [{ code: 'read-only', value: 'read only' }],
                },
            },
        } as any;
        const sessionMetadata = {
            flavor: 'codex',
            models: [{ code: 'stale-model', value: 'Stale model' }],
            operatingModes: [{ code: 'stale-mode', value: 'Stale mode' }],
        } as any;

        expect(getSessionAvailableModels(
            'codex',
            sessionMetadata,
            machineMetadata,
            translate,
            'gpt-machine-only',
        )).toEqual(getMachineAdvertisedModels(machineMetadata, 'codex', translate));
        expect(getSessionAvailablePermissionModes(
            'codex',
            sessionMetadata,
            machineMetadata,
            translate,
            'read-only',
        )).toEqual(getMachineAdvertisedPermissionModes(machineMetadata, 'codex', translate));

        const effortLevels = getSessionEffortLevelsForModel(
            'codex',
            'gpt-machine-only',
            sessionMetadata,
            machineMetadata,
        );
        expect(effortLevels).toEqual(getMachineAdvertisedEffortLevels(
            machineMetadata,
            'codex',
            'gpt-machine-only',
        ));
        expect(resolveCurrentOption(effortLevels, ['ultra', 'medium'])?.key).toBe('ultra');
    });

    it('maps metadata option shape into mode options', () => {
        expect(mapMetadataOptions([
            { code: 'm1', value: 'Model One', description: 'Primary model' },
            { code: 'm2', value: 'Model Two' },
        ])).toEqual([
            { key: 'm1', name: 'Model One', description: 'Primary model' },
            { key: 'm2', name: 'Model Two', description: null },
        ]);
    });

    it('names claude permission modes with one word each, most-used first', () => {
        const modes = getClaudePermissionModes(translate);
        expect(modes.map((mode) => [mode.key, mode.name])).toEqual([
            ['auto', 'Auto'],
            ['acceptEdits', 'Edits'],
            ['plan', 'Plan'],
            ['bypassPermissions', 'Yolo'],
            ['default', 'Default'],
        ]);
        expect(modes[0].description).toBe('tr:agentInput.permissionMode.auto');
    });

    // auto belongs to the Agent SDK's own PermissionMode union and is carried
    // by MessageMetaSchema. dontAsk is in neither, so sending it fails
    // UserMessageSchema.safeParse and drops the whole prompt.
    it('offers auto and still drops dontAsk, which the CLI rejects', () => {
        const keys = getClaudePermissionModes(translate).map((mode) => mode.key);
        expect(keys).toContain('auto');
        expect(keys).not.toContain('dontAsk');
    });

    it('leads both shipped harnesses with Auto', () => {
        expect(getClaudePermissionModes(translate)[0].key).toBe('auto');
        expect(getCodexPermissionModes(translate)[0].key).toBe('auto');
    });

    it('never calls a harness default Auto, which is a reviewed mode and not a default', () => {
        const named = (modes: { key: string; name: string }[]) => modes.find((mode) => mode.key === 'default')?.name;
        expect(named(getClaudePermissionModes(translate))).toBe('Default');
        expect(named(getCodexPermissionModes(translate))).toBe('Default');
        expect(named(getAgyPermissionModes(translate))).toBe('Default');
        expect(named(getGeminiPermissionModes(translate))).toBe('Default');
    });

    // The hardcoded catalogs are written in order rather than sorted, so this
    // is what stops them drifting out of step with the rank table.
    it.each([
        ['claude', getClaudePermissionModes],
        ['codex', getCodexPermissionModes],
        ['gemini', getGeminiPermissionModes],
        ['openclaw', getOpenClawPermissionModes],
    ] as const)('lists %s modes in the shared rank order', (_flavor, build) => {
        const modes = build(translate);
        expect(modes.map((mode) => mode.key)).toEqual(sortPermissionModes(modes).map((mode) => mode.key));
    });

    it('leads agy with Default, the one harness where Default is the safe mode', () => {
        // Deliberately against the shared ranking: agy --print cannot prompt, so
        // its Default is the sandboxed launch default rather than "ask me first".
        expect(getAgyPermissionModes(translate).map((mode) => mode.key)).toEqual([
            'default',
            'bypassPermissions',
        ]);
        expect(getDefaultPermissionModeKey('agy')).toBe('default');
    });

    it('only offers gemini modes runGemini actually honours', () => {
        // auto_edit is absent from MessageMetaSchema and would drop the whole
        // message; plan passes the schema but runGemini ignores it.
        const keys = getGeminiPermissionModes(translate).map((mode) => mode.key);
        expect(keys).not.toContain('auto_edit');
        expect(keys).not.toContain('plan');
    });

    it('only offers the curated codex harness models', () => {
        const models = getCodexModelModes();
        expect(models.map((model) => model.key)).toEqual([
            'gpt-5.6-sol',
            'gpt-5.6-terra',
            'gpt-5.6-luna',
        ]);
        expect(models[0].name).toBe('gpt-5.6 sol');
    });

    it('builds Claude fallbacks from exact model slugs', () => {
        const models = getClaudeModelModes();
        expect(models.map((model) => model.key)).toEqual([
            'default',
            'claude-fable-5',
            'claude-opus-5',
            'claude-opus-4-8',
            'claude-opus-4-6',
            'claude-sonnet-5',
            'claude-haiku-4-5',
        ]);
        expect(models.find((model) => model.key === 'claude-opus-4-6')).toEqual({
            key: 'claude-opus-4-6',
            name: 'claude-opus-4-6',
            description: null,
        });
    });

    it('shows a configured custom codex model only as an unavailable recovery value', () => {
        const models = getCodexModelModes();
        const withCustom = includeConfiguredModel('codex', models, 'my-workspace-model', translate);

        expect(withCustom.map((model) => model.key)).toEqual([
            'gpt-5.6-sol',
            'gpt-5.6-terra',
            'gpt-5.6-luna',
            'my-workspace-model',
        ]);
        expect(withCustom.at(-1)).toMatchObject({
            description: 'tr:modelMode.savedModelUnavailableDaemon',
            unavailable: true,
            disabled: true,
        });
        expect(models).toHaveLength(3);
        expect(includeConfiguredModel('claude', models, 'my-workspace-model', translate)).toBe(models);
    });

    it('offers every codex model the levels its own registry publishes', () => {
        // Straight from codex-rs/models-manager/models.json: sol and terra
        // publish ultra, luna does not. The difference is the whole point of
        // asking per model rather than per flavor.
        expect(getEffortLevelsForModel('codex', 'gpt-5.6-sol').map((level) => level.key))
            .toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
        expect(getEffortLevelsForModel('codex', 'gpt-5.6-terra').map((level) => level.key))
            .toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
        expect(getEffortLevelsForModel('codex', 'gpt-5.6-luna').map((level) => level.key))
            .toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('falls back to the conservative codex range for an unknown model', () => {
        const keys = getEffortLevelsForModel('codex', 'my-workspace-model').map((level) => level.key);
        expect(keys).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('offers claude the SDK effort union for every model', () => {
        // Claude's scale belongs to the SDK, not the model: an unreachable level
        // is silently downgraded, so all three models get the same list.
        for (const model of ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5']) {
            const keys = getEffortLevelsForModel('claude', model).map((level) => level.key);
            expect(keys).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
            // Claude's floor is `low`; there is no off.
            expect(keys).not.toContain('off');
        }
    });

    it('uses code defaults for agent defaults', () => {
        expect(getDefaultPermissionModeKey('claude')).toBe('bypassPermissions');
        expect(getDefaultModelKey('claude')).toBe('claude-opus-5');
        expect(getDefaultEffortKey('claude')).toBe('max');
        expect(getDefaultPermissionModeKey('codex')).toBe('yolo');
        expect(getDefaultModelKey('codex')).toBe('gpt-5.6-sol');
        expect(getDefaultEffortKey('codex')).toBe('max');
        expect(getCodexEffortLevels()).toEqual([
            { key: 'low', name: 'low' },
            { key: 'medium', name: 'medium' },
            { key: 'high', name: 'high' },
            { key: 'xhigh', name: 'xhigh' },
        ]);
    });

    it('prefers metadata models over hardcoded fallbacks', () => {
        const models = getAvailableModels('gemini', {
            models: [
                { code: 'custom-gemini', value: 'Gemini Custom', description: 'From metadata' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'custom-gemini', name: 'Gemini Custom', description: 'From metadata' },
        ]);
    });

    it('adds codex default model option when metadata models are present', () => {
        const models = getAvailableModels('codex', {
            models: [
                { code: 'gpt-5.4', value: 'gpt-5.4', description: 'Latest' },
            ],
        } as any, translate);

        expect(models).toEqual([
            { key: 'default', name: 'default model', description: null },
            { key: 'gpt-5.4', name: 'gpt-5.4', description: 'Latest' },
        ]);
    });

    it('keeps codex permission modes hardcoded even when metadata modes exist', () => {
        const modes = getAvailablePermissionModes('codex', {
            operatingModes: [{ code: 'metadata-only', value: 'Metadata Mode', description: null }],
        } as any, translate);

        expect(modes.map((mode) => [mode.key, mode.name])).toEqual([
            ['auto', 'Auto'],
            ['safe-yolo', 'Workspace'],
            ['read-only', 'Read'],
            ['yolo', 'Yolo'],
            ['default', 'Default'],
        ]);
        expect(modes.find((mode) => mode.key === 'safe-yolo')?.description).toBe('tr:agentInput.codexPermissionMode.safeYoloDescription');
    });

    it('applies hacks to metadata-provided operating modes', () => {
        const modes = getAvailablePermissionModes('gemini', {
            operatingModes: [
                { code: 'build', value: 'build, build', description: 'Do build steps' },
                { code: 'plan', value: 'plan/plan', description: 'Plan first' },
            ],
        } as any, translate);

        expect(modes).toEqual([
            { key: 'plan', name: 'Plan', description: 'Plan first' },
            { key: 'build', name: 'Build', description: 'Do build steps' },
        ]);
    });

    it('gives agy its own models, not the claude fallback', () => {
        const models = getAvailableModels('agy', null, translate);
        // must be agy's own list, not claude's opus/sonnet/haiku
        expect(models).toEqual(getAgyModelModes());
        const keys = models.map((m) => m.key);
        // the agentDefaults agy default must be selectable
        expect(keys).toContain('Gemini 3.1 Pro (High)');
        expect(getDefaultModelKey('agy')).toBe('Gemini 3.1 Pro (High)');
        // no 'default' entry — agy would receive the literal string "default" as --model
        expect(keys).not.toContain('default');
        // not the claude list
        expect(keys).not.toContain('opus');
        expect(keys).not.toContain('sonnet');
    });

    it('resolves the first matching preferred key', () => {
        const options = [
            { key: 'a', name: 'A' },
            { key: 'b', name: 'B' },
        ];

        expect(resolveCurrentOption(options, ['missing', 'b', 'a'])).toEqual({ key: 'b', name: 'B' });
        expect(resolveCurrentOption(options, ['missing'])).toBeNull();
    });

    it('builds the Rig catalog dynamically with provider-qualified keys', () => {
        const models = getAvailableModels('codex', rigMetadataFixture, translate);
        expect(models.map((model) => [model.key, model.name, model.providerName])).toEqual([
            ['codex:shared-model', 'GPT Shared', 'OpenAI Codex'],
            ['claude:shared-model', 'Claude Shared', 'Anthropic Claude'],
        ]);
        expect(models.some((model) => model.key === 'default')).toBe(false);
    });

    it('renders all native Happy permission codes and semantic kinds without flavor fallbacks', () => {
        const modes = getAvailablePermissionModes('codex', rigMetadataFixture, translate);
        expect(modes.map((mode) => [mode.key, mode.name, mode.semanticKind])).toEqual([
            ['auto', 'Auto', 'safe-yolo'],
            ['workspace_write', 'Workspace write', 'default'],
            ['read_only', 'Read only', 'read-only'],
            ['full_access', 'Full access', 'yolo'],
        ]);
    });

    it('shows a missing current Rig model as unavailable instead of selecting another model', () => {
        const metadata = {
            ...rigMetadataFixture,
            currentModelProviderId: 'custom-provider',
            currentModelCode: 'temporarily-missing',
        };
        const models = getAvailableModels('codex', metadata, translate);
        expect(models[0]).toMatchObject({
            key: 'custom-provider:temporarily-missing',
            unavailable: true,
            disabled: true,
        });
    });

    it('retains flavor-based catalogs before the Rig metadata extension', () => {
        const metadata = {
            path: '/tmp/rig',
            host: 'host',
            flavor: 'codex',
            client: { id: 'rig', name: 'Rig', version: '0.9.0' },
        } as any;

        expect(getAvailableModels('codex', metadata, translate)).toEqual(getCodexModelModes());
        expect(getAvailablePermissionModes('codex', metadata, translate).map((mode) => mode.key)).toEqual([
            'auto', 'safe-yolo', 'read-only', 'yolo', 'default',
        ]);
    });
});
