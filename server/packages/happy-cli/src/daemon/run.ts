import fs from 'fs/promises';
import os from 'os';
import * as tmp from 'tmp';
import { randomUUID } from 'node:crypto';
import {
  HappyHerdAutomationProviderOutcomeSchema,
  type HappyHerdAutomationProviderOutcome,
  type HappyHerdAutomationRun,
} from '@slopus/happy-wire';

import { ApiClient } from '@/api/api';
import { TrackedSession, SessionEncryptionData } from './types';
import { MachineMetadata, DaemonState, Metadata, type Session } from '@/api/types';
import { HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION } from '@slopus/happy-wire';
import { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { logger } from '@/ui/logger';
import { authAndSetupMachineIfNeeded } from '@/ui/auth';
import { configuration } from '@/configuration';
import { startCaffeinate, stopCaffeinate } from '@/utils/caffeinate';
import { getEnvironmentInfo } from '@/ui/doctor';
import { spawnHappyCLI } from '@/utils/spawnHappyCLI';
import { writeDaemonState, DaemonLocallyPersistedState, readDaemonState, acquireDaemonLock, releaseDaemonLock, readPersistedSessions, persistSession } from '@/persistence';
import type { PersistedSession } from '@/persistence';

import { cleanupDaemonState, isDaemonRunningCurrentlyInstalledHappyVersion, listDaemonSessions, stopDaemon } from './controlClient';
import { startDaemonControlServer } from './controlServer';
import { statSync } from 'fs';
import { join } from 'path';
import { projectPath } from '@/projectPath';
import { getTmuxUtilities, isTmuxAvailable, parseTmuxSessionIdentifier, formatTmuxSessionIdentifier } from '@/utils/tmux';
import { expandEnvironmentVariables } from '@/utils/expandEnvVars';
import { detectCLIAvailability } from '@/utils/detectCLI';
import { buildBaselineAgentCapabilities } from '@/capabilities/agentCapabilities';
import { buildResumeLaunch } from '@/resume/handleResumeCommand';
import { resolveCodexHomeForResume } from '@/resume/codexHome';
import { detectResumeSupport } from '@/resume/localHappyAgentAuth';
import { backfillReconnectableSessionForMachine, resolveLocalReconnectableSession } from '@/resume/localResumeStore';
import { encodeBase64, decodeBase64, decrypt } from '@/api/encryption';
import {
  buildSessionChildEnvironment,
  happyHerdAgentSessionRuntimeEnvironment,
  sanitizeSessionEnvironment,
  wrapTmuxCommandWithSessionEnvironmentSanitizer,
} from './sessionEnvironment';
import { contextEnvironment, prepareCommanderContext } from '@/agentContext/commanderContext';
import { HappyHerdAutomationService } from '@/automations/service';
import { automationBootstrapEnvironment, prepareAutomationBootstrap } from '@/automations/sessionBootstrap';
import { appendDaemonSpawnModeArgs } from './spawnModeArgs';
import { SessionProcessLifecycle } from './sessionProcessLifecycle';
import { hasProviderProcessExited } from './processStatus';
import { startHappyTerminalDaemon } from './happyTerminalBoot';
import { loadSessionRecords } from '@/api/sessionLookup';
import {
  machineSessionSettingsEnvironment,
  persistedMachineSessionSettingsMatch,
} from './sessionLaunchSettings';
import type { HappyHerdMachineSessionSettings } from '@slopus/happy-wire';
import { createChildSideChat } from '@/commands/sideChat';

type AutomationTrackedSession = TrackedSession & {
  automationId?: string;
  automationRunId?: string;
};

function trackedSessionWithAutomationProvenance(
  session: TrackedSession,
  metadata: Metadata | undefined = session.happySessionMetadataFromLocalWebhook,
): AutomationTrackedSession {
  const tracked = session as AutomationTrackedSession;
  return {
    ...tracked,
    ...(tracked.automationId ? { automationId: tracked.automationId } : metadata?.automationId ? { automationId: metadata.automationId } : {}),
    ...(tracked.automationRunId ? { automationRunId: tracked.automationRunId } : metadata?.automationRunId ? { automationRunId: metadata.automationRunId } : {}),
  };
}

export function automationSessionMatchesRun(
  run: HappyHerdAutomationRun,
  session: AutomationTrackedSession,
  metadata: Metadata | undefined = session.happySessionMetadataFromLocalWebhook,
): boolean {
  return run.status === 'started'
    && run.sessionId !== null
    && run.sessionId === session.happySessionId
    && session.automationId === run.automationId
    && session.automationRunId === run.id
    && metadata?.startedFromDaemon === true
    && metadata.hostPid === session.pid
    && metadata.automationId === run.automationId
    && metadata.automationRunId === run.id;
}

export function automationWebhookMatchesTrackedSession(
  session: AutomationTrackedSession,
  metadata: Metadata,
): boolean {
  return metadata.startedFromDaemon === true
    && metadata.hostPid === session.pid
    && typeof session.automationId === 'string'
    && typeof session.automationRunId === 'string'
    && metadata.automationId === session.automationId
    && metadata.automationRunId === session.automationRunId;
}

export function exactAutomationProviderOutcome(
  run: HappyHerdAutomationRun,
  session: AutomationTrackedSession,
  metadata: Metadata | undefined,
): HappyHerdAutomationProviderOutcome | null {
  if (!automationSessionMatchesRun(run, session, metadata)) return null;
  const parsed = HappyHerdAutomationProviderOutcomeSchema.safeParse(metadata?.automationProviderOutcome);
  if (!parsed.success) return null;
  return parsed.data.automationId === run.automationId && parsed.data.runId === run.id
    ? parsed.data
    : null;
}

export function resolveExitedAutomationProviderOutcome(
  run: HappyHerdAutomationRun,
  session: AutomationTrackedSession,
  metadata: Metadata,
): Pick<HappyHerdAutomationProviderOutcome, 'status' | 'message'> {
  const outcome = exactAutomationProviderOutcome(run, session, metadata);
  return outcome ?? {
    status: 'failed',
    message: 'Provider exited before recording an exact one-shot outcome.',
  };
}

/** Shell-escape a string for safe interpolation into tmux commands. */
function shellescape(s: string): string {
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

export type DaemonAgentCommand = 'claude' | 'codex' | 'gemini' | 'grok' | 'agy';

/** Resolve only explicitly supported daemon providers; unknown values never fall through to Claude. */
export function resolveDaemonAgentCommand(agent: SpawnSessionOptions['agent']): DaemonAgentCommand | null {
  if (agent === undefined) return 'claude';
  return agent === 'claude'
    || agent === 'codex'
    || agent === 'gemini'
    || agent === 'grok'
    || agent === 'agy'
    ? agent
    : null;
}

export function resolveDaemonResumeAgent(metadata: Metadata): 'claude' | 'codex' | 'grok' | null {
  if (metadata.flavor === 'grok') return 'grok';
  if (metadata.flavor === 'codex' || metadata.codexThreadId) return 'codex';
  if (metadata.flavor === 'claude' || metadata.claudeSessionId) return 'claude';
  return null;
}

// Prepare initial metadata
// Suffix host with `-dev` for the HAPPY_VARIANT=dev variant so the dev daemon
// is visually distinct from the stable one in the machine list (they otherwise
// share the same hostname and look identical).
const hostSuffix = process.env.HAPPY_VARIANT === 'dev' ? '-dev' : '';
const initialCLIAvailability = detectCLIAvailability();
export const initialMachineMetadata: MachineMetadata = {
  host: os.hostname() + hostSuffix,
  platform: os.platform(),
  happyCliVersion: configuration.currentCliVersion,
  machineSessionProtocolVersion: HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION,
  homeDir: os.homedir(),
  happyHomeDir: configuration.happyHomeDir,
  happyLibDir: projectPath(),
  cliAvailability: initialCLIAvailability,
  resumeSupport: { ...detectResumeSupport(), rpcAvailable: true },
  agentCapabilities: buildBaselineAgentCapabilities(initialCLIAvailability),
};

export async function startDaemon(): Promise<void> {
  // The daemon may have been launched from a session process. Keep its normal
  // environment, but never let session lineage or reconnect state reach a
  // later, unrelated child session.
  const ambientEnvironment = sanitizeSessionEnvironment(process.env);

  // We don't have cleanup function at the time of server construction
  // Control flow is:
  // 1. Create promise that will resolve when shutdown is requested
  // 2. Setup signal handlers to resolve this promise with the source of the shutdown
  // 3. Once our setup is complete - if all goes well - we await this promise
  // 4. When it resolves we can cleanup and exit
  //
  // In case the setup malfunctions - our signal handlers will not properly
  // shut down. We will force exit the process with code 1.
  let requestShutdown: (source: 'happy-app' | 'happy-cli' | 'os-signal' | 'exception', errorMessage?: string) => void;
  let resolvesWhenShutdownRequested = new Promise<({ source: 'happy-app' | 'happy-cli' | 'os-signal' | 'exception', errorMessage?: string })>((resolve) => {
    requestShutdown = (source, errorMessage) => {
      logger.debug(`[DAEMON RUN] Requesting shutdown (source: ${source}, errorMessage: ${errorMessage})`);

      // Fallback - in case startup malfunctions - we will force exit the process with code 1
      setTimeout(async () => {
        logger.debug('[DAEMON RUN] Startup malfunctioned, forcing exit with code 1');

        // Give time for logs to be flushed
        await new Promise(resolve => setTimeout(resolve, 100))

        process.exit(1);
      }, 1_000);

      // Start graceful shutdown
      resolve({ source, errorMessage });
    };
  });

  // Setup signal handlers
  process.on('SIGINT', () => {
    logger.debug('[DAEMON RUN] Received SIGINT');
    requestShutdown('os-signal');
  });

  process.on('SIGTERM', () => {
    logger.debug('[DAEMON RUN] Received SIGTERM');
    requestShutdown('os-signal');
  });

  process.on('uncaughtException', (error) => {
    logger.debug('[DAEMON RUN] FATAL: Uncaught exception', error);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    requestShutdown('exception', error.message);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.debug('[DAEMON RUN] FATAL: Unhandled promise rejection', reason);
    logger.debug(`[DAEMON RUN] Rejected promise:`, promise);
    const error = reason instanceof Error ? reason : new Error(`Unhandled promise rejection: ${reason}`);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    requestShutdown('exception', error.message);
  });

  process.on('exit', (code) => {
    logger.debug(`[DAEMON RUN] Process exiting with code: ${code}`);
  });

  process.on('beforeExit', (code) => {
    logger.debug(`[DAEMON RUN] Process about to exit with code: ${code}`);
  });

  logger.debug('[DAEMON RUN] Starting daemon process...');
  logger.debugLargeJson('[DAEMON RUN] Environment', getEnvironmentInfo());

  // Check if already running
  // Check if running daemon version matches current CLI version
  const runningDaemonVersionMatches = await isDaemonRunningCurrentlyInstalledHappyVersion();
  const handoffSessions = runningDaemonVersionMatches ? [] : await listDaemonSessions();
  if (!runningDaemonVersionMatches) {
    // Keep version handoff inside the detached daemon lifecycle. A host service
    // manager must not own this process tree because stopping that service can
    // terminate the Claude/Codex provider sessions the daemon only tracks.
    logger.debug('[DAEMON RUN] Daemon version mismatch detected, restarting daemon with current CLI version');
    await stopDaemon();
  } else {
    logger.debug('[DAEMON RUN] Daemon version matches, keeping existing daemon');
    console.log('Daemon already running with matching version');
    process.exit(0);
  }

  // Acquire exclusive lock (proves daemon is running)
  const daemonLockHandle = await acquireDaemonLock(5, 200);
  if (!daemonLockHandle) {
    logger.warn('[DAEMON RUN] Failed to acquire daemon lock; daemon startup did not complete');
    process.exit(1);
  }

  // At this point we should be safe to startup the daemon:
  // 1. Not have a stale daemon state
  // 2. Should not have another daemon process running

  try {
    // Happy Agent is a machine-level service shared by the mobile app and
    // Happy Terminal. Start it concurrently and keep this daemon boot path
    // independent from its install/download/network state.
    startHappyTerminalDaemon();

    // Start caffeinate
    const caffeinateStarted = startCaffeinate();
    if (caffeinateStarted) {
      logger.debug('[DAEMON RUN] Sleep prevention enabled');
    }

    // Ensure auth and machine registration BEFORE anything else
    const { credentials, machineId } = await authAndSetupMachineIfNeeded();
    const api = await ApiClient.create(credentials);
    logger.debug('[DAEMON RUN] Auth and machine setup complete');

    // Setup state - key by PID
    const pidToTrackedSession = new Map<number, AutomationTrackedSession>();

    // Reconnect material is durable, but live process registration is not.
    // A session owns its own lifetime and re-registers with each daemon instance.
    const sessionIdToFinishedSession = new Map<string, AutomationTrackedSession>();
    const persisted = readPersistedSessions();
    const persistedSession = (sessionId: string): AutomationTrackedSession | undefined => {
      const saved = persisted[sessionId];
      if (!saved) return undefined;
      return trackedSessionWithAutomationProvenance({
        startedBy: 'persisted reconnect material',
        happySessionId: sessionId,
        happySessionMetadataFromLocalWebhook: saved.metadata,
        encryption: {
          encryptionKey: decodeBase64(saved.encryptionKey),
          encryptionVariant: saved.encryptionVariant,
          seq: saved.seq,
          metadataVersion: saved.metadataVersion,
          agentStateVersion: saved.agentStateVersion,
        },
        pid: 0,
      }, saved.metadata);
    };
    for (const session of handoffSessions) {
      if (hasProviderProcessExited(session.pid)) continue;
      const reconnect = persistedSession(session.happySessionId);
      pidToTrackedSession.set(session.pid, trackedSessionWithAutomationProvenance({
        ...reconnect,
        startedBy: session.startedBy,
        happySessionId: session.happySessionId,
        pid: session.pid,
      }, reconnect?.happySessionMetadataFromLocalWebhook));
    }
    if (handoffSessions.length > 0) {
      logger.debug(`[DAEMON RUN] Rebuilt the in-memory index for ${pidToTrackedSession.size} live sessions during handoff`);
    }

    const sessionProcessLifecycle = new SessionProcessLifecycle({
      trackedSessions: pidToTrackedSession,
      finishedSessions: sessionIdToFinishedSession,
      deactivateSession: (sessionId) => api.deactivateSession(sessionId),
      log: (message) => logger.debug(`[DAEMON RUN] ${message}`),
    });
    let automations: HappyHerdAutomationService | null = null;
    let automationReconcileRunning = false;

    const onChildExited = async (pid: number): Promise<void> => {
      if (!hasProviderProcessExited(pid)) {
        logger.debug(`[DAEMON RUN] PID ${pid} has not been confirmed exited; keeping it active`);
        return;
      }
      const session = pidToTrackedSession.get(pid);
      if (!session) return;
      const exitedBeforeWebhook = !session.happySessionId;
      try {
        await finalizeExitedAutomationSession(session);
      } catch (error) {
        logger.warn(`[AUTOMATIONS] Failed to reconcile exited provider PID ${pid}; the run remains active`, error);
      } finally {
        await sessionProcessLifecycle.recordExit(pid);
      }
      if (exitedBeforeWebhook) {
        const resolveEarlyExit = pidToPreWebhookExitAwaiter.get(pid);
        pidToPreWebhookExitAwaiter.delete(pid);
        resolveEarlyExit?.();
      }
    };

    // Session spawning awaiter system
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();
    const pidToPreWebhookExitAwaiter = new Map<number, () => void>();

    // Helper functions
    const getCurrentChildren = () => Array.from(pidToTrackedSession.values());

    // Handle webhook from happy session reporting itself
    const onHappySessionWebhook = (sessionId: string, sessionMetadata: Metadata, encryption?: SessionEncryptionData) => {
      logger.debugLargeJson(`[DAEMON RUN] Session reported`, sessionMetadata);

      const pid = sessionMetadata.hostPid;
      if (!pid) {
        logger.debug(`[DAEMON RUN] Session webhook missing hostPid for sessionId: ${sessionId}`);
        return;
      }

      logger.debug(`[DAEMON RUN] Session webhook: ${sessionId}, PID: ${pid}, started by: ${sessionMetadata.startedBy || 'unknown'}, hasEncryption: ${!!encryption}`);
      logger.debug(`[DAEMON RUN] Current tracked sessions before webhook: ${Array.from(pidToTrackedSession.keys()).join(', ')}`);

      // Persist encryption data to disk so it survives daemon restarts
      if (encryption) {
        const savedSession: PersistedSession = {
          encryptionKey: encodeBase64(encryption.encryptionKey),
          encryptionVariant: encryption.encryptionVariant,
          seq: encryption.seq,
          metadataVersion: encryption.metadataVersion,
          agentStateVersion: encryption.agentStateVersion,
          metadata: sessionMetadata,
          savedAt: Date.now(),
        };
        persistSession(sessionId, savedSession);
        persisted[sessionId] = savedSession;
      }

      // Check if we already have this PID (daemon-spawned)
      const existingSession = pidToTrackedSession.get(pid);
      const hadPendingSpawnAwaiter = pidToAwaiter.has(pid);

      if (existingSession) {
        // Refresh either a daemon-spawned session or a session carried across
        // daemon handoff. The provider remains authoritative for its lifetime.
        existingSession.happySessionId = sessionId;
        existingSession.happySessionMetadataFromLocalWebhook = sessionMetadata;
        if (encryption) existingSession.encryption = encryption;
        existingSession.automationId ??= sessionMetadata.automationId;
        existingSession.automationRunId ??= sessionMetadata.automationRunId;
        logger.debug(`[DAEMON RUN] Updated daemon-spawned session ${sessionId} with metadata`);

        // Resolve any awaiter for this PID
        const awaiter = existingSession.startedBy === 'daemon' ? pidToAwaiter.get(pid) : undefined;
        if (awaiter) {
          pidToAwaiter.delete(pid);
          awaiter(existingSession);
          logger.debug(`[DAEMON RUN] Resolved session awaiter for PID ${pid}`);
        }
      } else if (!existingSession) {
        // New session started externally
        const trackedSession = trackedSessionWithAutomationProvenance({
          startedBy: 'happy directly - likely by user from terminal',
          happySessionId: sessionId,
          happySessionMetadataFromLocalWebhook: sessionMetadata,
          encryption,
          pid
        }, sessionMetadata);
        pidToTrackedSession.set(pid, trackedSession);
        logger.debug(`[DAEMON RUN] Registered externally-started session ${sessionId}`);
      }
      const registeredSession = pidToTrackedSession.get(pid);
      if (!hadPendingSpawnAwaiter
        && automations
        && registeredSession
        && automationWebhookMatchesTrackedSession(registeredSession, sessionMetadata)) {
        void automations.confirmRunStarted({
          automationId: registeredSession.automationId!,
          runId: registeredSession.automationRunId!,
          sessionId,
        }).then(() => reconcileAutomationRuns()).catch((error) => {
          logger.warn(`[AUTOMATIONS] Refused late session registration ${sessionId}`, error);
        });
      }
      setTimeout(() => {
        void reconcileAutomationRuns().catch((error) => {
          logger.warn('[AUTOMATIONS] Failed to reconcile after session registration', error);
        });
      }, 0).unref?.();
    };

    // Spawn a new session (sessionId reserved for future --resume functionality)
    const spawnSession = async (options: SpawnSessionOptions): Promise<SpawnSessionResult> => {
      logger.debugLargeJson('[DAEMON RUN] Spawning session', options.automation
        ? {
          ...options,
          automation: {
            id: options.automation.id,
            runId: options.automation.runId,
            kind: options.automation.kind,
            instructionLength: options.automation.instruction.length,
          },
        }
        : options);

      const contextBundle = await prepareCommanderContext(options.commanderId, options.directory);
      // Commander workspace is the picker's default, not authority to replace
      // the directory the user actually selected for this session. Keeping the
      // spawn cwd and the closest project guide on the same requested path
      // prevents a valid Commander identity from loading guidance for one
      // project while operating in another.
      const directory = options.directory;
      const { sessionId, machineId, approvedNewDirectoryCreation = true } = options;
      let directoryCreated = false;

      try {
        await fs.access(directory);
        logger.debug(`[DAEMON RUN] Directory exists: ${directory}`);
      } catch (error) {
        logger.debug(`[DAEMON RUN] Directory doesn't exist, creating: ${directory}`);

        // Check if directory creation is approved
        if (!approvedNewDirectoryCreation) {
          logger.debug(`[DAEMON RUN] Directory creation not approved for: ${directory}`);
          return {
            type: 'requestToApproveDirectoryCreation',
            directory
          };
        }

        try {
          await fs.mkdir(directory, { recursive: true });
          logger.debug(`[DAEMON RUN] Successfully created directory: ${directory}`);
          directoryCreated = true;
        } catch (mkdirError: any) {
          let errorMessage = `Unable to create directory at '${directory}'. `;

          // Provide more helpful error messages based on the error code
          if (mkdirError.code === 'EACCES') {
            errorMessage += `Permission denied. You don't have write access to create a folder at this location. Try using a different path or check your permissions.`;
          } else if (mkdirError.code === 'ENOTDIR') {
            errorMessage += `A file already exists at this path or in the parent path. Cannot create a directory here. Please choose a different location.`;
          } else if (mkdirError.code === 'ENOSPC') {
            errorMessage += `No space left on device. Your disk is full. Please free up some space and try again.`;
          } else if (mkdirError.code === 'EROFS') {
            errorMessage += `The file system is read-only. Cannot create directories here. Please choose a writable location.`;
          } else {
            errorMessage += `System error: ${mkdirError.message || mkdirError}. Please verify the path is valid and you have the necessary permissions.`;
          }

          logger.debug(`[DAEMON RUN] Directory creation failed: ${errorMessage}`);
          return {
            type: 'error',
            errorMessage
          };
        }
      }

      try {

        // Build environment variables for session spawning
        // Authentication tokens are resolved here

        // Resolve authentication token if provided
        const authEnv: Record<string, string> = {};
        if (options.token) {
          if (options.agent === 'codex') {

            // Create a temporary directory for Codex
            const codexHomeDir = tmp.dirSync();

            // Write the token to the temporary directory
            await fs.writeFile(join(codexHomeDir.name, 'auth.json'), options.token);

            // Set the environment variable for Codex
            authEnv.CODEX_HOME = codexHomeDir.name;
          } else if (options.agent !== 'grok') { // Existing non-Grok providers retain their current token behavior.
            authEnv.CLAUDE_CODE_OAUTH_TOKEN = options.token;
          }
        }

        const automationBootstrap = options.automation
          ? await prepareAutomationBootstrap({
            schemaVersion: 1,
            automationId: options.automation.id,
            runId: options.automation.runId,
            kind: options.automation.kind,
            instruction: options.automation.instruction,
          })
          : null;
        let extraEnv: Record<string, string> = {
          ...authEnv,
          ...contextEnvironment(contextBundle),
          ...sanitizeSessionEnvironment(options.environmentVariables ?? {}),
          ...happyHerdAgentSessionRuntimeEnvironment(options.agentRuntimeContext),
          ...(automationBootstrap ? automationBootstrapEnvironment(automationBootstrap) : {}),
          ...machineSessionSettingsEnvironment(options.effectiveSettings),
        };
        if (options.parentSessionId) {
          extraEnv.HAPPY_FORKED_FROM_SESSION_ID = options.parentSessionId;
        }
        if (options.forkedFromMessageId) {
          extraEnv.HAPPY_FORKED_FROM_MESSAGE_ID = options.forkedFromMessageId;
        }
        if (options.isSideChat) {
          extraEnv.HAPPY_SIDE_CHAT = '1';
        }
        // For fork: spawned Happy CLI needs to know which Claude JSONL to
        // backfill into the fresh Happy session row. Without this, the
        // SDK reads the JSONL silently as context but never re-emits the
        // historical messages, so the app shows an empty chat.
        if (options.resumeClaudeSessionId) {
          extraEnv.HAPPY_FORK_CLAUDE_SESSION_ID = options.resumeClaudeSessionId;
        }
        if (options.resumeCodexThreadId) {
          extraEnv.HAPPY_FORK_CODEX_THREAD_ID = options.resumeCodexThreadId;
        }
        logger.debug(`[DAEMON RUN] Environment variable keys (before expansion) (${Object.keys(extraEnv).length}): ${Object.keys(extraEnv).join(', ')}`);

        // Expand ${VAR} references from the sanitized daemon environment.
        // This ensures variable substitution works in both tmux and non-tmux modes
        // Example: ANTHROPIC_AUTH_TOKEN="${Z_AI_AUTH_TOKEN}" → ANTHROPIC_AUTH_TOKEN="sk-real-key"
        extraEnv = expandEnvironmentVariables(extraEnv, ambientEnvironment);
        logger.debug(`[DAEMON RUN] After variable expansion: ${Object.keys(extraEnv).join(', ')}`);

        // Fail fast if any passed-through environment variable still contains an
        // unresolved ${VAR} reference after expansion.
        const unresolvedEnvEntries = Object.entries(extraEnv).flatMap(([key, value]) => {
          if (typeof value !== 'string' || !value.includes('${')) {
            return [];
          }

          const unresolvedMatch = value.match(/\$\{([^}]+)\}/);
          if (!unresolvedMatch) {
            return [];
          }

          const expression = unresolvedMatch[1];
          const defaultSeparatorIndex = expression.indexOf(':-');
          const missingVar = defaultSeparatorIndex === -1
            ? expression
            : expression.slice(0, defaultSeparatorIndex);

          return [`${key} references \${${missingVar}} which is not defined`];
        });

        if (unresolvedEnvEntries.length > 0) {
          const errorMessage = `Session environment is invalid - environment variables not found in daemon: ${unresolvedEnvEntries.join('; ')}. ` +
            `Ensure these variables are set in the daemon's environment before starting sessions.`;
          logger.warn(`[DAEMON RUN] ${errorMessage}`);
          return {
            type: 'error',
            errorMessage
          };
        }

        // Check if tmux is available and should be used
        const tmuxAvailable = await isTmuxAvailable();
        // Automation providers are independent one-shot processes observed by
        // the daemon. Keeping them out of tmux gives the automation reconciler
        // an exact PID and authoritative OS exit evidence.
        let useTmux = options.automation ? false : tmuxAvailable;

        // Get tmux session name from environment variables (now set by profile system)
        // Empty string means "use current/most recent session" (tmux default behavior)
        let tmuxSessionName: string | undefined = extraEnv.TMUX_SESSION_NAME;

        // If tmux is not available or session name is explicitly undefined, fall back to regular spawning
        // Note: Empty string is valid (means use current/most recent tmux session)
        if (!tmuxAvailable || tmuxSessionName === undefined) {
          useTmux = false;
          if (tmuxSessionName !== undefined) {
            logger.debug(`[DAEMON RUN] tmux session name specified but tmux not available, falling back to regular spawning`);
          }
        }

        if (useTmux && tmuxSessionName !== undefined) {
          // Try to spawn in tmux session
          const sessionDesc = tmuxSessionName || 'current/most recent session';
          logger.debug(`[DAEMON RUN] Attempting to spawn session in tmux: ${sessionDesc}`);

          const tmux = getTmuxUtilities(tmuxSessionName);

          // Construct command for the CLI
          const cliPath = join(projectPath(), 'dist', 'index.mjs');
          const agent = resolveDaemonAgentCommand(options.agent);
          if (!agent) {
            return {
              type: 'error',
              errorMessage: `Unsupported agent type: '${options.agent}'. Please update your CLI to the latest version.`,
            };
          }
          const resumeId = agent === 'claude'
            ? options.resumeClaudeSessionId
            : (agent === 'codex' ? options.resumeCodexThreadId : undefined);
          const resumeFragment = resumeId
            ? ` --resume ${shellescape(resumeId)}`
            : '';
          const launchArgs = [
            agent,
            '--happy-starting-mode', 'remote',
            '--started-by', 'daemon',
          ];
          appendDaemonSpawnModeArgs(launchArgs, options, agent);
          const modeFragment = launchArgs.map(shellescape).join(' ');
          const fullCommand = `node --no-warnings --no-deprecation ${shellescape(cliPath)} ${modeFragment}${resumeFragment}`;
          const sanitizedTmuxCommand = wrapTmuxCommandWithSessionEnvironmentSanitizer(fullCommand, extraEnv);

          // Spawn in tmux with environment variables.
          // IMPORTANT: Pass the complete safe environment (ambient + extraEnv) because:
          // 1. tmux sessions need daemon's expanded auth variables (e.g., ANTHROPIC_AUTH_TOKEN)
          // 2. regular spawning uses the same clean environment
          // 3. tmux needs explicit -e values, and the command unsets omitted
          //    session variables that could otherwise survive in its server environment
          const windowName = `happy-${Date.now()}-${agent}`;
          const tmuxEnv: Record<string, string> = {};

          // Add all safe daemon environment variables (filtering out undefined)
          for (const [key, value] of Object.entries(buildSessionChildEnvironment(ambientEnvironment, extraEnv))) {
            if (value !== undefined) {
              tmuxEnv[key] = value;
            }
          }

          const tmuxResult = await tmux.spawnInTmux([sanitizedTmuxCommand], {
            sessionName: tmuxSessionName,
            windowName: windowName,
            cwd: directory
          }, tmuxEnv);  // Pass complete environment for tmux session

          if (tmuxResult.success) {
            logger.debug(`[DAEMON RUN] Successfully spawned in tmux session: ${tmuxResult.sessionId}, PID: ${tmuxResult.pid}`);

            // Validate we got a PID from tmux
            if (!tmuxResult.pid) {
              throw new Error('Tmux window created but no PID returned');
            }

            // Create a tracked session for tmux windows - now we have the real PID!
            const trackedSession: AutomationTrackedSession = {
              startedBy: 'daemon',
              automationId: options.automation?.id,
              automationRunId: options.automation?.runId,
              pid: tmuxResult.pid, // Real PID from tmux -P flag
              tmuxSessionId: tmuxResult.sessionId,
              directoryCreated,
              message: directoryCreated
                ? `The path '${directory}' did not exist. We created a new folder and spawned a new session in tmux session '${tmuxSessionName}'. Use 'tmux attach -t ${tmuxSessionName}' to view the session.`
                : `Spawned new session in tmux session '${tmuxSessionName}'. Use 'tmux attach -t ${tmuxSessionName}' to view the session.`
            };

            // Add to tracking map so webhook can find it later
            pidToTrackedSession.set(tmuxResult.pid, trackedSession);

            // Wait for webhook to populate session with happySessionId (exact same as regular flow)
            logger.debug(`[DAEMON RUN] Waiting for session webhook for PID ${tmuxResult.pid} (tmux)`);

            return new Promise((resolve) => {
              // Set timeout for webhook (same as regular flow)
              const timeout = setTimeout(() => {
                pidToAwaiter.delete(tmuxResult.pid!);
                logger.debug(`[DAEMON RUN] Session webhook timeout for PID ${tmuxResult.pid} (tmux)`);
                resolve({
                  type: 'error',
                  errorMessage: `Session webhook timeout for PID ${tmuxResult.pid} (tmux)`
                });
              }, 15_000); // Same timeout as regular sessions

              // Register awaiter for tmux session (exact same as regular flow)
              pidToAwaiter.set(tmuxResult.pid!, (completedSession) => {
                clearTimeout(timeout);
                logger.debug(`[DAEMON RUN] Session ${completedSession.happySessionId} fully spawned with webhook (tmux)`);
                if (!persistedMachineSessionSettingsMatch(
                  completedSession.happySessionMetadataFromLocalWebhook,
                  options.effectiveSettings,
                )) {
                  resolve({
                    type: 'error',
                    errorMessage: `Session ${completedSession.happySessionId} did not persist the target daemon's effective settings`,
                  });
                  return;
                }
                resolve({
                  type: 'success',
                  sessionId: completedSession.happySessionId!,
                  ...(options.effectiveSettings ? { settings: options.effectiveSettings } : {}),
                });
              });
            });
          } else {
            logger.debug(`[DAEMON RUN] Failed to spawn in tmux: ${tmuxResult.error}, falling back to regular spawning`);
            useTmux = false;
          }
        }

        // Regular process spawning (fallback or if tmux not available)
        if (!useTmux) {
          logger.debug(`[DAEMON RUN] Using regular process spawning`);

          // Construct arguments for the CLI - support claude, codex, and gemini
          const agentCommand = resolveDaemonAgentCommand(options.agent);
          if (!agentCommand) {
            return {
              type: 'error',
              errorMessage: `Unsupported agent type: '${options.agent}'. Please update your CLI to the latest version.`,
            };
          }
          const args = [
            agentCommand,
            '--happy-starting-mode', 'remote',
            '--started-by', 'daemon'
          ];
          appendDaemonSpawnModeArgs(args, options, agentCommand);

          // Resume ids attach the new Happy session to a pre-existing provider
          // conversation created by the fork / duplicate RPC.
          if (options.resumeClaudeSessionId && agentCommand === 'claude') {
            args.push('--resume', options.resumeClaudeSessionId);
          }
          if (options.resumeCodexThreadId && agentCommand === 'codex') {
            args.push('--resume', options.resumeCodexThreadId);
          }

          // TODO: In future, sessionId could be used with --resume to continue existing sessions
          // For now, we ignore it - each spawn creates a new session
          return spawnTrackedHappyProcess({
            args,
            cwd: directory,
            env: buildSessionChildEnvironment(ambientEnvironment, extraEnv),
            directoryCreated,
            message: directoryCreated ? `The path '${directory}' did not exist. We created a new folder and spawned a new session there.` : undefined,
            automation: options.automation
              ? { id: options.automation.id, runId: options.automation.runId }
              : undefined,
            settings: options.effectiveSettings,
          });
        }

        // This should never be reached, but TypeScript requires a return statement
        return {
          type: 'error',
          errorMessage: 'Unexpected error in session spawning'
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug('[DAEMON RUN] Failed to spawn session:', error);
        return {
          type: 'error',
          errorMessage: `Failed to spawn session: ${errorMessage}`
        };
      }
    };

    const spawnTrackedHappyProcess = ({
      args,
      cwd,
      env,
      directoryCreated = false,
      message,
      automation,
      settings,
    }: {
      args: string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
      directoryCreated?: boolean;
      message?: string;
      automation?: { id: string; runId: string };
      settings?: HappyHerdMachineSessionSettings;
    }): Promise<SpawnSessionResult> => {
      const happyProcess = spawnHappyCLI(args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        env,
      });

      if (!happyProcess.pid) {
        logger.debug('[DAEMON RUN] Failed to spawn process - no PID returned');
        return Promise.resolve({
          type: 'error',
          errorMessage: 'Failed to spawn Happy process - no PID returned',
          retrySafe: true,
        });
      }

      logger.debug(`[DAEMON RUN] Spawned process with PID ${happyProcess.pid}`);

      const trackedSession: AutomationTrackedSession = {
        startedBy: 'daemon',
        automationId: automation?.id,
        automationRunId: automation?.runId,
        pid: happyProcess.pid,
        childProcess: happyProcess,
        directoryCreated,
        message,
      };

      pidToTrackedSession.set(happyProcess.pid, trackedSession);

      happyProcess.on('exit', (code, signal) => {
        logger.debug(`[DAEMON RUN] Child PID ${happyProcess.pid} exited with code ${code}, signal ${signal}`);
        if (happyProcess.pid) {
          void onChildExited(happyProcess.pid);
        }
      });

      happyProcess.on('error', (error) => {
        logger.debug(`[DAEMON RUN] Child process error:`, error);
        if (happyProcess.pid && hasProviderProcessExited(happyProcess.pid)) {
          void onChildExited(happyProcess.pid);
        } else if (happyProcess.pid) {
          logger.debug(`[DAEMON RUN] Child PID ${happyProcess.pid} still exists after process error; keeping session active`);
        }
      });

      logger.debug(`[DAEMON RUN] Waiting for session webhook for PID ${happyProcess.pid}`);

      return new Promise((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          pidToAwaiter.delete(happyProcess.pid!);
          pidToPreWebhookExitAwaiter.delete(happyProcess.pid!);
          logger.debug(`[DAEMON RUN] Session webhook timeout for PID ${happyProcess.pid}`);
          resolve({
            type: 'error',
            errorMessage: `Session webhook timeout for PID ${happyProcess.pid}`
          });
        }, 15_000);

        if (automation) {
          pidToPreWebhookExitAwaiter.set(happyProcess.pid!, () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            pidToAwaiter.delete(happyProcess.pid!);
            resolve({
              type: 'error',
              errorMessage: `Provider PID ${happyProcess.pid} exited before registering a Happy session`,
            });
          });
        }

        pidToAwaiter.set(happyProcess.pid!, (completedSession) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          pidToPreWebhookExitAwaiter.delete(happyProcess.pid!);
          logger.debug(`[DAEMON RUN] Session ${completedSession.happySessionId} fully spawned with webhook`);
          if (!persistedMachineSessionSettingsMatch(
            completedSession.happySessionMetadataFromLocalWebhook,
            settings,
          )) {
            resolve({
              type: 'error',
              errorMessage: `Session ${completedSession.happySessionId} did not persist the target daemon's effective settings`,
            });
            return;
          }
          resolve({
            type: 'success',
            sessionId: completedSession.happySessionId!,
            ...(settings ? { settings } : {}),
          });
          if (automation) {
            setTimeout(() => {
              void reconcileAutomationRuns().catch((error) => {
                logger.warn('[AUTOMATIONS] Failed to reconcile new automation run', error);
              });
            }, 0).unref?.();
          }
        });
      });
    };

    const findTrackedSessionById = (happySessionId: string): TrackedSession | undefined => {
      for (const session of pidToTrackedSession.values()) {
        if (session.happySessionId === happySessionId) return session;
      }
      return sessionIdToFinishedSession.get(happySessionId) ?? persistedSession(happySessionId);
    };

    const fetchServerSessionMetadata = async (sessionId: string, encryptionKey: Uint8Array, encryptionVariant: 'legacy' | 'dataKey'): Promise<Metadata | null> => {
      try {
        const [matched] = await loadSessionRecords(credentials.token, {
          exactId: sessionId,
          timeout: 10_000,
        });
        if (!matched) return null;
        const decrypted = decrypt(encryptionKey, encryptionVariant, decodeBase64(matched.metadata));
        return decrypted as Metadata | null;
      } catch (error) {
        logger.debug(`[DAEMON RUN] Failed to fetch session metadata from server: ${error instanceof Error ? error.message : error}`);
        return null;
      }
    };

    async function finalizeExitedAutomationSession(session: AutomationTrackedSession): Promise<void> {
      if (!automations || !session.automationId || !session.automationRunId) return;
      if (!session.happySessionId) {
        await automations.confirmRunDidNotStart({
          automationId: session.automationId,
          runId: session.automationRunId,
          message: `Provider PID ${session.pid} exited before registering a Happy session.`,
        });
        return;
      }
      const run = (await automations.listActiveRuns()).find((candidate) => (
        candidate.automationId === session.automationId
        && candidate.id === session.automationRunId
        && candidate.sessionId === session.happySessionId
      ));
      if (!run) return;
      if (!hasProviderProcessExited(session.pid)) return;

      const localMetadata = session.happySessionMetadataFromLocalWebhook;
      if (!automationSessionMatchesRun(run, session, localMetadata)) {
        logger.warn(`[AUTOMATIONS] Refusing to close run ${run.id}: tracked session provenance does not match`);
        return;
      }

      if (!session.encryption) {
        await automations.confirmRunTermination({
          automationId: run.automationId,
          runId: run.id,
          sessionId: run.sessionId!,
          status: 'failed',
          message: 'Provider exited without the encryption metadata required to read its one-shot outcome.',
        });
        return;
      }
      const freshMetadata = await fetchServerSessionMetadata(
        session.happySessionId,
        session.encryption.encryptionKey,
        session.encryption.encryptionVariant,
      );
      if (!freshMetadata) {
        logger.warn(`[AUTOMATIONS] Run ${run.id} exited while its server metadata was unavailable; keeping it active for retry`);
        return;
      }
      const outcome = resolveExitedAutomationProviderOutcome(run, session, freshMetadata);
      session.happySessionMetadataFromLocalWebhook = freshMetadata;
      await automations.confirmRunTermination({
        automationId: run.automationId,
        runId: run.id,
        sessionId: run.sessionId!,
        status: outcome.status,
        message: outcome.message,
      });
    }

    const findExactTrackedAutomationSession = (
      run: HappyHerdAutomationRun,
    ): AutomationTrackedSession | undefined => [...pidToTrackedSession.values()]
      .find((session) => automationSessionMatchesRun(run, session));

    async function reconcileAutomationRuns(): Promise<void> {
      if (!automations || automationReconcileRunning) return;
      automationReconcileRunning = true;
      try {
        const activeRuns = await automations.listActiveRuns();

        for (const run of activeRuns) {
          if (run.status !== 'started' || !run.sessionId) continue;
          let session = findExactTrackedAutomationSession(run);
          if (!session) {
            const reconnect = persistedSession(run.sessionId);
            const metadata = reconnect?.happySessionMetadataFromLocalWebhook;
            const pid = metadata?.hostPid;
            if (reconnect && pid && pid > 0) {
              const candidate = trackedSessionWithAutomationProvenance({ ...reconnect, pid }, metadata);
              const occupied = pidToTrackedSession.get(pid);
              if ((!occupied || occupied.happySessionId === run.sessionId)
                && automationSessionMatchesRun(run, candidate, metadata)) {
                if (hasProviderProcessExited(pid)) {
                  // Persisted metadata is sufficient to reconcile a process
                  // already proven gone. A live process re-registers with this
                  // daemon (or arrives through handoff) before normal exit
                  // reconciliation can use it.
                  session = candidate;
                }
              }
            }
          }
          if (!session) continue;
          if (hasProviderProcessExited(session.pid)) {
            await finalizeExitedAutomationSession(session);
          }
        }
      } finally {
        automationReconcileRunning = false;
      }
    }

    const resumeSession = async (happySessionId: string, options?: {
      model?: string;
      permissionMode?: string;
      agentRuntimeContext?: unknown;
      replayQueueMessageId?: string;
    }): Promise<SpawnSessionResult> => {
      try {
        const liveSession = [...pidToTrackedSession.values()].find((session) => session.happySessionId === happySessionId);
        if (liveSession) {
          return { type: 'error', errorMessage: `Session ${happySessionId} is already running with PID ${liveSession.pid}.` };
        }
        let resolvedSessionId = happySessionId;
        let tracked = findTrackedSessionById(happySessionId);
        if (!tracked) {
          const recovered = await backfillReconnectableSessionForMachine(happySessionId, machineId);
          resolvedSessionId = recovered.session.id;
          persisted[resolvedSessionId] = recovered.persisted;
          tracked = persistedSession(resolvedSessionId);
          if (!tracked) {
            throw new Error(`Recovered Happy session ${resolvedSessionId} could not be indexed.`);
          }
        }
        if (!tracked.happySessionMetadataFromLocalWebhook) {
          return { type: 'error', errorMessage: `Session ${resolvedSessionId} has no metadata. Cannot resume.` };
        }
        if (!tracked.encryption) {
          return { type: 'error', errorMessage: `Session ${resolvedSessionId} has no stored encryption data. Cannot resume.` };
        }
        // Webhook metadata may be stale (missing claudeSessionId/codexThreadId set after startup).
        // Fetch fresh metadata from server if needed.
        let metadata = tracked.happySessionMetadataFromLocalWebhook;
        const needsFetch = (!metadata.claudeSessionId && (!metadata.flavor || metadata.flavor === 'claude'))
          || (!metadata.codexThreadId && metadata.flavor === 'codex')
          || (!metadata.acpSessionId && metadata.flavor === 'grok');
        if (needsFetch) {
          logger.debug(`[DAEMON RUN] Session ${resolvedSessionId} missing agent session ID in webhook metadata, fetching from server`);
          const serverMetadata = await fetchServerSessionMetadata(resolvedSessionId, tracked.encryption.encryptionKey, tracked.encryption.encryptionVariant);
          if (serverMetadata) {
            metadata = serverMetadata;
            tracked.happySessionMetadataFromLocalWebhook = serverMetadata;
          }
        }

        const launch = buildResumeLaunch(
          { id: resolvedSessionId, active: true, metadata },
          { startedBy: 'daemon', claudeStartingMode: 'remote' },
        );

        const resumeAgent = resolveDaemonResumeAgent(metadata);
        if (!resumeAgent) {
          throw new Error(`Session ${resolvedSessionId} uses unsupported flavor "${metadata.flavor ?? 'unknown'}".`);
        }
        const codexHome = resumeAgent === 'codex'
          ? await resolveCodexHomeForResume(metadata, ambientEnvironment)
          : undefined;
        appendDaemonSpawnModeArgs(launch.args, {
          directory: launch.cwd,
          agent: resumeAgent,
          modelMode: options?.model,
          permissionMode: options?.permissionMode,
        }, resumeAgent);

        await fs.access(launch.cwd);
        const resumedContextBundle = await prepareCommanderContext(metadata.commanderId, launch.cwd);
        const agentRuntimeEnvironment = happyHerdAgentSessionRuntimeEnvironment(options?.agentRuntimeContext);

        return spawnTrackedHappyProcess({
          args: launch.args,
          cwd: launch.cwd,
          env: buildSessionChildEnvironment(ambientEnvironment, {
            ...contextEnvironment(resumedContextBundle),
            ...agentRuntimeEnvironment,
            ...(codexHome ? { CODEX_HOME: codexHome } : {}),
            HAPPY_RECONNECT_SESSION_ID: resolvedSessionId,
            HAPPY_RECONNECT_ENCRYPTION_KEY: encodeBase64(tracked.encryption.encryptionKey),
            HAPPY_RECONNECT_ENCRYPTION_VARIANT: tracked.encryption.encryptionVariant,
            HAPPY_RECONNECT_SEQ: String(tracked.encryption.seq),
            HAPPY_RECONNECT_METADATA_VERSION: String(tracked.encryption.metadataVersion),
            HAPPY_RECONNECT_AGENT_STATE_VERSION: String(tracked.encryption.agentStateVersion),
            ...(options?.replayQueueMessageId
              ? { HAPPY_RECONNECT_QUEUE_MESSAGE_ID: options.replayQueueMessageId }
              : {}),
          }),
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : (error && typeof error === 'object' ? JSON.stringify(error) : String(error));
        logger.debug(`[DAEMON RUN] Failed to resume session: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
        return {
          type: 'error',
          errorMessage: `Failed to resume session: ${errorMessage}`,
        };
      }
    };

    // Stop a session by sessionId or PID fallback
    const stopSession = (sessionId: string): boolean => {
      logger.debug(`[DAEMON RUN] Attempting to stop session ${sessionId}`);

      // Try to find by sessionId first
      for (const [pid, session] of pidToTrackedSession.entries()) {
        if (session.happySessionId === sessionId ||
          (sessionId.startsWith('PID-') && pid === parseInt(sessionId.replace('PID-', '')))) {

          if (session.startedBy === 'daemon' && session.childProcess) {
            // Signal the whole process group, not just the Happy CLI parent.
            // The harness runs its own backend as a grandchild — Codex spawns
            // `codex app-server` (codexAppServerClient.ts:647) and only kills it
            // from its own disconnect path, which a bare SIGTERM to the parent
            // never reaches. Killing the parent alone therefore left the agent
            // running, reparented and invisible. The daemon spawns with
            // `detached: true` (see spawnSession above), which makes the parent
            // a group leader, so the negative pid covers every descendant.
            let signalled = false;
            if (process.platform !== 'win32') {
              try {
                process.kill(-pid, 'SIGTERM');
                signalled = true;
                logger.debug(`[DAEMON RUN] Sent SIGTERM to process group of session ${sessionId}`);
              } catch (error) {
                logger.debug(`[DAEMON RUN] Group kill failed for session ${sessionId}, falling back:`, error);
              }
            }
            // Windows has no process groups to signal, and a group kill can
            // still fail if the child already exited or never led a group.
            // Either way the parent is worth killing on its own.
            if (!signalled) {
              try {
                session.childProcess.kill('SIGTERM');
                logger.debug(`[DAEMON RUN] Sent SIGTERM to daemon-spawned session ${sessionId}`);
              } catch (error) {
                logger.debug(`[DAEMON RUN] Failed to kill session ${sessionId}:`, error);
                if (hasProviderProcessExited(pid)) {
                  void onChildExited(pid);
                }
              }
            }
          } else {
            // For externally started sessions, try to kill by PID
            try {
              process.kill(pid, 'SIGTERM');
              logger.debug(`[DAEMON RUN] Sent SIGTERM to external session PID ${pid}`);
            } catch (error) {
              logger.debug(`[DAEMON RUN] Failed to kill external session PID ${pid}:`, error);
              if (hasProviderProcessExited(pid)) {
                void onChildExited(pid);
              }
            }
          }

          logger.debug(`[DAEMON RUN] Waiting for provider process ${sessionId} to exit before marking it inactive`);
          return true;
        }
      }

      logger.debug(`[DAEMON RUN] Session ${sessionId} not found`);
      return false;
    };

    const loadHeartbeatTarget = async (happySessionId: string) => {
      let tracked = findTrackedSessionById(happySessionId);
      if (!tracked) {
        const recovered = await backfillReconnectableSessionForMachine(happySessionId, machineId);
        persisted[recovered.session.id] = recovered.persisted;
        tracked = persistedSession(recovered.session.id);
      }
      if (!tracked?.happySessionMetadataFromLocalWebhook || !tracked.encryption) {
        throw new Error(`Session ${happySessionId} is missing resumable local metadata`);
      }
      const local: Session = {
        id: happySessionId,
        seq: tracked.encryption.seq,
        encryptionKey: tracked.encryption.encryptionKey,
        encryptionVariant: tracked.encryption.encryptionVariant,
        metadata: tracked.happySessionMetadataFromLocalWebhook,
        metadataVersion: tracked.encryption.metadataVersion,
        agentState: null,
        agentStateVersion: tracked.encryption.agentStateVersion,
      };
      const inspected = await api.inspectSessionForHeartbeat(local);
      const live = [...pidToTrackedSession.values()].find((candidate) => (
        candidate.happySessionId === happySessionId && !hasProviderProcessExited(candidate.pid)
      ));
      return { session: inspected.session, running: Boolean(live) };
    };

    automations = new HappyHerdAutomationService(machineId, spawnSession, {
      loadTarget: loadHeartbeatTarget,
      postMessage: (target, input) => api.postHeartbeatMessage(target, input),
      resumeTarget: resumeSession,
    });
    await automations.start();
    await reconcileAutomationRuns();

    let createLocalSideChat = async (_parentSessionId: string): Promise<{ sessionId: string }> => {
      throw new Error('HappyHerd daemon is still starting; retry side-chat creation.');
    };

    // Start control server
    const { port: controlPort, stop: stopControlServer } = await startDaemonControlServer({
      getChildren: getCurrentChildren,
      stopSession,
      spawnSession,
      createSideChat: (parentSessionId) => createLocalSideChat(parentSessionId),
      requestShutdown: () => requestShutdown('happy-cli'),
      onHappySessionWebhook,
      automations,
    });

    // Write initial daemon state (no lock needed for state file)
    const daemonInstanceId = randomUUID();
    const fileState: DaemonLocallyPersistedState = {
      pid: process.pid,
      httpPort: controlPort,
      startTime: new Date().toLocaleString(),
      startedWithCliVersion: configuration.currentCliVersion,
      instanceId: daemonInstanceId,
      daemonLogPath: logger.logFilePath
    };
    writeDaemonState(fileState);
    logger.debug('[DAEMON RUN] Daemon state written');

    // Capture the bundled CLI's mtime at startup so the heartbeat can detect
    // when npm replaces `dist/index.mjs` on disk (= the user ran `npm i -g happy`).
    // We previously compared disk `package.json.version` to our bundled version,
    // but that produced infinite restart loops (#1107) when the manifest version
    // diverged from the bundled version (e.g. `happy-coder@0.13.1` deprecation
    // stub bumped package.json without rebuilding dist). File mtime is a more
    // reliable signal: it only changes when the bundle is actually replaced.
    const bundlePath = join(projectPath(), 'dist', 'index.mjs');
    let initialBundleMtimeMs = 0;
    try {
      initialBundleMtimeMs = statSync(bundlePath).mtimeMs;
    } catch {
      // dist/index.mjs not present (e.g. dev mode via tsx) — skip upgrade detection.
      logger.debug(`[DAEMON RUN] Bundle at ${bundlePath} not found; self-restart on upgrade disabled`);
    }

    // Prepare initial daemon state
    const initialDaemonState: DaemonState = {
      status: 'offline',
      pid: process.pid,
      httpPort: controlPort,
      startedAt: Date.now()
    };

    // Get or create machine
    const machine = await api.getOrCreateMachine({
      machineId,
      metadata: initialMachineMetadata,
      daemonState: initialDaemonState
    });
    logger.debug(`[DAEMON RUN] Machine registered: ${machine.id}`);

    // Create realtime machine session
    const apiMachine = api.machineSyncClient(machine);

    // Set RPC handlers
    apiMachine.setRPCHandlers({
      spawnSession,
      resumeSession,
      stopSession,
      requestShutdown: () => requestShutdown('happy-app'),
      automations,
    });

    const inFlightLocalSideChats = new Map<string, Promise<{ sessionId: string }>>();
    createLocalSideChat = async (parentSessionId) => {
      let parent: { id: string; metadata: Metadata };
      try {
        const session = await resolveLocalReconnectableSession(parentSessionId);
        parent = { id: session.id, metadata: session.metadata };
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Side chats must be created on the parent session's owning machine: ${detail}`);
      }

      const existing = inFlightLocalSideChats.get(parent.id);
      if (existing) return existing;

      const creation = createChildSideChat(parent.id, {
        resolveSession: async () => parent,
        resolveMachine: async (requestedMachineId) => {
          if (requestedMachineId !== machineId) {
            throw new Error(
              `Side chats must be created on the parent session's owning machine (${requestedMachineId}).`,
            );
          }
          return { id: machineId, active: true };
        },
        machineRpc: async (_target, method, params) => {
          if (method === 'claude-fork-session') {
            return apiMachine.forkClaudeBackendSession(params.directory, params.claudeSessionId);
          }
          if (method === 'codex-fork-thread') {
            return apiMachine.forkCodexBackendThread(params.directory, params.codexThreadId);
          }
          throw new Error(`Unsupported local side-chat RPC: ${method}`);
        },
        createMachineSession: async ({ machine: _target, ...options }) => spawnSession(options),
      });
      inFlightLocalSideChats.set(parent.id, creation);
      try {
        return await creation;
      } finally {
        if (inFlightLocalSideChats.get(parent.id) === creation) {
          inFlightLocalSideChats.delete(parent.id);
        }
      }
    };

    // Connect to server
    apiMachine.connect();

    // Every 60 seconds:
    // 1. Prune stale sessions
    // 2. Check if daemon needs update
    // 3. If outdated, restart with latest version
    // 4. Write heartbeat
    const heartbeatIntervalMs = parseInt(process.env.HAPPY_DAEMON_HEARTBEAT_INTERVAL || '60000');
    let heartbeatRunning = false
    const restartOnStaleVersionAndHeartbeat = setInterval(async () => {
      if (heartbeatRunning) {
        return;
      }
      heartbeatRunning = true;

      if (process.env.DEBUG) {
        logger.debug(`[DAEMON RUN] Health check started at ${new Date().toLocaleString()}`);
      }

      // Prune stale sessions
      for (const [pid, _] of pidToTrackedSession.entries()) {
        if (hasProviderProcessExited(pid)) {
          // The operating system confirmed the process is gone: preserve
          // resume state and explicitly deactivate the session. Elapsed time
          // and inconclusive process probes never perform this transition.
          await onChildExited(pid);
        }
      }
      await sessionProcessLifecycle.retryPending();
      await reconcileAutomationRuns();

      // Check if daemon needs update by detecting whether `dist/index.mjs` was
      // replaced on disk since the daemon started (npm install rewrites the file).
      // Skip if we never captured an initial mtime (dev mode).
      let bundleReplaced = false;
      if (initialBundleMtimeMs > 0) {
        try {
          const currentMtimeMs = statSync(bundlePath).mtimeMs;
          bundleReplaced = currentMtimeMs !== initialBundleMtimeMs;
        } catch {
          // File temporarily missing (e.g. mid-install) — retry on next heartbeat.
        }
      }
      if (bundleReplaced) {
        // The daemon deliberately hands off to the upstream detached lifecycle.
        // Provider sessions are independent processes and remain alive while the
        // daemon changes version and reconnects to them.
        logger.debug('[DAEMON RUN] Daemon bundle replaced on disk, handing off to new daemon');

        clearInterval(restartOnStaleVersionAndHeartbeat);

        // Release the daemon lock BEFORE spawning the new daemon. Otherwise the spawned
        // `happy daemon start` reads our still-present daemon.state.json, sees
        // isDaemonRunningCurrentlyInstalledHappyVersion() === true, and exits —
        // leaving nothing running once we also exit.
        await automations.stop();
        apiMachine.shutdown();
        await stopControlServer();
        await cleanupDaemonState();
        await releaseDaemonLock(daemonLockHandle);
        await stopCaffeinate();

        try {
          spawnHappyCLI(['daemon', 'start'], {
            detached: true,
            stdio: 'ignore',
            env: ambientEnvironment,
          });
        } catch (error) {
          logger.debug('[DAEMON RUN] Failed to spawn new daemon, this is quite likely to happen during integration tests as we are cleaning out dist/ directory', error);
        }

        process.exit(0);
      }

      // Before overwriting the daemon state file, confirm this process still holds the active daemon role.
      // Race condition is possible, but thats okay for the time being :D
      const daemonState = await readDaemonState();
      if (daemonState && daemonState.pid !== process.pid) {
        logger.debug('[DAEMON RUN] Somehow a different daemon was started without killing us. We should kill ourselves.')
        requestShutdown('exception', 'A different daemon was started without killing us. We should kill ourselves.')
      }

      // Heartbeat
      try {
        const updatedState: DaemonLocallyPersistedState = {
          pid: process.pid,
          httpPort: controlPort,
          startTime: fileState.startTime,
          startedWithCliVersion: configuration.currentCliVersion,
          instanceId: daemonInstanceId,
          lastHeartbeat: new Date().toLocaleString(),
          daemonLogPath: fileState.daemonLogPath
        };
        writeDaemonState(updatedState);
        if (process.env.DEBUG) {
          logger.debug(`[DAEMON RUN] Health check completed at ${updatedState.lastHeartbeat}`);
        }
      } catch (error) {
        logger.debug('[DAEMON RUN] Failed to write heartbeat', error);
      }

      heartbeatRunning = false;
    }, heartbeatIntervalMs); // Every 60 seconds in production

    // Setup signal handlers
    const cleanupAndShutdown = async (source: 'happy-app' | 'happy-cli' | 'os-signal' | 'exception', errorMessage?: string) => {
      logger.debug(`[DAEMON RUN] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`);

      // Clear health check interval
      if (restartOnStaleVersionAndHeartbeat) {
        clearInterval(restartOnStaleVersionAndHeartbeat);
        logger.debug('[DAEMON RUN] Health check interval cleared');
      }

      // Update daemon state before shutting down
      await apiMachine.updateDaemonState((state: DaemonState | null) => ({
        ...state,
        status: 'shutting-down',
        shutdownRequestedAt: Date.now(),
        shutdownSource: source
      }));

      // Give time for metadata update to send
      await new Promise(resolve => setTimeout(resolve, 100));

      await automations.stop();
      apiMachine.shutdown();
      await stopControlServer();
      await cleanupDaemonState();
      await stopCaffeinate();
      await releaseDaemonLock(daemonLockHandle);

      logger.debug('[DAEMON RUN] Cleanup completed, exiting process');
      process.exit(0);
    };

    logger.debug('[DAEMON RUN] Daemon started successfully, waiting for shutdown request');

    // Wait for shutdown request
    const shutdownRequest = await resolvesWhenShutdownRequested;
    await cleanupAndShutdown(shutdownRequest.source, shutdownRequest.errorMessage);
  } catch (error) {
    logger.debug('[DAEMON RUN][FATAL] Failed somewhere unexpectedly - exiting with code 1', error);
    process.exit(1);
  }
}
