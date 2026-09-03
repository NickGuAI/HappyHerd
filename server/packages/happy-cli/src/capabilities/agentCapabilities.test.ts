import { describe, expect, it, vi } from 'vitest';

const probeMocks = vi.hoisted(() => ({
    backendOptions: null as Record<string, unknown> | null,
    disposeCalls: 0,
    mkdtemp: vi.fn(async () => '/tmp/happyherd-dsh-capabilities-test'),
    rm: vi.fn(async () => undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
    ...(await importOriginal<typeof import('node:fs/promises')>()),
    mkdtemp: probeMocks.mkdtemp,
    rm: probeMocks.rm,
}));

vi.mock('@/agent/acp/AcpBackend', () => ({
    AcpBackend: class {
        private listener: ((message: any) => void) | null = null;

        constructor(options: Record<string, unknown>) {
            probeMocks.backendOptions = options;
        }

        onMessage(listener: (message: any) => void) {
            this.listener = listener;
        }

        async startSession() {
            this.listener?.({
                type: 'event',
                name: 'initialize_response',
                payload: {
                    protocolVersion: 1,
                    agentCapabilities: { promptCapabilities: { image: false } },
                    agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
                },
            });
            this.listener?.({
                type: 'event',
                name: 'config_options_update',
                payload: { configOptions: dshProbe().configOptions },
            });
            return { sessionId: 'probe', providerSessionId: 'dsh-probe' };
        }

        async dispose() {
            probeMocks.disposeCalls += 1;
        }
    },
}));

import {
    assertDshPermissionSettingsCompatible,
    buildClaudeCapabilityCatalog,
    buildBaselineAgentCapabilities,
    buildDshAcpCapabilityCatalog,
    buildGrokAcpCapabilityCatalog,
    detectAgentCapabilities,
    parseClaudeHelp,
    parseDshPermissionProfile,
    parseGrokPermissionModeHelp,
    resolveDshLaunchPermissionMode,
    type DshAcpProbeResult,
} from './agentCapabilities';

const GROK_HELP = `
      --permission-mode <MODE>
          Permission mode

          [possible values: default, acceptEdits, auto, dontAsk, bypassPermissions, plan]
`;

const DSH_PERMISSION_PROFILE = `
- id: settings
  name: '@deepseek-ai/dsh-settings-file'
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: !!js >-
      (process.env.DSH_PERMISSION_MODE ?? 'workspace-write') ===
      'danger-full-access' ? 'never' : 'ask'
`;

function dshProbe(overrides?: {
    currentModel?: string;
    models?: Array<{ value: string; name: string }>;
    currentEffort?: string;
    efforts?: Array<{ value: string; name: string }>;
    extraConfigOptions?: unknown[];
}): DshAcpProbeResult {
    const official = (slug: string) => JSON.stringify(['deepseek-official', slug]);
    return {
        initialize: {
            protocolVersion: 1,
            agentCapabilities: { promptCapabilities: { image: false } },
            agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' },
        } as DshAcpProbeResult['initialize'],
        providerVersion: '0.1.2-alpha.4',
        permissionProfile: parseDshPermissionProfile(DSH_PERMISSION_PROFILE),
        configOptions: [
            {
                type: 'select',
                id: 'model',
                name: 'Model',
                category: 'model',
                currentValue: overrides?.currentModel ?? official('deepseek-v4-flash'),
                options: overrides?.models ?? [
                    { value: official('deepseek-v4-flash'), name: 'DeepSeek V4 Flash' },
                    { value: official('deepseek-v4-pro'), name: 'DeepSeek V4 Pro' },
                ],
            },
            {
                type: 'select',
                id: 'reasoning_effort',
                name: 'Reasoning Effort',
                category: 'thought_level',
                currentValue: overrides?.currentEffort ?? 'high',
                options: overrides?.efforts ?? [
                    { value: 'off', name: 'Off' },
                    { value: 'high', name: 'High' },
                    { value: 'max', name: 'Max' },
                ],
            },
            ...((overrides?.extraConfigOptions ?? []) as DshAcpProbeResult['configOptions']),
        ],
    };
}

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
            dsh: false,
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
            dsh: false,
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
            dsh: false,
            agy: true,
            detectedAt: 1,
        });

        expect(capabilities.agy.models.filter((model) => model.isDefault)).toEqual([
            expect.objectContaining({ code: 'Gemini 3.1 Pro (High)' }),
        ]);
    });

    it('publishes no speculative dsh catalog before its live ACP probe', () => {
        const unavailable = buildBaselineAgentCapabilities({
            claude: false,
            codex: false,
            gemini: false,
            grok: false,
            dsh: false,
            agy: false,
            detectedAt: 1,
        });
        const available = buildBaselineAgentCapabilities({
            claude: false,
            codex: false,
            gemini: false,
            grok: false,
            dsh: true,
            agy: false,
            detectedAt: 1,
        });

        expect(unavailable.dsh).toBeUndefined();
        expect(available.dsh).toBeUndefined();
    });

    it('runs the default dsh probe in an isolated temporary home with no MCP servers and exact cleanup', async () => {
        probeMocks.backendOptions = null;
        probeMocks.disposeCalls = 0;
        probeMocks.mkdtemp.mockClear();
        probeMocks.rm.mockClear();

        const discovery = await detectAgentCapabilities({
            claude: false,
            codex: false,
            gemini: false,
            grok: false,
            dsh: true,
            agy: false,
            detectedAt: 1,
        }, {
            loadDshPermissionProfile: () => DSH_PERMISSION_PROFILE,
            loadDshPermissionSettings: async () => null,
        });

        expect(discovery.capabilities.dsh.models).toHaveLength(2);
        expect(probeMocks.mkdtemp).toHaveBeenCalledOnce();
        expect(probeMocks.backendOptions).toMatchObject({
            agentName: 'dsh',
            cwd: '/tmp/happyherd-dsh-capabilities-test',
            command: 'dsh',
            args: ['--profile', 'acp'],
            mcpServers: {},
            processEnv: expect.objectContaining({ DSH_HOME: '/tmp/happyherd-dsh-capabilities-test' }),
        });
        expect(probeMocks.disposeCalls).toBe(1);
        expect(probeMocks.rm).toHaveBeenCalledWith(
            '/tmp/happyherd-dsh-capabilities-test',
            { recursive: true, force: true },
        );
    });

    it('adds and removes official dsh models dynamically with live defaults', async () => {
        const availability = {
            claude: false,
            codex: false,
            gemini: false,
            grok: false,
            dsh: true,
            agy: false,
            detectedAt: 1,
        };
        const official = (slug: string) => JSON.stringify(['deepseek-official', slug]);
        const first = await detectAgentCapabilities(availability, {
            loadDshProbe: async () => dshProbe({
                currentModel: official('deepseek-v4-pro'),
                currentEffort: 'max',
                models: [
                    { value: 'not-json', name: 'Malformed' },
                    { value: JSON.stringify(['third-party', 'deepseek-v4-pro']), name: 'Third Party Pro' },
                    { value: official('deepseek-v4-flash'), name: 'DeepSeek V4 Flash' },
                    { value: official('deepseek-v4-pro'), name: 'DeepSeek V4 Pro' },
                    { value: official('deepseek-v4-flash-vision-exp'), name: 'DeepSeek Vision Experimental' },
                ],
            }),
        });
        const second = await detectAgentCapabilities(availability, {
            loadDshProbe: async () => dshProbe({
                currentModel: official('deepseek-v5'),
                models: [{ value: official('deepseek-v5'), name: 'DeepSeek V5' }],
            }),
        });

        expect(first.capabilities.dsh.models.map((model) => [model.code, model.isDefault])).toEqual([
            ['deepseek-v4-flash', false],
            ['deepseek-v4-pro', true],
            ['deepseek-v4-flash-vision-exp', false],
        ]);
        expect(first.capabilities.dsh.effortLevels.map((effort) => [effort.code, effort.isDefault])).toEqual([
            ['off', false],
            ['high', false],
            ['max', true],
        ]);
        expect(first.capabilities.dsh.sources).toEqual({
            models: 'dsh-acp:session/new:configOptions',
            effortLevels: 'dsh-acp:session/new:configOptions',
            permissionModes: 'dsh:--profile-acp:dump-config:permission-presets',
        });
        expect(first.capabilities.dsh.permissionModes).toEqual([
            {
                code: 'read-only',
                value: 'read-only',
                description: 'sandbox=read-only; approval=ask',
                isDefault: false,
            },
            {
                code: 'workspace-write',
                value: 'workspace-write',
                description: 'sandbox=workspace-write; approval=ask',
                isDefault: true,
            },
            {
                code: 'danger-full-access',
                value: 'danger-full-access',
                description: 'sandbox=danger-full-access; approval=never',
                isDefault: false,
            },
        ]);
        expect(first.capabilities.dsh.providerVersion).toBe('0.1.2-alpha.4');
        expect(second.capabilities.dsh.models.map((model) => model.code)).toEqual(['deepseek-v5']);
    });

    it('uses only explicit dsh model and thought_level selects, never mode or permission lookalikes', () => {
        const catalog = buildDshAcpCapabilityCatalog(dshProbe({
            extraConfigOptions: [{
                type: 'select',
                id: 'model-permission-mode',
                name: 'Model Permission Mode',
                category: 'mode',
                currentValue: 'plan',
                options: [{ value: 'plan', name: 'Plan' }],
            }],
        }), 123);

        expect(catalog.models.map((model) => model.code)).toEqual([
            'deepseek-v4-flash',
            'deepseek-v4-pro',
        ]);
        expect(catalog.permissionModes.map((mode) => mode.code)).toEqual([
            'read-only',
            'workspace-write',
            'danger-full-access',
        ]);
        expect(catalog.models.filter((model) => model.isDefault)).toEqual([
            expect.objectContaining({ code: 'deepseek-v4-flash' }),
        ]);
        expect(catalog.effortLevels.filter((effort) => effort.isDefault)).toEqual([
            expect.objectContaining({ code: 'high' }),
        ]);
    });

    it('parses only provider-native dsh permission rows and their explicit default', () => {
        expect(parseDshPermissionProfile(DSH_PERMISSION_PROFILE)).toEqual({
            defaultMode: 'workspace-write',
            presets: [
                { code: 'read-only', sandbox: 'read-only', approval: 'ask' },
                { code: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' },
                { code: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' },
            ],
        });

        const providerNative = DSH_PERMISSION_PROFILE.replace(
            '      read-only:\n        sandbox: read-only\n        approval: ask',
            '      read-only:\n        sandbox: read-only\n        approval: ask\n        name: Read only\n        description: Provider-owned details.',
        );
        expect(parseDshPermissionProfile(providerNative).presets[0]).toEqual({
            code: 'read-only',
            sandbox: 'read-only',
            approval: 'ask',
            name: 'Read only',
            description: 'Provider-owned details.',
        });
    });

    it.each([
        ['missing plugin', DSH_PERMISSION_PROFILE.replace("  name: '@deepseek-ai/dsh-permission-presets'", "  name: '@deepseek-ai/other'")],
        ['malformed row', DSH_PERMISSION_PROFILE.replace('        approval: ask', '        unexpected: ask')],
        ['absent default', DSH_PERMISSION_PROFILE.replace("    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'", '    mode: !!js process.env.DSH_PERMISSION_MODE')],
        ['inconsistent default', DSH_PERMISSION_PROFILE.replace("?? 'workspace-write'", "?? 'missing-mode'")],
        ['inconsistent approval', DSH_PERMISSION_PROFILE.replace('        approval: ask', '        approval: never')],
        ['unlaunchable alias', DSH_PERMISSION_PROFILE.replace('      read-only:', '      review-only:')],
        ['disabled provider', DSH_PERMISSION_PROFILE.replace("  name: '@deepseek-ai/dsh-permission-presets'", "  name: '@deepseek-ai/dsh-permission-presets'\n  disabled: true")],
        ['executable replacement', DSH_PERMISSION_PROFILE.replace("?? 'workspace-write'", "? runCode() : 'workspace-write'")],
    ])('fails closed for %s dsh permission config', (_case, config) => {
        expect(() => parseDshPermissionProfile(config)).toThrow(/dsh/);
    });

    it('fails closed when dsh user settings can override the launch preset', () => {
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE,
            'llm-deepseek:\n  model: provider-model\n',
        )).not.toThrow();
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE,
            'permission:\n  defaultPreset: read-only\n',
        )).toThrow('permission.defaultPreset settings override');
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE,
            '  permission:\n    defaultPreset: danger-full-access\n',
        )).toThrow('permission.defaultPreset settings override');
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE,
            'permission :\n  defaultPreset: danger-full-access\n',
        )).toThrow('permission.defaultPreset settings override');
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE,
            JSON.stringify({ permission: { defaultPreset: 'danger-full-access' } }),
        )).toThrow('permission.defaultPreset settings override');
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE,
            'other: [\n',
        )).toThrow('settings YAML is malformed');
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE,
            '- not\n- a\n- mapping\n',
        )).toThrow('settings YAML root must be a mapping');
        expect(() => assertDshPermissionSettingsCompatible(
            DSH_PERMISSION_PROFILE.replace(
                "  name: '@deepseek-ai/dsh-settings-file'",
                "  name: '@deepseek-ai/dsh-settings-file'\n  config:\n    path: /custom/settings.yaml",
            ),
            null,
        )).toThrow('custom settings-file path');
    });

    it('resolves direct dsh launches to the live default and rejects unknown presets', async () => {
        const loaders = {
            loadPermissionConfig: () => DSH_PERMISSION_PROFILE,
            loadPermissionSettings: async () => null,
        };
        await expect(resolveDshLaunchPermissionMode(undefined, loaders))
            .resolves.toBe('workspace-write');
        await expect(resolveDshLaunchPermissionMode('read-only', loaders))
            .resolves.toBe('read-only');
        await expect(resolveDshLaunchPermissionMode('provider-native', loaders))
            .rejects.toThrow('does not advertise permission mode "provider-native"');
        await expect(resolveDshLaunchPermissionMode('read-only', {
            ...loaders,
            loadPermissionSettings: async () => 'permission:\n  defaultPreset: danger-full-access\n',
        })).rejects.toThrow('permission.defaultPreset settings override');
    });

    it('omits dsh and publishes an actionable error for missing, malformed, or failed probes', async () => {
        const availability = {
            claude: false,
            codex: false,
            gemini: false,
            grok: false,
            dsh: true,
            agy: false,
            detectedAt: 1,
        };
        const malformed = await detectAgentCapabilities(availability, {
            loadDshProbe: async () => ({ ...dshProbe(), configOptions: [] }),
        });
        const nonOfficialCurrent = await detectAgentCapabilities(availability, {
            loadDshProbe: async () => dshProbe({
                currentModel: JSON.stringify(['third-party', 'deepseek-v4-flash']),
            }),
        });
        const failed = await detectAgentCapabilities(availability, {
            loadDshProbe: async () => { throw new Error('provider refused session/new'); },
        });

        for (const result of [malformed, nonOfficialCurrent, failed]) {
            expect(result.capabilities.dsh).toBeUndefined();
            expect(result.dshCapabilityError).toContain('dsh --profile acp');
            expect(result.dshCapabilityError).toContain('DEEPSEEK_API_KEY');
        }
        expect(failed.dshCapabilityError).toContain('provider refused session/new');
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
            dsh: false,
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
            dsh: false,
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
