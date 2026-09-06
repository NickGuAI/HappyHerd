import spawn from 'cross-spawn';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options as ClaudeSdkOptions } from '@anthropic-ai/claude-agent-sdk';
import { HAPPYHERD_CLAUDE_MODEL_SLUGS } from '@slopus/happy-wire';
import { parseDocument } from 'yaml';

import type { AgentCapabilityCatalog } from '@/api/types';
import { CodexAppServerClient } from '@/codex/codexAppServerClient';
import type { ModelListEntry } from '@/codex/codexAppServerTypes';
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_PERMISSION_MODE } from '@/codex/defaults';
import { DEFAULT_CODEX_REASONING_EFFORT } from '@/codex/reasoningEffort';
import type { CLIAvailability } from '@/utils/detectCLI';
import { logger } from '@/ui/logger';
import { AcpBackend } from '@/agent/acp/AcpBackend';
import { DefaultTransport } from '@/agent/transport';
import { KNOWN_ACP_AGENTS, sanitizeGrokChildEnvironment } from '@/agent/acp/acpAgentConfig';
import { AGY_MODELS, AGY_EFFORTS, DEFAULT_AGY_MODEL, DEFAULT_AGY_EFFORT } from '@/agy/constants';
import type { InitializeResponse, SessionConfigOption } from '@agentclientprotocol/sdk';

type CapabilityOption = AgentCapabilityCatalog['models'][number];
type CapabilityMap = Record<string, AgentCapabilityCatalog>;
type CapabilityDiscoveryResult = {
    capabilities: CapabilityMap;
    grokCapabilityError?: string;
    dshCapabilityError?: string;
};

export type DshAcpProbeResult = {
    initialize: InitializeResponse;
    configOptions: SessionConfigOption[];
    permissionProfile: DshPermissionProfile;
    providerVersion?: string;
};

export type DshPermissionProfile = {
    defaultMode: string;
    presets: Array<{
        code: string;
        sandbox: string;
        approval: string;
        name?: string;
        description?: string;
    }>;
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

const CLAUDE_SDK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const satisfies readonly NonNullable<ClaudeSdkOptions['effort']>[];

export function buildClaudeCapabilityCatalog(
    help: string,
    detectedAt: number,
    providerVersion?: string,
): AgentCapabilityCatalog {
    const parsed = parseClaudeHelp(help);
    const efforts = (parsed.effortLevels.length > 0
        ? parsed.effortLevels
        : uniqueOptions([...CLAUDE_SDK_EFFORTS]))
        .filter((entry) => CLAUDE_SDK_EFFORTS.some((effort) => effort === entry.code))
        .map((entry) => ({ ...entry, isDefault: entry.code === 'max' }));
    const permissions = parsed.permissionModes.length > 0
        ? parsed.permissionModes
        : uniqueOptions(['acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan']);

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
        // `manual` is a Claude Code CLI-only value. HappyHerd executes Claude
        // through the Agent SDK, whose PermissionMode union does not include it.
        permissionModes: [
            option('default', 'default', null),
            ...permissions.filter((entry) => (
                entry.code !== 'manual'
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
    const efforts = uniqueOptions(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
        .map((effort) => ({
            ...effort,
            isDefault: effort.code === DEFAULT_CODEX_REASONING_EFFORT,
        }));
    return {
        detectedAt,
        providerVersion: readVersion('codex'),
        sources: {
            models: 'daemon-defaults',
            effortLevels: 'daemon-defaults',
            permissionModes: 'happyherd-launch-profile',
        },
        models: [
            option('default', 'default model', null),
            ...uniqueOptions(CODEX_MODEL_DEFAULTS).map((model) => ({
                ...model,
                isDefault: model.code === DEFAULT_CODEX_MODEL,
            })),
        ],
        effortLevels: efforts,
        permissionModes: CODEX_PERMISSION_MODES.map(([code, label]) => option(
            code,
            label,
            undefined,
            code === DEFAULT_CODEX_PERMISSION_MODE,
        )),
    };
}

function mapCodexModels(models: ModelListEntry[]): AgentCapabilityCatalog['models'] {
    return models
        .filter((model) => !model.hidden)
        .map((model) => ({
            code: model.model,
            value: model.displayName || model.model,
            description: model.description || null,
            effortLevels: model.supportedReasoningEfforts.map((effort, index, efforts) => option(
                effort.reasoningEffort,
                effort.reasoningEffort,
                effort.description || null,
                index === efforts.length - 1,
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
            resumeSession: capabilities?.sessionCapabilities?.resume != null,
            prompt: {
                image: prompt?.image === true,
            },
        },
    };
}

type DshSelectValue = {
    code: string;
    label: string;
    description?: string | null;
};

function dshPluginBlock(config: string, packageName: string): string[] {
    const lines = config.replace(/\r\n/g, '\n').split('\n');
    const matchingNameLines = lines.flatMap((line, index) => (
        line.match(/^  name:\s+['"]?([^'"\s]+)['"]?\s*$/)?.[1] === packageName ? [index] : []
    ));
    if (matchingNameLines.length !== 1) {
        throw new Error(`dsh config must contain exactly one ${packageName} plugin`);
    }

    const nameIndex = matchingNameLines[0];
    let start = nameIndex;
    while (start > 0 && !/^- id:\s+/.test(lines[start])) start--;
    if (!/^- id:\s+/.test(lines[start])) {
        throw new Error(`dsh ${packageName} plugin is not a top-level profile entry`);
    }
    let end = nameIndex + 1;
    while (end < lines.length && !/^- id:\s+/.test(lines[end])) end++;
    const block = lines.slice(start, end);
    const disabled = block.find((line) => /^  disabled:\s+/.test(line));
    if (disabled && !/^  disabled:\s+false\s*$/.test(disabled)) {
        throw new Error(`dsh ${packageName} plugin is disabled or conditionally disabled`);
    }
    return block;
}

function dshLiteralString(raw: string, field: string): string {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('!!')) {
        throw new Error(`dsh permission preset ${field} must be a literal string`);
    }
    const quoted = trimmed.match(/^(['"])(.*)\1$/);
    return quoted ? quoted[2] : trimmed;
}

/**
 * Read only dsh's permission preset rows and literal environment fallback.
 * `--dump-config` can contain executable `!!js` tags; this parser recognizes
 * one fixed expression as text and never asks a YAML runtime to evaluate it.
 */
export function parseDshPermissionProfile(config: string): DshPermissionProfile {
    const presetBlock = dshPluginBlock(config, '@deepseek-ai/dsh-permission-presets');
    const presetsIndex = presetBlock.findIndex((line) => /^    presets:\s*$/.test(line));
    if (presetsIndex < 0) {
        throw new Error('dsh permission preset plugin did not declare config.presets');
    }

    const presets: DshPermissionProfile['presets'] = [];
    let current: DshPermissionProfile['presets'][number] | null = null;
    for (const line of presetBlock.slice(presetsIndex + 1)) {
        if (line.trim().length === 0) continue;
        const preset = line.match(/^      ([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/);
        if (preset) {
            current = { code: preset[1], sandbox: '', approval: '' };
            presets.push(current);
            continue;
        }
        const field = line.match(/^        (sandbox|approval|name|description):\s+(.+?)\s*$/);
        if (!field || !current) {
            throw new Error('dsh permission preset config has an unsupported or malformed row');
        }
        const key = field[1] as 'sandbox' | 'approval' | 'name' | 'description';
        if (current[key]) {
            throw new Error(`dsh permission preset "${current.code}" repeats ${field[1]}`);
        }
        current[key] = dshLiteralString(field[2], key);
    }
    if (presets.length === 0) {
        throw new Error('dsh permission preset plugin did not advertise any presets');
    }
    const codes = new Set<string>();
    for (const preset of presets) {
        if (codes.has(preset.code)) {
            throw new Error(`dsh permission preset "${preset.code}" is duplicated`);
        }
        codes.add(preset.code);
        if (!preset.sandbox || !preset.approval) {
            throw new Error(`dsh permission preset "${preset.code}" must declare sandbox and approval`);
        }
        if (preset.code !== preset.sandbox) {
            throw new Error(`dsh permission preset "${preset.code}" cannot be selected through DSH_PERMISSION_MODE`);
        }
    }

    const sandboxPolicy = dshPluginBlock(config, '@deepseek-ai/dsh-sandbox-policy');
    const defaultMatches = sandboxPolicy.flatMap((line) => {
        const match = line.match(
            /^    mode:\s+!!js\s+process\.env\.DSH_PERMISSION_MODE\s+\?\?\s+(['"])([A-Za-z0-9][A-Za-z0-9._-]*)\1\s*$/,
        );
        return match ? [match[2]] : [];
    });
    if (defaultMatches.length !== 1) {
        throw new Error('dsh sandbox policy did not declare one literal DSH_PERMISSION_MODE default');
    }
    const defaultMode = defaultMatches[0];
    if (!codes.has(defaultMode)) {
        throw new Error(`dsh permission default "${defaultMode}" is not an advertised preset`);
    }

    const approvalPolicy = dshPluginBlock(config, '@deepseek-ai/dsh-user-approval');
    const policyIndex = approvalPolicy.findIndex((line) => /^    policy:\s+/.test(line));
    if (policyIndex < 0) {
        throw new Error('dsh approval policy did not declare a launch-time policy');
    }
    const firstPolicyLine = approvalPolicy[policyIndex].replace(/^    policy:\s+/, '').trim();
    const policySource = [firstPolicyLine, ...approvalPolicy.slice(policyIndex + 1).map((line) => line.trim())]
        .filter(Boolean)
        .join(' ')
        .replace(/^!!js\s+(?:>-\s+)?/, '')
        .replace(/^(['"])(.*)\1$/, '$2');
    const policyMatch = policySource.match(
        /^\(process\.env\.DSH_PERMISSION_MODE\s+\?\?\s+(['"])([A-Za-z0-9][A-Za-z0-9._-]*)\1\)\s+===\s+(['"])([A-Za-z0-9][A-Za-z0-9._-]*)\3\s+\?\s+(['"])([A-Za-z0-9][A-Za-z0-9._-]*)\5\s+:\s+(['"])([A-Za-z0-9][A-Za-z0-9._-]*)\7$/,
    );
    if (!policyMatch || policyMatch[2] !== defaultMode) {
        throw new Error('dsh approval policy did not declare the same literal DSH_PERMISSION_MODE default');
    }
    const exceptionalMode = policyMatch[4];
    const exceptionalApproval = policyMatch[6];
    const fallbackApproval = policyMatch[8];
    for (const preset of presets) {
        const effectiveApproval = preset.code === exceptionalMode ? exceptionalApproval : fallbackApproval;
        if (preset.approval !== effectiveApproval) {
            throw new Error(`dsh permission preset "${preset.code}" disagrees with the launch approval policy`);
        }
    }

    return { defaultMode, presets };
}

/**
 * dsh user settings can replace the new-session preset after environment
 * composition. Explicit HappyHerd launch selection is truthful only while
 * that supported override is absent; other settings namespaces are ignored.
 */
export function assertDshPermissionSettingsCompatible(
    dumpedConfig: string,
    settingsDocument: string | null,
): void {
    const settingsPlugin = dshPluginBlock(dumpedConfig, '@deepseek-ai/dsh-settings-file');
    if (settingsPlugin.some((line) => /^    (?:path|dshHome):\s+/.test(line))) {
        throw new Error('dsh permission discovery cannot resolve a custom settings-file path');
    }
    if (settingsDocument === null || settingsDocument.trim().length === 0) return;

    const document = parseDocument(settingsDocument, {
        prettyErrors: false,
        strict: true,
        uniqueKeys: true,
    });
    if (document.errors.length > 0 || document.warnings.length > 0) {
        throw new Error('dsh settings YAML is malformed or unsupported');
    }

    let parsed: unknown;
    try {
        parsed = document.toJS({ maxAliasCount: 0 });
    } catch {
        throw new Error('dsh settings YAML is malformed or unsupported');
    }
    if (parsed === null) return;
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('dsh settings YAML root must be a mapping');
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'permission')) {
        throw new Error('dsh permission.defaultPreset settings override makes process-launch selection unavailable');
    }
}

function flattenDshSelectValues(rawOptions: unknown): DshSelectValue[] {
    if (!Array.isArray(rawOptions)) return [];
    const values: DshSelectValue[] = [];
    const appendValue = (raw: unknown): void => {
        const entry = runtimeObject(raw);
        if (!entry || typeof entry.value !== 'string' || typeof entry.name !== 'string') return;
        values.push({
            code: entry.value,
            label: entry.name,
            ...(typeof entry.description === 'string' || entry.description === null
                ? { description: entry.description }
                : {}),
        });
    };
    for (const rawOption of rawOptions) {
        const group = runtimeObject(rawOption);
        if (group && Array.isArray(group.options)) {
            for (const groupedOption of group.options) appendValue(groupedOption);
        } else {
            appendValue(rawOption);
        }
    }
    return values;
}

function requireDshSelectCategory(
    configOptions: SessionConfigOption[],
    category: 'model' | 'thought_level',
): { currentValue: string; values: DshSelectValue[] } {
    const matches = configOptions.filter((candidate) => (
        candidate.type === 'select' && candidate.category === category
    ));
    if (matches.length !== 1) {
        throw new Error(`dsh session/new did not advertise exactly one ${category} select config option`);
    }
    const selected = matches[0];
    if (typeof selected.currentValue !== 'string' || selected.currentValue.length === 0) {
        throw new Error(`dsh ${category} config option did not advertise a current value`);
    }
    const values = flattenDshSelectValues(selected.options);
    if (values.length === 0) {
        throw new Error(`dsh ${category} config option did not advertise selectable values`);
    }
    return { currentValue: selected.currentValue, values };
}

function decodeOfficialDshModel(code: string): string | null {
    try {
        const tuple: unknown = JSON.parse(code);
        if (
            !Array.isArray(tuple)
            || tuple.length !== 2
            || tuple[0] !== 'deepseek-official'
            || typeof tuple[1] !== 'string'
            || tuple[1].trim().length === 0
        ) {
            return null;
        }
        return tuple[1];
    } catch {
        return null;
    }
}

/** Build dsh launch choices only from explicit session/new config categories. */
export function buildDshAcpCapabilityCatalog(
    probe: DshAcpProbeResult,
    detectedAt = Date.now(),
): AgentCapabilityCatalog {
    const modelSelect = requireDshSelectCategory(probe.configOptions, 'model');
    const effortSelect = requireDshSelectCategory(probe.configOptions, 'thought_level');

    const modelBySlug = new Map<string, DshSelectValue>();
    for (const advertised of modelSelect.values) {
        const slug = decodeOfficialDshModel(advertised.code);
        if (slug && !modelBySlug.has(slug)) modelBySlug.set(slug, advertised);
    }
    const currentModel = decodeOfficialDshModel(modelSelect.currentValue);
    if (!currentModel || !modelBySlug.has(currentModel)) {
        throw new Error('dsh model config did not advertise a valid current deepseek-official tuple');
    }

    const effortByCode = new Map<string, DshSelectValue>();
    for (const advertised of effortSelect.values) {
        if (advertised.code.trim().length > 0 && !effortByCode.has(advertised.code)) {
            effortByCode.set(advertised.code, advertised);
        }
    }
    if (!effortByCode.has(effortSelect.currentValue)) {
        throw new Error('dsh thought_level config did not advertise its current value');
    }
    const effortLevels = [...effortByCode.values()].map((effort) => option(
        effort.code,
        effort.label,
        effort.description,
        effort.code === effortSelect.currentValue,
    ));

    const permissionModes = probe.permissionProfile.presets.map((preset) => option(
        preset.code,
        preset.name ?? preset.code,
        preset.description ?? `sandbox=${preset.sandbox}; approval=${preset.approval}`,
        preset.code === probe.permissionProfile.defaultMode,
    ));

    const prompt = probe.initialize.agentCapabilities?.promptCapabilities;
    return {
        detectedAt,
        providerVersion: probe.providerVersion,
        sources: {
            models: 'dsh-acp:session/new:configOptions',
            effortLevels: 'dsh-acp:session/new:configOptions',
            permissionModes: 'dsh:--profile-acp:dump-config:permission-presets',
        },
        models: [...modelBySlug.entries()].map(([slug, advertised]) => ({
            code: slug,
            value: advertised.label,
            ...(advertised.description !== undefined ? { description: advertised.description } : {}),
            effortLevels,
            isDefault: slug === currentModel,
        })),
        effortLevels,
        permissionModes,
        acp: {
            loadSession: probe.initialize.agentCapabilities?.loadSession === true,
            resumeSession: probe.initialize.agentCapabilities?.sessionCapabilities?.resume != null,
            prompt: { image: prompt?.image === true },
        },
    };
}

const DSH_CAPABILITY_PROBE_TIMEOUT_MS = 20_000;

function readInstalledDshPermissionConfig(): string | null {
    return readCommand('dsh', ['--profile', 'acp', '--dump-config']);
}

async function readInstalledDshPermissionSettings(): Promise<string | null> {
    try {
        return await readFile(join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'settings.yaml'), 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

async function loadDshPermissionProfile(
    loadPermissionConfig: () => string | null = readInstalledDshPermissionConfig,
    loadPermissionSettings: () => Promise<string | null> = readInstalledDshPermissionSettings,
): Promise<DshPermissionProfile> {
    const dumpedConfig = loadPermissionConfig();
    if (!dumpedConfig) {
        throw new Error('dsh --profile acp --dump-config did not return a config');
    }
    assertDshPermissionSettingsCompatible(dumpedConfig, await loadPermissionSettings());
    return parseDshPermissionProfile(dumpedConfig);
}

/** Resolve direct and daemon wrapper launches against the same live dsh preset contract. */
export async function resolveDshLaunchPermissionMode(
    requested: string | undefined,
    opts?: {
        loadPermissionConfig?: () => string | null;
        loadPermissionSettings?: () => Promise<string | null>;
    },
): Promise<string> {
    const profile = await loadDshPermissionProfile(
        opts?.loadPermissionConfig,
        opts?.loadPermissionSettings,
    );
    const resolved = requested ?? profile.defaultMode;
    if (!profile.presets.some((preset) => preset.code === resolved)) {
        throw new Error(`dsh does not advertise permission mode "${resolved}" in its active ACP profile`);
    }
    return resolved;
}

async function readDshAcpSessionConfig(
    loadPermissionConfig: () => string | null = readInstalledDshPermissionConfig,
    loadPermissionSettings: () => Promise<string | null> = readInstalledDshPermissionSettings,
): Promise<DshAcpProbeResult> {
    const dshHome = await mkdtemp(join(tmpdir(), 'happyherd-dsh-capabilities-'));
    let backend: AcpBackend | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
        const config = KNOWN_ACP_AGENTS.dsh;
        let initialize: InitializeResponse | null = null;
        let configOptions: SessionConfigOption[] | null = null;
        backend = new AcpBackend({
            agentName: 'dsh',
            cwd: dshHome,
            command: config.command,
            args: config.args,
            transportHandler: new DefaultTransport('dsh'),
            mcpServers: {},
            processEnv: { ...process.env, DSH_HOME: dshHome },
        });
        backend.onMessage((message) => {
            if (message.type === 'event' && message.name === 'initialize_response') {
                initialize = message.payload as InitializeResponse;
            }
            if (message.type === 'event' && message.name === 'config_options_update') {
                const payload = runtimeObject(message.payload);
                if (Array.isArray(payload?.configOptions)) {
                    configOptions = payload.configOptions as SessionConfigOption[];
                }
            }
        });

        await Promise.race([
            backend.startSession(),
            new Promise<never>((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`dsh ACP capability probe timed out after ${DSH_CAPABILITY_PROBE_TIMEOUT_MS}ms`));
                }, DSH_CAPABILITY_PROBE_TIMEOUT_MS);
            }),
        ]);
        if (!initialize) throw new Error('dsh ACP initialize response was not received');
        if (!configOptions) throw new Error('dsh ACP session/new configOptions were not received');
        return {
            initialize,
            configOptions,
            permissionProfile: await loadDshPermissionProfile(
                loadPermissionConfig,
                loadPermissionSettings,
            ),
            providerVersion: readVersion('dsh'),
        };
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        try {
            await backend?.dispose();
        } finally {
            await rm(dshHome, { recursive: true, force: true });
        }
    }
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
            sources: { models: 'happyherd-release-catalog', effortLevels: 'model-name', permissionModes: 'happyherd-launch-profile' },
            models: AGY_MODELS.map((model) => ({
                ...option(model, model, undefined, model === DEFAULT_AGY_MODEL),
                effortLevels: model === DEFAULT_AGY_MODEL
                    ? AGY_EFFORTS.map((effort) => option(effort, effort, undefined, effort === DEFAULT_AGY_EFFORT))
                    : [],
            })),
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
        loadDshProbe?: () => Promise<DshAcpProbeResult>;
        loadDshPermissionProfile?: () => string | null;
        loadDshPermissionSettings?: () => Promise<string | null>;
    },
): Promise<CapabilityDiscoveryResult> {
    const catalogs = buildBaselineAgentCapabilities(availability);
    let grokCapabilityError: string | undefined;
    let dshCapabilityError: string | undefined;

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

    if (availability.dsh) {
        try {
            const probe = opts?.loadDshProbe
                ? await opts.loadDshProbe()
                : await readDshAcpSessionConfig(
                    opts?.loadDshPermissionProfile,
                    opts?.loadDshPermissionSettings,
                );
            catalogs.dsh = buildDshAcpCapabilityCatalog(probe);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            dshCapabilityError = `dsh is installed but ACP capability discovery failed: ${detail}. Verify \`dsh --profile acp\` starts with DEEPSEEK_API_KEY available to the daemon and has no permission.defaultPreset settings override.`;
        }
    }

    return {
        capabilities: catalogs,
        ...(grokCapabilityError ? { grokCapabilityError } : {}),
        ...(dshCapabilityError ? { dshCapabilityError } : {}),
    };
}

export function capabilityFingerprint(capabilities: CapabilityMap): string {
    return JSON.stringify(capabilities, (_key, value) => (
        _key === 'detectedAt' ? undefined : value
    ));
}
