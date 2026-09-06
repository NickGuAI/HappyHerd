import type { AgentCapabilityCatalog, MachineMetadata, Metadata } from '@/sync/storageTypes';
import { HAPPYHERD_AGY_MODEL_NAMES, HAPPYHERD_AGY_EFFORTS, HAPPYHERD_DEFAULT_AGY_MODEL, HAPPYHERD_CLAUDE_MODEL_SLUGS, HAPPYHERD_CLAUDE_MODEL_CONTEXT_WINDOWS } from '@slopus/happy-wire';
import { hackModes } from '@/sync/modeHacks';
import { sortPermissionModes } from '@/utils/permissionModeLabels';
import { getCodeAgentDefaults } from '@/sync/agentDefaults';
import { compareVersionsWithPrerelease, isWellFormedVersion } from '@/utils/versionUtils';
import {
    getRigCurrentModel,
    getRigModels,
    getRigReasoningLevels,
    getRigSelectedModelKey,
    isRigMetadataV1,
} from '@/sync/rig';

export type ModeOption = {
    key: string;
    name: string;
    description?: string | null;
    semanticKind?: string | null;
    disabled?: boolean;
    unavailable?: boolean;
    isDefault?: boolean;
    /** First Happy CLI version that can parse this hardcoded mode. */
    sinceCliVersion?: string;
};

export type PermissionMode = ModeOption;
export type ModelMode = ModeOption & {
    modelId?: string;
    providerId?: string;
    providerName?: string;
    providerKind?: string;
    contextWindow?: number;
    serviceTiers?: string[];
    thinkingLevels?: string[];
    defaultThinkingLevel?: string | null;
    isDefault?: boolean;
    effortLevels?: EffortLevel[];
};

export type ModelModeProviderGroup = {
    key: string;
    title: string | null;
    models: ModelMode[];
};

/**
 * Group models without sorting them. Provider groups keep the order in which
 * the backend first publishes each provider, and rows keep their wire order.
 */
export function groupModelModesByProvider(models: readonly ModelMode[]): ModelModeProviderGroup[] {
    const groups = new Map<string, ModelModeProviderGroup>();
    const unavailable: ModelMode[] = [];
    for (const model of models) {
        if (model.unavailable || model.disabled) {
            unavailable.push(model);
            continue;
        }
        const providerId = model.providerId?.trim() || null;
        const key = providerId ?? '__models__';
        let group = groups.get(key);
        if (!group) {
            group = {
                key,
                title: model.providerName?.trim() || providerId,
                models: [],
            };
            groups.set(key, group);
        }
        group.models.push(model);
    }
    return [
        ...groups.values(),
        ...(unavailable.length > 0 ? [{ key: '__unavailable__', title: null, models: unavailable }] : []),
    ];
}

export type EffortLevel = ModeOption;
export type PermissionModeKey = string;
export type ModelModeKey = string;

export type AgentFlavor = 'claude' | 'codex' | 'gemini' | string | null | undefined;

type Translate = (key: any) => string;

type MetadataOption = {
    code: string;
    value: string;
    description?: string | null;
};

const getGeminiModelFallbacks = (translate: Translate): ModelMode[] => [
    { key: 'gemini-3.1-pro-preview', name: 'gemini 3.1 pro', description: translate('uiCopy.latestMostCapable') },
    { key: 'gemini-3-flash-preview', name: 'gemini 3 flash', description: translate('uiCopy.latestFast') },
    { key: 'gemini-3.1-flash-lite-preview', name: 'gemini 3.1 flash lite', description: translate('uiCopy.latestFastest') },
    { key: 'gemini-2.5-pro', name: 'gemini 2.5 pro', description: translate('uiCopy.mostCapable') },
    { key: 'gemini-2.5-flash', name: 'gemini 2.5 flash', description: translate('uiCopy.fastEfficient') },
    { key: 'gemini-2.5-flash-lite', name: 'gemini 2.5 flash lite', description: translate('uiCopy.fastest') },
];

export function mapMetadataOptions(options?: MetadataOption[] | null): ModeOption[] {
    if (!options || options.length === 0) {
        return [];
    }

    return options.map((option) => ({
        key: option.code,
        name: option.value,
        description: option.description ?? null,
    }));
}

function getMachineCatalog(
    metadata: MachineMetadata | null | undefined,
    flavor: AgentFlavor,
): AgentCapabilityCatalog | null {
    if (!flavor) return null;
    return metadata?.agentCapabilities?.[flavor] ?? null;
}

export function hasMachineCapabilityCatalog(
    metadata: MachineMetadata | null | undefined,
    flavor: AgentFlavor,
): boolean {
    return getMachineCatalog(metadata, flavor) !== null;
}

function includeUnavailableSelection<T extends ModeOption>(
    options: T[],
    selectedKey: string | null | undefined,
    translate: Translate,
): T[] {
    if (!selectedKey || options.some((option) => option.key === selectedKey)) {
        return options;
    }
    return [
        {
            key: selectedKey,
            name: selectedKey,
            description: translate('modelMode.unavailableSelectedDaemon'),
            disabled: true,
            unavailable: true,
        } as unknown as T,
        ...options,
    ];
}

function releaseModelDetails(flavor: AgentFlavor, modelKey: string): Partial<ModelMode> {
    if (flavor === 'claude') {
        return {
            providerId: 'anthropic',
            providerName: 'Anthropic',
            ...(HAPPYHERD_CLAUDE_MODEL_CONTEXT_WINDOWS[modelKey]
                ? { contextWindow: HAPPYHERD_CLAUDE_MODEL_CONTEXT_WINDOWS[modelKey] }
                : {}),
        };
    }
    if (flavor === 'codex') return { providerId: 'openai', providerName: 'OpenAI' };
    if (flavor === 'agy') {
        if (modelKey === HAPPYHERD_DEFAULT_AGY_MODEL) return { providerId: 'google', providerName: 'Google' };
        if (modelKey === 'Claude Sonnet 4.6 (Thinking)' || modelKey === 'Claude Opus 4.6 (Thinking)') {
            return { providerId: 'anthropic', providerName: 'Anthropic' };
        }
        if (modelKey === 'GPT-OSS 120B (Medium)') return { providerId: 'openai', providerName: 'OpenAI' };
    }
    return {};
}

export function getMachineAdvertisedModels(
    metadata: MachineMetadata | null | undefined,
    flavor: AgentFlavor,
    translate: Translate,
    selectedKey?: string | null,
): ModelMode[] {
    const catalog = getMachineCatalog(metadata, flavor);
    if (!catalog) return [];
    return includeUnavailableSelection(catalog.models.map((model) => {
        const effortLevels = model.effortLevels?.map((effort) => ({
            key: effort.code,
            name: effort.value,
            description: effort.description ?? null,
            isDefault: effort.isDefault,
        }));
        return {
            ...releaseModelDetails(flavor, model.code),
            key: model.code,
            name: model.value,
            description: model.description ?? null,
            isDefault: model.isDefault,
            effortLevels,
            thinkingLevels: effortLevels?.map((effort) => effort.key),
            defaultThinkingLevel: effortLevels?.find((effort) => effort.isDefault)?.key ?? null,
        };
    }), selectedKey, translate);
}

export function getMachineAdvertisedPermissionModes(
    metadata: MachineMetadata | null | undefined,
    flavor: AgentFlavor,
    translate: Translate,
    selectedKey?: string | null,
): PermissionMode[] {
    const catalog = getMachineCatalog(metadata, flavor);
    if (!catalog) return [];
    return includeUnavailableSelection(catalog.permissionModes.map((mode) => ({
        key: mode.code,
        name: mode.value,
        description: mode.description ?? null,
        isDefault: mode.isDefault,
    })), selectedKey, translate);
}

export function getMachineAdvertisedEffortLevels(
    metadata: MachineMetadata | null | undefined,
    flavor: AgentFlavor,
    modelKey: string,
): EffortLevel[] {
    const catalog = getMachineCatalog(metadata, flavor);
    if (!catalog) return [];
    const selectedModel = modelKey === 'default'
        ? catalog.models.find((model) => model.isDefault)
            ?? catalog.models.find((model) => model.code === 'default')
        : catalog.models.find((model) => model.code === modelKey);
    if (!selectedModel) return [];
    const modelEfforts = selectedModel?.effortLevels;
    // `undefined` means the provider supplied only a catalog-wide fallback.
    // An explicit empty list is authoritative: this model has no effort knob
    // and must not inherit another model's values from the catalog union.
    const efforts = modelEfforts !== undefined ? modelEfforts : catalog.effortLevels;
    return efforts.map((effort) => ({
        key: effort.code,
        name: effort.value,
        description: effort.description ?? null,
        isDefault: effort.isDefault,
    }));
}

export function getAdvertisedDefaultOptionKey(
    options: ReadonlyArray<{ key: string; isDefault?: boolean }>,
): string | null {
    return options.find((option) => option.isDefault)?.key ?? null;
}
// Mode names are deliberately untranslated single words, because the composer
// chip that shows the current mode has room for one word — see
// permissionModeLabels.ts. They are Happy's own vocabulary, not a quote of each
// CLI's: Claude's UI calls our `default` "Manual". Every list below is ordered
// by that file's ranking so the modes line up across harnesses, with one
// documented exception at agy.

// Auto leads because it is the everyday mode: the harness reviews its own calls
// and stops only when it actually wants a human. Claude ships it in the Agent
// SDK's PermissionMode union, and it is carried end to end — the CLI's
// PermissionMode type, MessageMetaSchema, and the SDK adapter's QueryOptions.
// dontAsk is deliberately absent from this legacy fallback. It became usable
// without a CLI version bump, so only an exact-machine capability catalog can
// prove that the receiving daemon supports it.
export function getClaudePermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'auto', name: 'Auto', description: translate('agentInput.permissionMode.auto'), sinceCliVersion: CLI_VERSION_WITH_AUTO },
        { key: 'acceptEdits', name: 'Edits', description: translate('agentInput.permissionMode.acceptEdits') },
        { key: 'plan', name: 'Plan', description: translate('agentInput.permissionMode.plan') },
        { key: 'bypassPermissions', name: 'Yolo', description: translate('agentInput.permissionMode.bypassPermissions') },
        { key: 'default', name: 'Default', description: translate('agentInput.permissionMode.default') },
    ];
}

// Auto is Codex's own everyday preset, spelled `on-request` + workspace-write
// by resolveCodexExecutionPolicy: Codex runs what it can and asks when it wants
// more. `default` is Happy's stricter baseline — `untrusted` + workspace-write,
// which stops for anything off the trusted list — and is named Default because
// it is where you land having picked nothing. `safe-yolo` keeps the workspace
// sandbox but stops asking, so it is the one named for the sandbox.
export function getCodexPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'auto', name: 'Auto', description: translate('agentInput.codexPermissionMode.autoDescription'), sinceCliVersion: CLI_VERSION_WITH_AUTO },
        { key: 'safe-yolo', name: 'Workspace', description: translate('agentInput.codexPermissionMode.safeYoloDescription') },
        { key: 'read-only', name: 'Read', description: translate('agentInput.codexPermissionMode.readOnlyDescription') },
        { key: 'yolo', name: 'Yolo', description: translate('agentInput.codexPermissionMode.yoloDescription') },
        { key: 'default', name: 'Default', description: translate('agentInput.codexPermissionMode.defaultDescription') },
    ];
}

// Only the keys runGemini actually honours (its validModes list). Gemini is
// retired from the harness picker, but existing sessions still open this menu,
// and the two modes that used to be here were both broken: `auto_edit` is not
// in MessageMetaSchema at all, so picking it dropped the entire message, and
// `plan` passed the schema only to be ignored by runGemini — which left the
// session on whatever it had before, up to and including yolo.
export function getGeminiPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'yolo', name: 'Yolo', description: translate('agentInput.geminiPermissionMode.yolo') },
        { key: 'default', name: 'Default', description: translate('agentInput.geminiPermissionMode.default') },
    ];
}

// The current generation only. Older Claudes and the `default model` row are
// deliberately absent: picking a model is the point of this menu, and every
// entry here is a 5.
//
// Keys are full model IDs rather than the short aliases, because the aliases
// do not all mean what the row says. `sonnet` still resolves to Sonnet 4.6 in
// the CLI's alias table, and `opus-5` is not in that table at all (`claude
// --model opus-5` errors on 2.1.199). Full IDs pass straight through to the
// API, so they say exactly which model is meant.
export function getClaudeModelModes(): ModelMode[] {
    return [
        { key: 'default', name: 'provider default', description: null, ...releaseModelDetails('claude', 'default') },
        ...HAPPYHERD_CLAUDE_MODEL_SLUGS.map((slug) => ({
            ...releaseModelDetails('claude', slug),
            key: slug,
            name: slug,
            description: null,
        })),
    ];
}

export function getCodexModelModes(): ModelMode[] {
    return [
        { key: 'gpt-5.6-sol', name: 'gpt-5.6 sol', description: null, ...releaseModelDetails('codex', 'gpt-5.6-sol') },
        { key: 'gpt-5.6-terra', name: 'gpt-5.6 terra', description: null, ...releaseModelDetails('codex', 'gpt-5.6-terra') },
        { key: 'gpt-5.6-luna', name: 'gpt-5.6 luna', description: null, ...releaseModelDetails('codex', 'gpt-5.6-luna') },
    ];
}

export function includeConfiguredModel(
    flavor: AgentFlavor,
    models: ModelMode[],
    configuredModelKey: string | null | undefined,
    translate: Translate,
): ModelMode[] {
    if (
        (flavor !== 'codex' && flavor !== 'agy')
        || !configuredModelKey
        || configuredModelKey === 'default'
        || models.some((model) => model.key === configuredModelKey)
    ) {
        return models;
    }
    return [
        ...models,
        {
            key: configuredModelKey,
            name: configuredModelKey,
            description: translate('modelMode.savedModelUnavailableDaemon'),
            unavailable: true,
            disabled: true,
        },
    ];
}

export function getGeminiModelModes(translate: Translate): ModelMode[] {
    return getGeminiModelFallbacks(translate);
}

// agy --print only distinguishes --sandbox (default) from --dangerously-skip-permissions,
// so only these two modes are offered. Default gets its own wording because agy
// --print is one-shot and cannot prompt: it never asks, it just runs under agy's
// own sandbox settings.
//
// The one place the shared ranking is deliberately ignored. Default sorts last
// everywhere else because it means "ask me about everything", the choice you
// make when none of the others fit. Here it means the opposite: it is agy's own
// launch default, the only sandboxed option, and the one agentDefaults picks.
// Ranking it below Yolo would put the escape hatch at the top of a two-item
// list and read as the recommendation.
export function getAgyPermissionModes(translate: Translate): PermissionMode[] {
    return [
        { key: 'default', name: 'Default', description: translate('agentInput.permissionMode.agyDefault') },
        { key: 'bypassPermissions', name: 'Yolo', description: translate('agentInput.permissionMode.bypassPermissions') },
    ];
}

/** `auto` first became valid shared message metadata in this CLI build. */
export const CLI_VERSION_WITH_AUTO = '1.2.1-beta.2';

export function modeSupportedByCli(
    mode: Pick<ModeOption, 'sinceCliVersion'>,
    cliVersion: string | null | undefined,
): boolean {
    if (!mode.sinceCliVersion || !cliVersion) return true;
    if (!isWellFormedVersion(cliVersion)) return false;
    return compareVersionsWithPrerelease(cliVersion, mode.sinceCliVersion) >= 0;
}

const PERMISSION_MODE_SINCE_CLI_VERSION: Record<string, string> = {
    auto: CLI_VERSION_WITH_AUTO,
};

export function permissionModeSupportedByCli(
    modeKey: string | null | undefined,
    cliVersion: string | null | undefined,
): boolean {
    if (!modeKey) return true;
    return modeSupportedByCli(
        { sinceCliVersion: PERMISSION_MODE_SINCE_CLI_VERSION[modeKey] },
        cliVersion,
    );
}

/**
 * Hardcoded compatibility filtering only. Exact-machine provider catalogs are
 * already authoritative for the daemon that will receive the request.
 */
export function filterPermissionModesForCli<T extends ModeOption>(
    modes: T[],
    cliVersion: string | null | undefined,
): T[] {
    return modes.filter((mode) => modeSupportedByCli(mode, cliVersion));
}

export function getHardcodedPermissionModes(flavor: AgentFlavor, translate: Translate): PermissionMode[] {
    if (flavor === 'codex') {
        return getCodexPermissionModes(translate);
    }
    if (flavor === 'gemini') {
        return getGeminiPermissionModes(translate);
    }
    if (flavor === 'agy') {
        return getAgyPermissionModes(translate);
    }
    if (flavor === 'claude' || flavor === null || flavor === undefined) {
        return getClaudePermissionModes(translate);
    }
    return [];
}

// Gemini effort is deliberately not encoded into separate model rows. Happy's
// existing effort picker carries `low`/`medium`/`high` independently, and happy-cli
// resolves the pair to the exact display name `agy --model` accepts.
export function getAgyModelModes(): ModelMode[] {
    return HAPPYHERD_AGY_MODEL_NAMES.map((key) => ({
        ...releaseModelDetails('agy', key),
        key,
        name: key,
        description: null,
    }));
}

export function getHardcodedModelModes(flavor: AgentFlavor, translate: Translate): ModelMode[] {
    if (flavor === 'codex') {
        return getCodexModelModes();
    }
    if (flavor === 'gemini') {
        return getGeminiModelModes(translate);
    }
    if (flavor === 'agy') {
        return getAgyModelModes();
    }
    if (flavor === 'claude' || flavor === null || flavor === undefined) {
        return getClaudeModelModes();
    }
    return [];
}

export function getAvailableModels(
    flavor: AgentFlavor,
    metadata: Metadata | null | undefined,
    translate: Translate,
    selectedKey?: string | null,
): ModelMode[] {
    const translateWithParams = translate as (key: any, params: Record<string, string | number | boolean>) => string;
    if (isRigMetadataV1(metadata)) {
        const models: ModelMode[] = getRigModels(metadata).map((model) => ({
            key: model.key,
            name: model.name,
            description: model.providerName,
            modelId: model.id,
            providerId: model.providerId,
            providerName: model.providerName,
            providerKind: model.providerKind,
            contextWindow: model.contextWindow,
            serviceTiers: model.serviceTiers,
            thinkingLevels: model.thinkingLevels,
            defaultThinkingLevel: model.defaultThinkingLevel,
        }));
        const current = getRigCurrentModel(metadata);
        if (current?.unavailable && !models.some((model) => model.key === current.key)) {
            models.push({
                key: current.key,
                name: current.name,
                description: translateWithParams('uiCopy.valueUnavailable', { value1: current.providerName }),
                modelId: current.id,
                providerId: current.providerId,
                providerName: current.providerName,
                providerKind: current.providerKind,
                thinkingLevels: [],
                serviceTiers: [],
                unavailable: true,
                disabled: true,
            });
        }
        const locallySelectedKey = selectedKey ?? metadata?.modelMode;
        if (locallySelectedKey && locallySelectedKey.includes(':') && !models.some((model) => model.key === locallySelectedKey)) {
            const separator = locallySelectedKey.indexOf(':');
            const providerId = locallySelectedKey.slice(0, separator);
            const modelId = locallySelectedKey.slice(separator + 1);
            models.push({
                key: locallySelectedKey,
                name: modelId,
                description: translateWithParams('uiCopy.valueUnavailable', { value1: providerId }),
                modelId,
                providerId,
                providerName: providerId,
                providerKind: 'custom',
                unavailable: true,
                disabled: true,
            });
        }
        return models;
    }
    const metadataModels = flavor === 'grok'
        ? (metadata?.models ?? []).map((model) => ({
            key: model.code,
            name: model.value,
            description: model.description ?? null,
            thinkingLevels: model.thinkingLevels,
            defaultThinkingLevel: model.defaultThinkingLevel ?? null,
        }))
        : mapMetadataOptions(metadata?.models);
    if (metadataModels.length > 0) {
        if (flavor === 'codex' && !metadataModels.some((model) => model.key === 'default')) {
            return [{ key: 'default', name: 'default model', description: null }, ...metadataModels];
        }
        return flavor === 'grok'
            ? includeUnavailableSelection(metadataModels, selectedKey, translate)
            : metadataModels;
    }
    return includeConfiguredModel(
        flavor,
        getHardcodedModelModes(flavor, translate),
        selectedKey,
        translate,
    );
}

export function getAvailablePermissionModes(
    flavor: AgentFlavor,
    metadata: Metadata | null | undefined,
    translate: Translate,
    selectedKey?: string | null,
): PermissionMode[] {
    if (isRigMetadataV1(metadata)) {
        const modes: PermissionMode[] = sortPermissionModes((metadata?.operatingModes ?? []).map((mode) => ({
            key: mode.code,
            name: mode.value,
            description: mode.description ?? null,
            semanticKind: mode.kind ?? null,
        })));
        const current = selectedKey
            ?? metadata?.currentOperatingModeCode
            ?? metadata?.permissionMode
            ?? metadata?.session?.permissionMode;
        if (current && !modes.some((mode) => mode.key === current)) {
            modes.unshift({
                key: current,
                name: current,
                description: translate('uiCopy.unavailableInTheCurrentRigModeCatalog'),
                semanticKind: null,
                disabled: true,
            });
        }
        return modes;
    }
    if (flavor === 'claude' || flavor === 'codex' || flavor === 'agy') {
        return hackModes(filterPermissionModesForCli(
            getHardcodedPermissionModes(flavor, translate),
            metadata?.version,
        ));
    }

    // GrokBuild ACP operating modes are plan/build behavior, not process
    // permission policies. Launch permissions come only from the machine
    // catalog discovered from `grok --help`.
    if (flavor === 'grok') return [];

    const metadataModes = mapMetadataOptions(metadata?.operatingModes);
    if (metadataModes.length > 0) {
        const modes = sortPermissionModes(hackModes(metadataModes));
        return modes;
    }

    return hackModes(getHardcodedPermissionModes(flavor, translate));
}

export function findOptionByKey<T extends ModeOption>(options: T[], key: string | null | undefined): T | null {
    if (!key) {
        return null;
    }
    return options.find((option) => option.key === key) ?? null;
}

export function resolveCurrentOption<T extends ModeOption>(
    options: T[],
    preferredKeys: Array<string | null | undefined>,
): T | null {
    for (const key of preferredKeys) {
        const option = findOptionByKey(options, key);
        if (option) {
            return option;
        }
    }
    return null;
}

export function getDefaultModelKey(flavor: AgentFlavor): string {
    return getCodeAgentDefaults(flavor).modelMode;
}

export function getDefaultPermissionModeKey(flavor: AgentFlavor): string {
    return getCodeAgentDefaults(flavor).permissionMode;
}

// Effort levels per agent type

function effortLevels(keys: readonly string[]): EffortLevel[] {
    return keys.map((key) => ({ key, name: key }));
}

// The Claude Agent SDK's own EffortLevel union, in order
// (node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:546). There is no
// `off`: Claude's floor is `low`.
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

// Antigravity exposes Gemini 3.8 Flash's three selectable thinking variants as
// separate model display names. Happy presents them through its effort picker;
// happy-cli performs the final model-name mapping at the provider boundary.
const AGY_EFFORTS_BY_MODEL: Record<string, readonly string[]> = {
    [HAPPYHERD_DEFAULT_AGY_MODEL]: HAPPYHERD_AGY_EFFORTS,
};

// Older/offline sessions retain the previously shipped Codex effort catalog.
// Connected sessions use the exact machine's live model catalog below.
const CODEX_EFFORTS_BY_MODEL: Record<string, readonly string[]> = {
    'gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    'gpt-5.6-terra': ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    'gpt-5.6-luna': ['low', 'medium', 'high', 'xhigh', 'max'],
};
const CODEX_EFFORTS_FALLBACK = ['low', 'medium', 'high', 'xhigh'] as const;

export function getClaudeEffortLevels(): EffortLevel[] {
    return effortLevels(CLAUDE_EFFORTS);
}

export function getAgyEffortLevels(modelKey?: string | null): EffortLevel[] {
    return effortLevels((modelKey ? AGY_EFFORTS_BY_MODEL[modelKey] : undefined) ?? []);
}

/**
 * Codex efforts for one model. An unknown model — a workspace's own, or one
 * newer than this table — gets the conservative set every gpt-5 accepts rather
 * than a guess at the top of its range.
 */
export function getCodexEffortLevels(modelKey?: string | null): EffortLevel[] {
    return effortLevels(
        (modelKey ? CODEX_EFFORTS_BY_MODEL[modelKey] : undefined) ?? CODEX_EFFORTS_FALLBACK,
    );
}

export function getHardcodedEffortLevels(flavor: AgentFlavor): EffortLevel[] {
    if (flavor === 'claude') return getClaudeEffortLevels();
    if (flavor === 'codex') return getCodexEffortLevels();
    if (flavor === 'agy') return getAgyEffortLevels(getDefaultModelKey('agy'));
    return [];
}

export function getDefaultEffortKey(flavor: AgentFlavor): string | null {
    return getCodeAgentDefaults(flavor).effortLevel;
}

// Per-model effort: returns effort levels for a specific model, or empty if the model has no effort
export function getEffortLevelsForModel(
    flavor: AgentFlavor,
    modelKey: string,
    metadata?: Metadata | null,
): EffortLevel[] {
    if (isRigMetadataV1(metadata)) {
        return getRigReasoningLevels(metadata, modelKey).map((level) => ({
            key: level,
            name: level,
        }));
    }
    if (flavor === 'grok') {
        const selectedModel = metadata?.models?.find((model) => model.code === modelKey);
        if (selectedModel?.thinkingLevels !== undefined) {
            return effortLevels(selectedModel.thinkingLevels);
        }
        return mapMetadataOptions(metadata?.thoughtLevels);
    }
    // Legacy/offline sessions use flavor fallbacks. Connected sessions use
    // the selected machine's model-specific provider catalog below.
    if (flavor === 'claude') {
        return getClaudeEffortLevels();
    }
    if (flavor === 'codex') {
        return getCodexEffortLevels(modelKey);
    }
    if (flavor === 'agy') {
        return getAgyEffortLevels(modelKey);
    }
    return [];
}

function shouldUseMachineCapabilityCatalog(
    flavor: AgentFlavor,
    sessionMetadata: Metadata | null | undefined,
    machineMetadata: MachineMetadata | null | undefined,
    hasRuntimeCatalog: boolean,
): boolean {
    return !isRigMetadataV1(sessionMetadata)
        && !(flavor === 'grok' && hasRuntimeCatalog)
        && getMachineCatalog(machineMetadata, flavor) !== null;
}

/**
 * Active Happy CLI sessions use the same machine-advertised model catalog as
 * New Session. Rig sessions keep their session-owned dynamic catalog, while
 * older/offline Happy sessions retain the legacy session fallback.
 */
export function getSessionAvailableModels(
    flavor: AgentFlavor,
    sessionMetadata: Metadata | null | undefined,
    machineMetadata: MachineMetadata | null | undefined,
    translate: Translate,
    selectedKey?: string | null,
): ModelMode[] {
    if (shouldUseMachineCapabilityCatalog(
        flavor,
        sessionMetadata,
        machineMetadata,
        sessionMetadata?.models !== undefined,
    )) {
        return getMachineAdvertisedModels(machineMetadata, flavor, translate, selectedKey);
    }
    return getAvailableModels(flavor, sessionMetadata, translate, selectedKey);
}

export function getSessionAvailablePermissionModes(
    flavor: AgentFlavor,
    sessionMetadata: Metadata | null | undefined,
    machineMetadata: MachineMetadata | null | undefined,
    translate: Translate,
    selectedKey?: string | null,
): PermissionMode[] {
    // GrokBuild permissions are process launch policies advertised by the
    // machine. The ACP session's operatingModes are its independent
    // plan/build modes and must never replace this launch catalog.
    if ((flavor === 'grok' || flavor === 'dsh') && !isRigMetadataV1(sessionMetadata)) {
        return getMachineAdvertisedPermissionModes(machineMetadata, flavor, translate, selectedKey);
    }
    if (shouldUseMachineCapabilityCatalog(
        flavor,
        sessionMetadata,
        machineMetadata,
        sessionMetadata?.operatingModes !== undefined,
    )) {
        return getMachineAdvertisedPermissionModes(machineMetadata, flavor, translate, selectedKey);
    }
    return getAvailablePermissionModes(flavor, sessionMetadata, translate, selectedKey);
}

export function getSessionEffortLevelsForModel(
    flavor: AgentFlavor,
    modelKey: string,
    sessionMetadata: Metadata | null | undefined,
    machineMetadata: MachineMetadata | null | undefined,
): EffortLevel[] {
    const runtimeModelEfforts = sessionMetadata?.models
        ?.find((model) => model.code === modelKey)
        ?.thinkingLevels;
    if (shouldUseMachineCapabilityCatalog(
        flavor,
        sessionMetadata,
        machineMetadata,
        runtimeModelEfforts !== undefined || sessionMetadata?.thoughtLevels !== undefined,
    )) {
        return getMachineAdvertisedEffortLevels(machineMetadata, flavor, modelKey);
    }
    return getEffortLevelsForModel(flavor, modelKey, sessionMetadata);
}

export function getRigCurrentModelOptionKey(metadata: Metadata | null | undefined): string | null {
    return getRigSelectedModelKey(metadata);
}

// Default effort for a model — highest the model allows
export function getDefaultEffortKeyForModel(flavor: AgentFlavor, modelKey: string): string | null {
    const levels = getEffortLevelsForModel(flavor, modelKey);
    if (levels.length === 0) return null;
    return getCodeAgentDefaults(flavor).effortLevel ?? levels[levels.length - 1].key;
}

export function getSupportsWorktree(_flavor: AgentFlavor): boolean {
    return true;
}
