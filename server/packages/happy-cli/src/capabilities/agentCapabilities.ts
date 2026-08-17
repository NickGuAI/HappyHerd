import spawn from 'cross-spawn';
import { HAPPYHERD_CLAUDE_MODEL_SLUGS } from '@slopus/happy-wire';

import type { AgentCapabilityCatalog } from '@/api/types';
import { CodexAppServerClient } from '@/codex/codexAppServerClient';
import type { ModelListEntry } from '@/codex/codexAppServerTypes';
import type { CLIAvailability } from '@/utils/detectCLI';
import { logger } from '@/ui/logger';

type CapabilityOption = AgentCapabilityCatalog['models'][number];
type CapabilityMap = Record<string, AgentCapabilityCatalog>;

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
    ['read-only', 'read only'],
    ['safe-yolo', 'workspace write'],
    ['yolo', 'full access'],
] as const;
const AGY_MODELS = [
    'Gemini 3.1 Pro (High)',
    'Gemini 3.1 Pro (Low)',
    'Gemini 3.5 Flash (High)',
    'Gemini 3.5 Flash (Medium)',
    'Gemini 3.5 Flash (Low)',
    'Claude Opus 4.6 (Thinking)',
    'Claude Sonnet 4.6 (Thinking)',
    'GPT-OSS 120B (Medium)',
];

function option(code: string, value = code, description?: string | null): CapabilityOption {
    return { code, value, ...(description !== undefined ? { description } : {}) };
}

function uniqueOptions(values: string[]): CapabilityOption[] {
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
        : uniqueOptions(['acceptEdits', 'auto', 'bypassPermissions', 'dontAsk', 'plan']);

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
        // `manual` is a CLI-only value not accepted by the embedded Agent SDK.
        permissionModes: [
            option('default', 'default', null),
            ...permissions.filter((entry) => entry.code !== 'manual' && entry.code !== 'default'),
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

export function buildBaselineAgentCapabilities(availability: CLIAvailability): CapabilityMap {
    const detectedAt = Date.now();
    const result: CapabilityMap = {};

    if (availability.claude) {
        result.claude = baselineClaudeCatalog(detectedAt);
    }
    if (availability.codex) {
        result.codex = baselineCodexCatalog(detectedAt);
    }
    if (availability.openclaw) {
        result.openclaw = {
            detectedAt,
            sources: { models: 'provider-default', effortLevels: 'provider-default', permissionModes: 'happyherd-launch-profile' },
            models: [option('default', 'default model', null)],
            effortLevels: [],
            permissionModes: [option('default'), option('bypassPermissions', 'bypass permissions')],
        };
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
    opts?: { loadCodexModels?: () => Promise<ModelListEntry[]> },
): Promise<CapabilityMap> {
    const catalogs = buildBaselineAgentCapabilities(availability);
    if (!availability.codex || !catalogs.codex) {
        return catalogs;
    }

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

    return catalogs;
}

export function capabilityFingerprint(capabilities: CapabilityMap): string {
    return JSON.stringify(capabilities, (_key, value) => (
        _key === 'detectedAt' ? undefined : value
    ));
}
