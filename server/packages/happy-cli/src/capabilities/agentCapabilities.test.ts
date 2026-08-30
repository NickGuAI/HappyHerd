import { describe, expect, it } from 'vitest';

import {
    buildClaudeCapabilityCatalog,
    buildBaselineAgentCapabilities,
    buildGrokAcpCapabilityCatalog,
    detectAgentCapabilities,
    parseClaudeHelp,
    parseGrokPermissionModeHelp,
} from './agentCapabilities';

const GROK_HELP = `
      --permission-mode <MODE>
          Permission mode

          [possible values: default, acceptEdits, auto, dontAsk, bypassPermissions, plan]
`;

describe('agent capability discovery', () => {
    it('parses only structured Claude CLI choices and never help-text model prose', () => {
        const help = `
  --effort <level> Effort level for the current session
                   (low, medium, high, xhigh, max)
  --model <model> Model for the current session. Provide
                   an alias for the latest model (e.g.
                   'fable', 'opus', or 'sonnet') or a
                   model's full name (e.g.
                   'claude-fable-5').
  --permission-mode <mode> Permission mode (choices: "acceptEdits", "auto",
                   "bypassPermissions", "manual", "dontAsk", "plan")
  --plugin-dir <path> Plugin path
        `;
        const parsed = parseClaudeHelp(help);
        const catalog = buildClaudeCapabilityCatalog(help, 1, '2.1.220 (Claude Code)');

        expect(parsed.effortLevels.map((effort) => effort.code)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        expect(parsed.permissionModes.map((mode) => mode.code)).toEqual([
            'acceptEdits',
            'auto',
            'bypassPermissions',
            'manual',
            'dontAsk',
            'plan',
        ]);
        expect(catalog.sources.models).toBe('happyherd-release-catalog');
        expect(catalog.models.map((model) => model.code)).toEqual([
            'default',
            'claude-fable-5',
            'claude-opus-5',
            'claude-opus-5[1m]',
            'claude-opus-4-8',
            'claude-opus-4-6',
            'claude-sonnet-5',
            'claude-haiku-4-5',
        ]);
        expect(catalog.models.map((model) => model.value)).not.toContain(expect.stringContaining('full name'));
        expect(catalog.permissionModes.map((mode) => mode.code)).toEqual([
            'default',
            'acceptEdits',
            'auto',
            'bypassPermissions',
            'dontAsk',
            'plan',
        ]);
        expect(catalog.effortLevels.filter((effort) => effort.isDefault)).toEqual([
            expect.objectContaining({ code: 'max' }),
        ]);
    });

    it('accepts a new Codex model without a Web release', async () => {
        const { capabilities } = await detectAgentCapabilities({
            claude: false,
            codex: true,
            gemini: false,
            grok: false,
            agy: false,
            detectedAt: 1,
        }, {
            loadCodexModels: async () => [{
                id: 'future-id',
                model: 'gpt-future-codex',
                displayName: 'GPT Future Codex',
                description: 'Advertised by the installed provider',
                hidden: false,
                supportedReasoningEfforts: [
                    { reasoningEffort: 'medium', description: 'Balanced' },
                    { reasoningEffort: 'ultra', description: 'Deepest reasoning' },
                ],
                defaultReasoningEffort: 'medium',
                isDefault: true,
            }],
        });

        expect(capabilities.codex.sources.models).toBe('codex-app-server:model/list');
        expect(capabilities.codex.models.map((model) => model.code)).toEqual([
            'default',
            'gpt-future-codex',
        ]);
        expect(capabilities.codex.models[1].effortLevels?.map((effort) => effort.code)).toEqual([
            'medium',
            'ultra',
        ]);
        expect(capabilities.codex.models[1].effortLevels?.filter((effort) => effort.isDefault)).toEqual([
            expect.objectContaining({ code: 'ultra' }),
        ]);
        expect(capabilities.codex.permissionModes).toContainEqual(
            expect.objectContaining({ code: 'yolo', isDefault: true }),
        );
    });

    it('uses only app-server-compatible effort fallbacks when live Codex discovery is unavailable', async () => {
        const { capabilities } = await detectAgentCapabilities({
            claude: false,
            codex: true,
            gemini: false,
            grok: false,
            agy: false,
            detectedAt: 1,
        }, {
            loadCodexModels: async () => {
                throw new Error('app-server unavailable');
            },
        });

        expect(capabilities.codex.effortLevels.map((effort) => effort.code)).toEqual([
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ]);
        expect(capabilities.codex.permissionModes.map((mode) => mode.code)).toEqual([
            'default',
            'auto',
            'read-only',
            'safe-yolo',
            'yolo',
        ]);
        expect(capabilities.codex.permissionModes.filter((mode) => mode.isDefault)).toEqual([
            expect.objectContaining({ code: 'yolo' }),
        ]);
        expect(capabilities.codex.models.filter((model) => model.isDefault)).toEqual([
            expect.objectContaining({ code: 'gpt-5.6-sol' }),
        ]);
        expect(capabilities.codex.effortLevels.filter((effort) => effort.isDefault)).toEqual([
            expect.objectContaining({ code: 'max' }),
        ]);
    });

    it('advertises the concrete Antigravity runtime model default', () => {
        const capabilities = buildBaselineAgentCapabilities({
            claude: false,
            codex: false,
            gemini: false,
            grok: false,
            agy: true,
            detectedAt: 1,
        });

        expect(capabilities.agy.models.filter((model) => model.isDefault)).toEqual([
            expect.objectContaining({ code: 'Gemini 3.1 Pro (High)' }),
        ]);
    });

    it('derives GrokBuild models, efforts, defaults, and capabilities from ACP initialize', async () => {
        const initialize = {
            protocolVersion: 1,
            agentCapabilities: {
                loadSession: true,
                promptCapabilities: { image: false, audio: false, embeddedContext: true },
            },
            _meta: {
                agentVersion: '1.0.5',
                modelState: {
                    currentModelId: 'runtime-current',
                    availableModels: [
                        {
                            modelId: 'runtime-current',
                            name: 'Runtime Current',
                            description: 'Advertised now',
                            _meta: { reasoningEfforts: [
                                { id: 'deep', value: 'deep', label: 'Deep', description: 'Thorough', default: false },
                                { id: 'balanced', value: 'balanced', label: 'Balanced', description: 'Default', default: true },
                            ] },
                        },
                        {
                            modelId: 'runtime-fast',
                            name: 'Runtime Fast',
                            _meta: { reasoningEfforts: [
                                { id: 'quick', value: 'quick', label: 'Quick', default: true },
                            ] },
                        },
                    ],
                },
            },
        } as const;

        const parsedModes = parseGrokPermissionModeHelp(GROK_HELP);
        const catalog = buildGrokAcpCapabilityCatalog(initialize, GROK_HELP, 123);
        const { capabilities } = await detectAgentCapabilities({
            claude: false,
            codex: false,
            gemini: false,
            grok: true,
            agy: false,
            detectedAt: 1,
        }, {
            loadGrokInitialize: async () => initialize,
            loadGrokHelp: () => GROK_HELP,
        });

        expect(catalog.providerVersion).toBe('1.0.5');
        expect(catalog.models.map((model) => [model.code, model.isDefault])).toEqual([
            ['runtime-current', true],
            ['runtime-fast', false],
        ]);
        expect(catalog.models[0].effortLevels).toEqual([
            expect.objectContaining({ code: 'deep', isDefault: false }),
            expect.objectContaining({ code: 'balanced', isDefault: true }),
        ]);
        expect(catalog.effortLevels.map((effort) => effort.code)).toEqual(['deep', 'balanced', 'quick']);
        expect(parsedModes.map((mode) => mode.code)).toEqual([
            'default',
            'acceptEdits',
            'auto',
            'dontAsk',
            'bypassPermissions',
            'plan',
        ]);
        expect(catalog.permissionModes.map((mode) => [mode.code, mode.isDefault])).toEqual([
            ['default', true],
            ['acceptEdits', false],
            ['auto', false],
            ['dontAsk', false],
            ['bypassPermissions', false],
            ['plan', false],
        ]);
        expect(catalog.permissionModes.every((mode) => mode.description)).toBe(true);
        expect(catalog.sources.permissionModes).toBe('grok-cli-help:--permission-mode');
        expect(catalog.acp).toEqual({
            loadSession: true,
            prompt: { image: false },
        });
        expect(capabilities.grok.sources.models).toBe('acp:initialize:_meta.modelState');
        expect(capabilities.grok.models[0].code).toBe('runtime-current');
    });

    it('falls back to exactly the GrokBuild default when help advertises no permission choices', () => {
        const initialize = {
            protocolVersion: 1,
            agentCapabilities: {},
            _meta: {
                modelState: {
                    currentModelId: 'runtime-current',
                    availableModels: [{ modelId: 'runtime-current', name: 'Runtime Current' }],
                },
            },
        } as const;

        expect(parseGrokPermissionModeHelp(`
  --permission-mode <MODE> Permission mode
  --output <FORMAT>
      [possible values: json, text]
        `)).toEqual([]);
        const catalog = buildGrokAcpCapabilityCatalog(
            initialize,
            '  --permission-mode <MODE> Permission mode',
            123,
        );
        expect(catalog.permissionModes).toEqual([
            expect.objectContaining({ code: 'default', value: 'default', isDefault: true }),
        ]);
        expect(catalog.sources.permissionModes).toBe('provider-default');
    });

    it('keeps the fresh Codex catalog when the installed GrokBuild probe fails', async () => {
        const discovery = await detectAgentCapabilities({
            claude: false,
            codex: true,
            gemini: false,
            grok: true,
            agy: false,
            detectedAt: 1,
        }, {
            loadCodexModels: async () => [{
                id: 'fresh-id',
                model: 'gpt-fresh-codex',
                displayName: 'GPT Fresh Codex',
                description: 'Fresh from this discovery run',
                hidden: false,
                supportedReasoningEfforts: [
                    { reasoningEffort: 'medium', description: 'Balanced' },
                ],
                defaultReasoningEffort: 'medium',
                isDefault: true,
            }],
            loadGrokInitialize: async () => { throw new Error('not authenticated'); },
            loadGrokHelp: () => GROK_HELP,
        });

        expect(discovery.capabilities.codex.sources.models).toBe('codex-app-server:model/list');
        expect(discovery.capabilities.codex.models.map((model) => model.code)).toContain('gpt-fresh-codex');
        expect(discovery.capabilities.grok).toBeUndefined();
        expect(discovery.grokCapabilityError).toContain(
            'GrokBuild is installed but ACP capability discovery failed: not authenticated',
        );
    });
});
