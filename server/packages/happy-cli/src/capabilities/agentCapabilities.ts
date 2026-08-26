import spawn from 'cross-spawn';
import { HAPPYHERD_CLAUDE_MODEL_SLUGS } from '@slopus/happy-wire';

import type { AgentCapabilityCatalog } from '@/api/types';
import { CodexAppServerClient } from '@/codex/codexAppServerClient';
import type { ModelListEntry } from '@/codex/codexAppServerTypes';
import type { CLIAvailability } from '@/utils/detectCLI';
import { logger } from '@/ui/logger';
import { AcpBackend } from '@/agent/acp/AcpBackend';
import { DefaultTransport } from '@/agent/transport';
import { KNOWN_ACP_AGENTS, sanitizeGrokChildEnvironment } from '@/agent/acp/acpAgentConfig';
import { AGY_MODELS } from '@/agy/constants';
import type { InitializeResponse } from '@agentclientprotocol/sdk';

type CapabilityOption = AgentCapabilityCatalog['models'][number];
type CapabilityMap = Record<string, AgentCapabilityCatalog>;
type CapabilityDiscoveryResult = {
    capabilities: CapabilityMap;
    grokCapabilityError?: string;
};

const GROK_PERMISSION_MODE_DESCRIPTIONS: Record<string, string> = {
    default: 'Run read-only and pre-approved tools; ask before other actions.',
    acceptEdits: 'Approve file edits; ask before other actions.',
    auto: 'Run calls the safety check allows; block or escalate other calls.',
    dontAsk: 'Run only pre-approved and built-in read-only tools; deny other calls without prompting.',
    bypassPermissions: 'Approve tool calls generally; deny rules, hooks, and shell ask rules still apply.',
    plan: 'Compatibility permission value; Grok plan operating mode is separate.',
};

const CODEX_MODEL_DEFAULTS = [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.2-codex',
    'gpt-5.1-codex-max',
    'gpt-5.2',
    'gpt-5.1-codex-mini',
];
const CODEX_PERMISSION_MODES = [
    ['default', 'ask first'],
    ['auto', 'auto'],
    ['read-only', 'read only'],
    ['safe-yolo', 'workspace write'],
    ['yolo', 'full access'],
] as const;
function option(code: string, value = code, description?: string | null, isDefault?: boolean): CapabilityOption {
    return {
        code,
        value,
        ...(description !== undefined ? { description } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
    };
}

function uniqueOptions(values: readonly string[]): CapabilityOption[] {
    return [...new Set(values.filter(Boolean))].map((value) => option(value));
}

function readCommand(command: string, args: string[]): string | null {
    try {
        const result = spawn.sync(command, args, {
            encoding: 'utf8',
            timeout: 5_000,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (result.error || result.status !== 0) return null;
        return String(result.stdout ?? '').trim();
    } catch {
        return null;
    }
}

function readVersion(command: string): string | undefined {
    return readCommand(command, ['--version']) || undefined;
}

export function parseGrokPermissionModeHelp(help: string): CapabilityOption[] {
    const permissionStart = help.search(/^[ \t]*--permission-mode[ \t]+<mode>/im);
    if (permissionStart < 0) return [];

    const remainingHelp = help.slice(permissionStart);
    const firstLineEnd = remainingHelp.search(/\r?\n/);
    const followingLines = firstLineEnd >= 0 ? remainingHelp.slice(firstLineEnd + 1) : '';
    const nextFlagOffset = followingLines.search(/^[ \t]*--[a-z0-9-]+(?:[ \t]|$)/im);
    const permissionBlock = nextFlagOffset >= 0
        ? remainingHelp.slice(0, firstLineEnd + 1 + nextFlagOffset)
        : remainingHelp;
    const permissionMatch = permissionBlock.match(
        /\[possible values:[ \t]*([^\]\r\n]+)\]/i,
    );
    if (!permissionMatch) return [];

    return uniqueOptions(permissionMatch[1].split(',').map((entry) => entry.trim()))
        .map((entry) => option(
            entry.code,
            entry.code,
            GROK_PERMISSION_MODE_DESCRIPTIONS[entry.code] ?? null,
            entry.code === 'default',
        ));
}

export function parseClaudeHelp(help: string): {
    effortLevels: CapabilityOption[];
    permissionModes: CapabilityOption[];
} {
    const effortMatch = help.match(/--effort\s+<level>[\s\S]*?\(([^)]+)\)/);
    const effortLevels = effortMatch
        ? uniqueOptions(effortMatch[1].split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')))
        : [];

    const permissionMatch = help.match(/--permission-mode\s+<mode>[\s\S]*?\(choices:\s*([^)]+)\)/);
    const permissionModes = permissionMatch
        ? uniqueOptions(permissionMatch[1].split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')))
        : [];

    return {
        effortLevels,
        permissionModes,
    };
}

export function buildClaudeCapabilityCatalog(
    help: string,
    detectedAt: number,
    providerVersion?: string,
): AgentCapabilityCatalog {
    const parsed = parseClaudeHelp(help);
    const efforts = parsed.effortLevels.length > 0
        ? parsed.effortLevels
        : uniqueOptions(['low', 'medium', 'high', 'xhigh', 'max']);
    const permissions = parsed.permissionModes.length > 0
        ? parsed.permissionModes
        : uniqueOptions(['acceptEdits', 'auto', 'bypassPermissions', 'plan']);

    return {
        detectedAt,
        providerVersion,
        sources: {
            models: 'happyherd-release-catalog',
            effortLevels: parsed.effortLevels.length > 0 ? 'cli-help' : 'daemon-defaults',
            permissionModes: parsed.permissionModes.length > 0 ? 'cli-help' : 'daemon-defaults',
        },
        models: [
            option('default', 'provider default', null),
            ...uniqueOptions([...HAPPYHERD_CLAUDE_MODEL_SLUGS]),
        ],
        effortLevels: efforts,
        // `manual` is CLI-only and `dontAsk` is retired by the embedded SDK.
        permissionModes: [
            option('default', 'default', null),
            ...permissions.filter((entry) => (
                entry.code !== 'manual'
                && entry.code !== 'dontAsk'
                && entry.code !== 'default'
            )),
        ],
    };
}

function baselineClaudeCatalog(detectedAt: number): AgentCapabilityCatalog {
    return buildClaudeCapabilityCatalog(
        readCommand('claude', ['--help']) ?? '',
        detectedAt,
        readVersion('claude'),
    );
}

function baselineCodexCatalog(detectedAt: number): AgentCapabilityCatalog {
    const efforts = uniqueOptions(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    return {
        detectedAt,
        providerVersion: readVersion('codex'),
        sources: {
            models: 'daemon-defaults',
            effortLevels: 'daemon-defaults',
            permissionModes: 'happyherd-launch-profile',
        },
        models: [option('default', 'default model', null), ...uniqueOptions(CODEX_MODEL_DEFAULTS)],
        effortLevels: efforts,
        permissionModes: CODEX_PERMISSION_MODES.map(([code, label]) => option(code, label)),
    };
}

function mapCodexModels(models: ModelListEntry[]): AgentCapabilityCatalog['models'] {
    return models
        .filter((model) => !model.hidden)
        .map((model) => ({
            code: model.model,
            value: model.displayName || model.model,
            description: model.description || null,
            effortLevels: model.supportedReasoningEfforts.map((effort) => option(
                effort.reasoningEffort,
                effort.reasoningEffort,
                effort.description || null,
            )),
            isDefault: model.isDefault,
        }));
}

type GrokReasoningEffort = {
    id?: unknown;
    label?: unknown;
    description?: unknown;
    default?: unknown;
};

type GrokRuntimeModel = {
    modelId?: unknown;
    name?: unknown;
    description?: unknown;
    _meta?: {
        reasoningEfforts?: unknown;
    } | null;
};

type GrokRuntimeModelState = {
    currentModelId?: unknown;
    availableModels?: unknown;
};

function runtimeObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/** Build GrokBuild runtime choices from ACP and launch permissions from CLI help. */
export function buildGrokAcpCapabilityCatalog(
    initialize: InitializeResponse,
    grokHelp: string,
    detectedAt = Date.now(),
): AgentCapabilityCatalog {
    const meta = runtimeObject(initialize._meta);
    const modelState = runtimeObject(meta?.modelState) as GrokRuntimeModelState | null;
    const currentModelId = typeof modelState?.currentModelId === 'string'
        ? modelState.currentModelId
        : null;
    const runtimeModels = Array.isArray(modelState?.availableModels)
        ? modelState.availableModels as GrokRuntimeModel[]
        : [];

    const models = runtimeModels.flatMap((model) => {
        if (typeof model.modelId !== 'string' || model.modelId.length === 0) return [];
        const efforts = Array.isArray(model._meta?.reasoningEfforts)
            ? (model._meta.reasoningEfforts as GrokReasoningEffort[]).flatMap((effort) => {
                if (typeof effort.id !== 'string') return [];
                const label = typeof effort.label === 'string'
                    ? effort.label
                    : effort.id;
                return [option(
                    effort.id,
                    label,
                    typeof effort.description === 'string' ? effort.description : null,
                    effort.default === true,
                )];
            })
            : [];
        return [{
            code: model.modelId,
            value: typeof model.name === 'string' ? model.name : model.modelId,
            description: typeof model.description === 'string' ? model.description : null,
            effortLevels: efforts,
            isDefault: model.modelId === currentModelId,
        }];
    });

    if (models.length === 0 || !currentModelId || !models.some((model) => model.code === currentModelId)) {
        throw new Error('Grok ACP initialize response did not advertise a valid current model catalog');
    }

    const effortByCode = new Map<string, CapabilityOption>();
    for (const model of models) {
        for (const effort of model.effortLevels ?? []) {
            if (!effortByCode.has(effort.code)) effortByCode.set(effort.code, effort);
        }
    }

    const capabilities = initialize.agentCapabilities;
    const prompt = capabilities?.promptCapabilities;
    const providerVersion = typeof meta?.agentVersion === 'string'
        ? meta.agentVersion
        : undefined;
    const parsedPermissionModes = parseGrokPermissionModeHelp(grokHelp);

    return {
        detectedAt,
        providerVersion,
        sources: {
            models: 'acp:initialize:_meta.modelState',
            effortLevels: 'acp:initialize:_meta.modelState',
            permissionModes: parsedPermissionModes.length > 0
                ? 'grok-cli-help:--permission-mode'
                : 'provider-default',
        },
        models,
        effortLevels: [...effortByCode.values()],
        // These are process launch policies from `grok --help`, not ACP
        // requestPermission choices or the session's plan/build operating mode.
        permissionModes: parsedPermissionModes.length > 0
            ? parsedPermissionModes
            : [option(
                'default',
                'default',
                GROK_PERMISSION_MODE_DESCRIPTIONS.default,
                true,
            )],
        acp: {
            loadSession: capabilities?.loadSession === true,
            prompt: {
                image: prompt?.image === true,
            },
        },
    };
}

async function readGrokAcpInitialize(): Promise<InitializeResponse> {
    const config = KNOWN_ACP_AGENTS.grok;
    let initialize: InitializeResponse | null = null;
    const backend = new AcpBackend({
        agentName: 'grok',
        cwd: process.cwd(),
        command: config.command,
        args: config.args,
        transportHandler: new DefaultTransport('grok'),
        initializeOnly: true,
        processEnv: sanitizeGrokChildEnvironment(process.env),
    });
    backend.onMessage((message) => {
        if (message.type === 'event' && message.name === 'initialize_response') {
            initialize = message.payload as InitializeResponse;
        }
    });
    try {
        await backend.startSession();
        if (!initialize) throw new Error('Grok ACP initialize response was not received');
        return initialize;
    } finally {
        await backend.dispose();
    }
}

export function buildBaselineAgentCapabilities(availability: CLIAvailability): CapabilityMap {
    const detectedAt = Date.now();
    const result: CapabilityMap = {};

    if (availability.claude) {
        result.claude = baselineClaudeCatalog(detectedAt);
    }
    if (availability.codex) {
        result.codex = baselineCodexCatalog(detectedAt);
    }
    if (availability.agy) {
        result.agy = {
            detectedAt,
            providerVersion: readVersion('agy'),
            sources: { models: 'daemon-defaults', effortLevels: 'model-name', permissionModes: 'happyherd-launch-profile' },
            models: uniqueOptions(AGY_MODELS),
            effortLevels: [],
            permissionModes: [option('default'), option('bypassPermissions', 'bypass permissions')],
        };
    }

    return result;
}

async function readCodexModels(): Promise<ModelListEntry[]> {
    const client = new CodexAppServerClient();
    await client.connect();
    try {
        return await client.listModels();
    } finally {
        await client.disconnect();
    }
}

export async function detectAgentCapabilities(
    availability: CLIAvailability,
    opts?: {
        loadCodexModels?: () => Promise<ModelListEntry[]>;
        loadGrokInitialize?: () => Promise<InitializeResponse>;
        loadGrokHelp?: () => string | null;
    },
): Promise<CapabilityDiscoveryResult> {
    const catalogs = buildBaselineAgentCapabilities(availability);
    let grokCapabilityError: string | undefined;

    if (availability.codex && catalogs.codex) {
        try {
            const models = await (opts?.loadCodexModels ?? readCodexModels)();
            const mappedModels = mapCodexModels(models);
            if (mappedModels.length > 0) {
                const effortLevels = uniqueOptions(mappedModels.flatMap((model) => (
                    model.effortLevels?.map((effort) => effort.code) ?? []
                )));
                catalogs.codex = {
                    ...catalogs.codex,
                    detectedAt: Date.now(),
                    sources: {
                        ...catalogs.codex.sources,
                        models: 'codex-app-server:model/list',
                        effortLevels: 'codex-app-server:model/list',
                    },
                    models: [option('default', 'default model', null), ...mappedModels],
                    effortLevels: effortLevels.length > 0 ? effortLevels : catalogs.codex.effortLevels,
                };
            }
        } catch (error) {
            logger.debug('[CAPABILITIES] Codex model/list failed; using daemon catalog', error);
        }
    }

    if (availability.grok) {
        try {
            const initialize = await (opts?.loadGrokInitialize ?? readGrokAcpInitialize)();
            const grokHelp = (opts?.loadGrokHelp ?? (() => readCommand('grok', ['--help'])))() ?? '';
            catalogs.grok = buildGrokAcpCapabilityCatalog(initialize, grokHelp);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            grokCapabilityError = `GrokBuild is installed but ACP capability discovery failed: ${detail}. Run \`grok login\`, then verify \`grok --no-auto-update agent stdio\` starts.`;
        }
    }

    return {
        capabilities: catalogs,
        ...(grokCapabilityError ? { grokCapabilityError } : {}),
    };
}

export function capabilityFingerprint(capabilities: CapabilityMap): string {
    return JSON.stringify(capabilities, (_key, value) => (
        _key === 'detectedAt' ? undefined : value
    ));
}
