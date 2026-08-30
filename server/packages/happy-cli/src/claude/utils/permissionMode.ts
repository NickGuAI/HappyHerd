import type { QueryOptions } from '@/claude/sdk';
import type { PermissionMode } from '@/api/types';
import { logger } from '@/ui/logger';

/** Derived from SDK's QueryOptions - the modes Claude actually supports */
export type ClaudeSdkPermissionMode = NonNullable<QueryOptions['permissionMode']>;

/** Pass a provider-native Claude permission mode to the SDK unchanged. */
export function mapToClaudeMode(mode: undefined): undefined;
export function mapToClaudeMode(mode: PermissionMode): ClaudeSdkPermissionMode;
export function mapToClaudeMode(mode: PermissionMode | undefined): ClaudeSdkPermissionMode | undefined;
export function mapToClaudeMode(mode: PermissionMode | undefined): ClaudeSdkPermissionMode | undefined {
    // Undefined is a meaningful value, not a missing one: it is how "Default"
    // reaches the SDK, which then applies Claude's own configuration.
    if (mode === undefined) {
        return undefined;
    }
    if (!isClaudePermissionMode(mode)) {
        throw new Error(`Unsupported Claude permission mode: ${mode}`);
    }
    return mode;
}

const CLAUDE_PERMISSION_MODES: readonly ClaudeSdkPermissionMode[] = [
    'auto',
    'default',
    'acceptEdits',
    'bypassPermissions',
    'plan',
    'dontAsk',
] as const;

export function isClaudePermissionMode(value: string | undefined): value is ClaudeSdkPermissionMode {
    return !!value && CLAUDE_PERMISSION_MODES.includes(value as ClaudeSdkPermissionMode);
}

/**
 * Narrow a permission mode that arrived over the wire. The message schema
 * accepts any string so a newer app can name a mode this CLI does not know
 * yet; an unknown one is dropped here with a warning, keeping the message
 * itself deliverable and the session on its current mode.
 */
export function normalizeRemotePermissionMode(value: string | undefined): ClaudeSdkPermissionMode | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (isClaudePermissionMode(value)) {
        return value;
    }
    logger.info(`[permissionMode] Ignoring unknown permission mode '${value}' from app; this CLI version does not support it`);
    return undefined;
}

/**
 * Extract permission mode override from Claude CLI args.
 * Supports both:
 * - --permission-mode VALUE
 * - --permission-mode=VALUE
 */
export function extractPermissionModeFromClaudeArgs(claudeArgs?: string[]): ClaudeSdkPermissionMode | undefined {
    if (!claudeArgs || claudeArgs.length === 0) {
        return undefined;
    }

    let found: ClaudeSdkPermissionMode | undefined = undefined;
    for (let i = 0; i < claudeArgs.length; i++) {
        const arg = claudeArgs[i];
        if (arg === '--permission-mode') {
            const next = claudeArgs[i + 1];
            if (!isClaudePermissionMode(next)) {
                throw new Error(`Unsupported Claude permission mode: ${next ?? ''}`);
            }
            found = next;
            i += 1;
            continue;
        }

        if (arg.startsWith('--permission-mode=')) {
            const value = arg.slice('--permission-mode='.length);
            if (!isClaudePermissionMode(value)) {
                throw new Error(`Unsupported Claude permission mode: ${value}`);
            }
            found = value;
        }
    }

    return found;
}

/**
 * Resolve the initial permission mode for remote Claude execution.
 * `--dangerously-skip-permissions` takes precedence over all other modes.
 */
export function resolveInitialClaudePermissionMode(
    optionMode: PermissionMode | undefined,
    claudeArgs?: string[],
): PermissionMode | undefined {
    if (claudeArgs?.includes('--dangerously-skip-permissions')) {
        return 'bypassPermissions';
    }
    return extractPermissionModeFromClaudeArgs(claudeArgs) ?? optionMode;
}

/** Build the native Claude Code CLI policy/settings flags for local execution. */
export function buildClaudeNativeCliArgs(
    baseArgs: string[] | undefined,
    settings: {
        permissionMode?: PermissionMode;
        model?: string | null;
        effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;
    },
): string[] {
    const args: string[] = [];
    for (let index = 0; index < (baseArgs?.length ?? 0); index += 1) {
        const arg = baseArgs![index];
        if (arg === '--permission-mode') {
            index += 1;
            continue;
        }
        if (arg.startsWith('--permission-mode=') || arg === '--dangerously-skip-permissions') {
            continue;
        }
        args.push(arg);
    }

    if (settings.permissionMode) {
        if (!isClaudePermissionMode(settings.permissionMode)) {
            throw new Error(`Unsupported Claude permission mode: ${settings.permissionMode}`);
        }
        const nativeMode = mapToClaudeMode(settings.permissionMode);
        args.push('--permission-mode', nativeMode);
        if (nativeMode === 'bypassPermissions') {
            args.push('--dangerously-skip-permissions');
        }
    }
    if (settings.model && settings.model !== 'default') {
        args.push('--model', settings.model);
    }
    if (settings.effort) {
        args.push('--effort', settings.effort);
    }
    return args;
}

/**
 * Avoid a second provider prompt only when the Human did not choose a native
 * Claude permission. An explicit selection remains exact even when HappyHerd
 * also wraps the process in its own OS sandbox.
 */
export function applySandboxPermissionPolicy(
    mode: PermissionMode | undefined,
    sandboxEnabled: boolean,
): PermissionMode | undefined {
    if (sandboxEnabled && mode === undefined) {
        return 'bypassPermissions';
    }
    return mode;
}

export function isClaudeBypassEquivalent(mode: PermissionMode | undefined): boolean {
    return mode === 'bypassPermissions';
}

/**
 * Resolve permission mode overrides from remote app messages.
 *
 * Every concrete app selection is an exact live-mode transition. An absent
 * value retains the current mode; an explicit `default` leaves bypass/yolo and
 * restores Claude's normal ask-first policy.
 */
export function resolveRemoteClaudePermissionMode(
    currentMode: PermissionMode | undefined,
    incomingMode: PermissionMode | undefined,
    _sandboxEnabled: boolean,
): PermissionMode | undefined {
    if (!incomingMode) {
        return currentMode;
    }

    // The OS sandbox only chooses the initial no-double-prompt policy. A
    // concrete Human selection is an exact live transition and must not be
    // rewritten behind the UI.
    return incomingMode;
}
