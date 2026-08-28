import { existsSync } from 'node:fs';

import type { Metadata } from '@/api/types';
import { encodeBase64 } from '@/api/encryption';
import { hasLocalHappyAgentAuth } from '@/resume/localHappyAgentAuth';
import { spawnHappyCLI } from '@/utils/spawnHappyCLI';
import { buildSessionChildEnvironment, sanitizeSessionEnvironment } from '@/daemon/sessionEnvironment';
import { contextEnvironment, prepareCommanderContext } from '@/agentContext/commanderContext';
import { detectAgentCapabilities } from '@/capabilities/agentCapabilities';
import {
    persistedProviderPermissionMode,
    resolveEffectiveSessionSettings,
} from '@/capabilities/sessionLaunchSettings';
import { detectCLIAvailability } from '@/utils/detectCLI';

import { LocalResumeSessionError, resolveLocalReconnectableSession } from './localResumeStore';
import { resolveHappySession, type ReconnectableHappySession, type ResumableHappySession } from './resolveHappySession';
import { resolveCodexHomeForResume } from './codexHome';

export type ResumeLaunch = {
    cwd: string;
    args: string[];
};

export type ResumeLaunchOptions = {
    claudeStartingMode?: 'local' | 'remote';
    startedBy?: 'daemon' | 'terminal';
};

export function parseResumeCommandArgs(args: string[]): { showHelp: boolean; sessionId: string } {
    if (args.includes('-h') || args.includes('--help')) {
        return {
            showHelp: true,
            sessionId: '',
        };
    }

    if (args.length === 0) {
        throw new Error('Happy session ID is required: happy resume <session-id>');
    }
    if (args.length > 1) {
        throw new Error(`Unexpected arguments for happy resume: ${args.slice(1).join(' ')}`);
    }

    return {
        showHelp: false,
        sessionId: args[0],
    };
}

function resolveFlavor(metadata: Metadata): 'codex' | 'claude' | 'grok' | null {
    if (metadata.flavor === 'grok') {
        return 'grok';
    }
    if (metadata.flavor === 'codex' || metadata.codexThreadId) {
        return 'codex';
    }
    if (metadata.flavor === 'claude' || metadata.claudeSessionId) {
        return 'claude';
    }
    return null;
}

export function buildResumeLaunch(session: ResumableHappySession, options: ResumeLaunchOptions = {}): ResumeLaunch {
    const { metadata } = session;
    const flavor = resolveFlavor(metadata);

    if (flavor === 'codex') {
        if (!metadata.codexThreadId) {
            throw new Error(`Happy session ${session.id} is missing its Codex thread ID.`);
        }
        const args = ['codex', '--resume', metadata.codexThreadId];
        if (options.startedBy) {
            args.push('--started-by', options.startedBy);
        }
        return {
            cwd: metadata.path,
            args,
        };
    }

    if (flavor === 'claude') {
        if (!metadata.claudeSessionId) {
            throw new Error(`Happy session ${session.id} is missing its Claude session ID.`);
        }
        const args = ['claude'];
        if (options.claudeStartingMode) {
            args.push('--happy-starting-mode', options.claudeStartingMode);
        }
        if (options.startedBy) {
            args.push('--started-by', options.startedBy);
        }
        args.push('--resume', metadata.claudeSessionId);
        return {
            cwd: metadata.path,
            args,
        };
    }

    if (flavor === 'grok') {
        if (!metadata.acpSessionId) {
            throw new Error(`Happy session ${session.id} is missing its ACP session ID.`);
        }
        const args = ['grok'];
        if (options.startedBy) {
            args.push('--started-by', options.startedBy);
        }
        args.push('--resume', metadata.acpSessionId);
        return { cwd: metadata.path, args };
    }

    throw new Error(`Happy session ${session.id} uses unsupported flavor "${metadata.flavor ?? 'unknown'}".`);
}

export function formatResumeHelp(): string {
    return [
        'happy resume - Resume a previous Happy session',
        '',
        'Usage:',
        '  happy resume <happy-session-id>',
        '',
        'Examples:',
        '  happy resume cmmij8olq00dp5jcxr3wtbpau',
        '  happy resume cmmij8',
        '',
        'This reuses the saved worktree/path and resumes the underlying agent session',
        'when the backend supports it.',
    ].join('\n');
}

async function buildReconnectEnv(session: ReconnectableHappySession): Promise<NodeJS.ProcessEnv> {
    const contextBundle = await prepareCommanderContext(session.metadata.commanderId, session.metadata.path);
    const codexHome = await resolveCodexHomeForResume(session.metadata);
    return buildSessionChildEnvironment(process.env, {
        ...contextEnvironment(contextBundle),
        ...(codexHome ? { CODEX_HOME: codexHome } : {}),
        HAPPY_RECONNECT_SESSION_ID: session.id,
        HAPPY_RECONNECT_ENCRYPTION_KEY: encodeBase64(session.encryptionKey),
        HAPPY_RECONNECT_ENCRYPTION_VARIANT: session.encryptionVariant,
        HAPPY_RECONNECT_SEQ: String(session.seq),
        HAPPY_RECONNECT_METADATA_VERSION: String(session.metadataVersion),
        HAPPY_RECONNECT_AGENT_STATE_VERSION: String(session.agentStateVersion),
    });
}

function spawnResumeChild(launch: ResumeLaunch, env: NodeJS.ProcessEnv = sanitizeSessionEnvironment(process.env)): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const child = spawnHappyCLI(launch.args, {
            cwd: launch.cwd,
            env,
            stdio: 'inherit',
        });

        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`Resumed session exited via signal ${signal}`));
                return;
            }
            resolve(code);
        });
    });
}

/** Rebuild a local Grok resume from the saved launch receipt and today's local provider catalog. */
export async function buildValidatedTerminalResumeLaunch(
    session: ResumableHappySession,
): Promise<ResumeLaunch> {
    const launch = buildResumeLaunch(session);
    if (resolveFlavor(session.metadata) !== 'grok') return launch;

    const permissionMode = persistedProviderPermissionMode(session.metadata, 'grok');

    const availability = detectCLIAvailability();
    const discovery = await detectAgentCapabilities(availability);
    const settings = resolveEffectiveSessionSettings({
        host: 'local',
        platform: process.platform,
        happyCliVersion: 'local',
        homeDir: session.metadata.homeDir,
        happyHomeDir: session.metadata.happyHomeDir,
        happyLibDir: session.metadata.happyLibDir,
        cliAvailability: availability,
        agentCapabilities: discovery.capabilities,
        ...(discovery.grokCapabilityError ? { grokCapabilityError: discovery.grokCapabilityError } : {}),
    }, 'local', {
        provider: 'grok',
        permission: permissionMode,
    });
    if (settings.permission) {
        launch.args.push('--permission-mode', settings.permission);
    }
    return launch;
}

async function resolveLegacySessionIfAvailable(sessionId: string): Promise<ResumableHappySession | null> {
    if (!hasLocalHappyAgentAuth()) {
        return null;
    }
    return resolveHappySession(sessionId);
}

export async function handleResumeCommand(args: string[]): Promise<void> {
    const parsed = parseResumeCommandArgs(args);
    if (parsed.showHelp) {
        console.log(formatResumeHelp());
        return;
    }

    let localError: unknown;
    let reconnectableSession: ReconnectableHappySession | null = null;
    try {
        reconnectableSession = await resolveLocalReconnectableSession(parsed.sessionId);
    } catch (error) {
        localError = error;
        if (error instanceof LocalResumeSessionError && error.code === 'ambiguous') {
            throw error;
        }
    }

    if (reconnectableSession) {
        const launch = await buildValidatedTerminalResumeLaunch(reconnectableSession);

        if (!existsSync(launch.cwd)) {
            throw new Error(`Saved session path does not exist: ${launch.cwd}`);
        }

        const exitCode = await spawnResumeChild(launch, await buildReconnectEnv(reconnectableSession));
        if (typeof exitCode === 'number' && exitCode !== 0) {
            process.exit(exitCode);
        }
        return;
    }

    const session = await resolveLegacySessionIfAvailable(parsed.sessionId);
    if (!session) {
        throw localError;
    }
    const launch = await buildValidatedTerminalResumeLaunch(session);

    if (!existsSync(launch.cwd)) {
        throw new Error(`Saved session path does not exist: ${launch.cwd}`);
    }

    const exitCode = await spawnResumeChild(launch);
    if (typeof exitCode === 'number' && exitCode !== 0) {
        process.exit(exitCode);
    }
}
