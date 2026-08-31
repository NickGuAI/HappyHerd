/**
 * Session Metadata Factory
 *
 * Creates session state and metadata objects for all backends (Claude, Codex, Gemini).
 * This follows DRY principles by providing a single implementation for all backends.
 *
 * @module createSessionMetadata
 */

import os from 'node:os';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import type { AgentState, Metadata } from '@/api/types';
import {
    HappyHerdMachineSessionSettingsSchema,
    type HappyHerdMachineSessionSettings,
} from '@slopus/happy-wire';
import { configuration } from '@/configuration';
import { projectPath } from '@/projectPath';
import type { SandboxConfig } from '@/persistence';
import packageJson from '../../package.json';
import { contextMetadataFromEnvironment } from '@/agentContext/commanderContext';
import { automationMetadataFromEnvironment } from '@/automations/sessionBootstrap';
import { machineSessionSettingsMetadataFromEnvironment } from '@/daemon/sessionLaunchSettings';

/**
 * Backend flavor identifier for session metadata.
 */
export type BackendFlavor = 'claude' | 'codex' | 'gemini' | 'grok' | 'opencode' | 'agy' | 'acp';

/**
 * Options for creating session metadata.
 */
export interface CreateSessionMetadataOptions {
    /** Backend flavor (claude, codex, gemini) */
    flavor: BackendFlavor;
    /** Machine ID for server identification */
    machineId: string;
    /** How the session was started */
    startedBy?: 'daemon' | 'terminal';
    /** Active sandbox config for the session, or undefined when not used */
    sandbox?: SandboxConfig;
    /** Whether the backend runs with "dangerously skip permissions" behavior */
    dangerouslySkipPermissions?: boolean;
    /** Launch settings selected by a direct terminal command. Daemon handoff metadata remains authoritative. */
    spawnSettings?: HappyHerdMachineSessionSettings;
    /** Happy session id this session was forked from. */
    parentSessionId?: string;
    /** Happy message id used as the fork rewind point. */
    forkedFromMessageId?: string;
    /** Marks this session as a hidden side chat of `parentSessionId`. */
    isSideChat?: boolean;
}

/**
 * Result containing both state and metadata for session creation.
 */
export interface SessionMetadataResult {
    /** Agent state for session */
    state: AgentState;
    /** Session metadata */
    metadata: Metadata;
}

export function providerContinuationMetadataFromEnvironment(): Pick<Metadata, 'continuedFromSessionId'> {
    const continuedFromSessionId = process.env.HAPPY_CONTINUED_FROM_SESSION_ID?.trim();
    return continuedFromSessionId ? { continuedFromSessionId } : {};
}

function getGitBranch(cwd: string): string | undefined {
    try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        }).trim();
        return branch && branch !== 'HEAD' ? branch : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Creates session state and metadata for backend agents.
 *
 * This utility consolidates the common session metadata creation logic used by
 * Codex and Gemini backends, ensuring consistency across all backend implementations.
 *
 * @param opts - Options specifying flavor, machineId, and startedBy
 * @returns Object containing state and metadata for session creation
 *
 * @example
 * ```typescript
 * const { state, metadata } = createSessionMetadata({
 *     flavor: 'gemini',
 *     machineId: settings.machineId,
 *     startedBy: opts.startedBy
 * });
 *
 * const response = await api.getOrCreateSession({ tag: sessionTag, metadata, state });
 * ```
 */
export function createSessionMetadata(opts: CreateSessionMetadataOptions): SessionMetadataResult {
    const state: AgentState = {
        controlledByUser: false,
    };
    const cwd = process.cwd();
    const gitBranch = getGitBranch(cwd);

    const metadata: Metadata = {
        path: cwd,
        host: os.hostname(),
        version: packageJson.version,
        os: os.platform(),
        machineId: opts.machineId,
        homeDir: os.homedir(),
        happyHomeDir: configuration.happyHomeDir,
        happyLibDir: projectPath(),
        happyToolsDir: resolve(projectPath(), 'tools', 'unpacked'),
        startedFromDaemon: opts.startedBy === 'daemon',
        hostPid: process.pid,
        startedBy: opts.startedBy || 'terminal',
        lifecycleState: 'running',
        lifecycleStateSince: Date.now(),
        flavor: opts.flavor,
        ...(opts.flavor === 'codex'
            ? { codexHome: resolve(process.env.CODEX_HOME?.trim() || resolve(os.homedir(), '.codex')) }
            : {}),
        ...(process.env.HAPPYHERD_PROVIDER_ACCOUNT
            ? { providerAccount: process.env.HAPPYHERD_PROVIDER_ACCOUNT }
            : {}),
        sandbox: opts.sandbox?.enabled ? opts.sandbox : null,
        dangerouslySkipPermissions: opts.dangerouslySkipPermissions ?? null,
        ...(opts.spawnSettings
            ? { spawnSettings: HappyHerdMachineSessionSettingsSchema.parse(opts.spawnSettings) }
            : {}),
        ...(gitBranch ? { gitBranch } : {}),
        ...(opts.parentSessionId ? { parentSessionId: opts.parentSessionId } : {}),
        ...(opts.forkedFromMessageId ? { forkedFromMessageId: opts.forkedFromMessageId } : {}),
        ...(opts.isSideChat ? { isSideChat: true } : {}),
        ...providerContinuationMetadataFromEnvironment(),
        ...contextMetadataFromEnvironment(),
        ...automationMetadataFromEnvironment(),
        // A target daemon's validated handoff overrides any caller-supplied
        // direct-terminal receipt when both are present.
        ...machineSessionSettingsMetadataFromEnvironment(),
        ...(process.env.HAPPYHERD_AGENT_SURFACE_ID
            ? { happyHerdAgentSurfaceId: process.env.HAPPYHERD_AGENT_SURFACE_ID }
            : {}),
    };

    return { state, metadata };
}
