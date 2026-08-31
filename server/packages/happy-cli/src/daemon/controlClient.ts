/**
 * HTTP client helpers for daemon communication
 * Used by CLI commands to interact with running daemon
 */

import { logger } from '@/ui/logger';
import { clearDaemonState, readDaemonState } from '@/persistence';
import { Metadata } from '@/api/types';
import { configuration } from '@/configuration';
import { daemonInstanceKey, maintainDaemonSessionRegistration } from './sessionRegistration';
import type {
  SideChatDelegationBrief,
  SideChatLifecycleInput,
  SideChatLifecycleReceipt,
  SideChatLifecycleRequest,
} from '@/commands/sideChat';
import { normalizeSideChatLifecycleRequest } from '@/commands/sideChat';
import type { ProviderLimitNotice } from '@/credentialPool/providerLimitNotice';

async function daemonPost(path: string, body?: any, timeoutOverride?: number): Promise<{ error?: string } | any> {
  const state = await readDaemonState();
  if (!state?.httpPort) {
    const errorMessage = 'No daemon running, no state file found';
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage
    };
  }

  try {
    process.kill(state.pid, 0);
  } catch (error) {
    const errorMessage = 'Daemon is not running, file is stale';
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage
    };
  }

  try {
    const timeout = timeoutOverride
      ?? (process.env.HAPPY_DAEMON_HTTP_TIMEOUT ? parseInt(process.env.HAPPY_DAEMON_HTTP_TIMEOUT) : 10_000);
    const response = await fetch(`http://127.0.0.1:${state.httpPort}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      // Mostly increased for stress test
      signal: AbortSignal.timeout(timeout)
    });
    
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json() as { message?: unknown; error?: unknown };
        const message = typeof payload.message === 'string'
          ? payload.message
          : (typeof payload.error === 'string' ? payload.error : '');
        detail = message ? `: ${message}` : '';
      } catch {
        // A status code still gives the caller an actionable failure.
      }
      const errorMessage = `Request failed: ${path}, HTTP ${response.status}${detail}`;
      logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
      return {
        error: errorMessage
      };
    }
    
    return await response.json();
  } catch (error) {
    const errorMessage = `Request failed: ${path}, ${error instanceof Error ? error.message : 'Unknown error'}`;
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return {
      error: errorMessage
    }
  }
}

const SESSION_STARTED_RETRY_TIMEOUT_MS = 3000;
const SESSION_STARTED_RETRY_INTERVAL_MS = 100;
const sessionRegistrationWatchers = new Map<string, () => void>();

export async function notifyDaemonSessionStarted(
  sessionId: string,
  metadata: Metadata,
  encryption?: {
    encryptionKey: string;
    encryptionVariant: 'legacy' | 'dataKey';
    seq: number;
    metadataVersion: number;
    agentStateVersion: number;
  }
): Promise<{ error?: string } | any> {
  // Retry briefly — ensureDaemonRunning already waits for readiness, but we may
  // race a daemon that is mid-restart (version upgrade, crash recovery). Without
  // this, the session's encryption data never reaches the daemon and the mobile
  // app's resume-happy-session RPC fails with "not tracked by this daemon".
  const payload = { sessionId, metadata, encryption };
  const deadline = Date.now() + SESSION_STARTED_RETRY_TIMEOUT_MS;
  let result: { error?: string } | any;
  const installRegistrationWatcher = async (): Promise<void> => {
    const initialDaemonKey = result?.error ? null : daemonInstanceKey(await readDaemonState());
    sessionRegistrationWatchers.get(sessionId)?.();
    sessionRegistrationWatchers.set(sessionId, maintainDaemonSessionRegistration({
      initialDaemonKey,
      readState: readDaemonState,
      register: async () => !(await daemonPost('/session-started', payload))?.error,
    }));
  };

  while (true) {
    result = await daemonPost('/session-started', payload);
    if (!result?.error) {
      await installRegistrationWatcher();
      return result;
    }
    if (Date.now() >= deadline) {
      await installRegistrationWatcher();
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, SESSION_STARTED_RETRY_INTERVAL_MS));
  }
}

export interface DaemonSessionSummary {
  startedBy: string;
  happySessionId: string;
  pid: number;
}

export async function listDaemonSessions(): Promise<DaemonSessionSummary[]> {
  const result = await daemonPost('/list');
  return Array.isArray(result.children) ? result.children as DaemonSessionSummary[] : [];
}

export async function stopDaemonSession(sessionId: string): Promise<boolean> {
  const result = await daemonPost('/stop-session', { sessionId });
  return result.success || false;
}

export async function notifyDaemonProviderLimited(
  notice: ProviderLimitNotice,
): Promise<{ status?: 'scheduled'; error?: string }> {
  return daemonPost('/provider-limited', notice);
}

export async function spawnDaemonSession(directory: string, sessionId?: string): Promise<any> {
  const result = await daemonPost('/spawn-session', { directory, sessionId });
  return result;
}

const SIDE_CHAT_REQUEST_TIMEOUT_MS = 60_000;
const SIDE_CHAT_CREATE_TIMEOUT_MS = 4 * 60_000;
const SIDE_CHAT_CLOSE_ALL_TIMEOUT_MS = 5 * 60_000;

export function sideChatRequestTimeoutMs(action: SideChatLifecycleRequest['action']): number {
  // Create can include two bounded 30s Codex fork RPCs, a 15s spawn/webhook
  // wait, 60s encrypted brief persistence, and a 60s authoritative read-back.
  // Four minutes exceed that complete supported sequential ceiling.
  if (action === 'create') return SIDE_CHAT_CREATE_TIMEOUT_MS;
  // close-all is sequential by contract. Five bounded minutes cover the
  // supported four-child incident's complete 4 × 15s provider-exit SLA plus
  // deactivation, encrypted archive, and authoritative read-back overhead.
  return action === 'close-all' ? SIDE_CHAT_CLOSE_ALL_TIMEOUT_MS : SIDE_CHAT_REQUEST_TIMEOUT_MS;
}

export async function manageDaemonSideChat(
  input: SideChatLifecycleInput,
): Promise<SideChatLifecycleReceipt> {
  const request = normalizeSideChatLifecycleRequest(input);
  const result = await daemonPost(
    '/side-chat',
    request,
    sideChatRequestTimeoutMs(request.action),
  );
  if (result?.error) {
    throw new Error(result.error);
  }
  if (result?.schemaVersion !== 1 || typeof result?.type !== 'string') {
    throw new Error('Daemon returned an invalid side-chat lifecycle receipt');
  }
  if (request.action === 'create' && result.type === 'side-chat') {
    const phases = Array.isArray(result.phases) ? result.phases : [];
    const deliveryPhase = phases.find((candidate: unknown) => (
      candidate != null
      && typeof candidate === 'object'
      && (candidate as { phase?: unknown }).phase === 'deliver-brief'
    ));
    if (!deliveryPhase) {
      return {
        ...result,
        success: false,
        parentSessionId: typeof result.parentSessionId === 'string'
          ? result.parentSessionId
          : request.parentSessionId,
        sessionId: typeof result.sessionId === 'string' ? result.sessionId : null,
        child: result.child ?? null,
        phases: [
          ...phases,
          {
            phase: 'deliver-brief',
            status: 'failed',
            message: 'The running daemon did not acknowledge bounded brief delivery; restart it and inspect this child before retrying.',
          },
        ],
      } as SideChatLifecycleReceipt;
    }
  }
  return result as SideChatLifecycleReceipt;
}

export async function createDaemonSideChat(
  parentSessionId: string,
  brief: SideChatDelegationBrief,
): Promise<{ sessionId: string }> {
  const receipt = await manageDaemonSideChat({ action: 'create', parentSessionId, brief });
  if (receipt.type !== 'side-chat' || !receipt.success || !receipt.sessionId) {
    throw new Error('Daemon failed to create a side chat');
  }
  return { sessionId: receipt.sessionId };
}

export async function daemonAutomationAction(
  action: 'list' | 'create' | 'update' | 'pause' | 'resume' | 'delete' | 'run-now' | 'history' | 'stop-run' | 'abandon-run',
  options: { id?: string; runId?: string; input?: unknown } = {},
): Promise<any> {
  const result = await daemonPost('/automations', { action, ...options }, action === 'run-now' ? 25_000 : undefined);
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function stopDaemonHttp(): Promise<void> {
  await daemonPost('/stop');
}

/**
 * The version check is still quite naive.
 * For instance we are not handling the case where we upgraded happy,
 * the daemon is still running, and it recieves a new message to spawn a new session.
 * This is a tough case - we need to somehow figure out to restart ourselves,
 * yet still handle the original request.
 * 
 * Options:
 * 1. Periodically check during the health checks whether our version is the same as CLIs version. If not - restart.
 * 2. Wait for a command from the machine session, or any other signal to
 * check for version & restart.
 *   a. Handle the request first
 *   b. Let the request fail, restart and rely on the client retrying the request
 * 
 * I like option 1 a little better.
 * Maybe we can ... wait for it ... have another daemon to make sure 
 * our daemon is always alive and running the latest version.
 * 
 * That seems like an overkill and yet another process to manage - lets not do this :D
 * 
 * TODO: This function should return a state object with
 * clear state - if it is running / or errored out or something else.
 * Not just a boolean.
 * 
 * We can destructure the response on the caller for richer output.
 * For instance when running `happyherd daemon status` we can show more information.
 */
export async function checkIfDaemonRunningAndCleanupStaleState(): Promise<boolean> {
  const state = await readDaemonState();
  if (!state) {
    return false;
  }

  // Check if the PID is alive
  try {
    process.kill(state.pid, 0);
  } catch {
    logger.debug('[DAEMON RUN] Daemon PID not running, cleaning up state');
    await cleanupDaemonState();
    return false;
  }

  // PID is alive, but on Windows PIDs get reused after reboot.
  // Verify it's actually our daemon by HTTP pinging its control server.
  if (state.httpPort) {
    try {
      const response = await fetch(`http://127.0.0.1:${state.httpPort}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // HTTP check failed - the PID is not our daemon (likely reused by OS after reboot)
      logger.debug(`[DAEMON RUN] PID ${state.pid} is alive but HTTP health check failed on port ${state.httpPort}, cleaning up stale state`);
      await cleanupDaemonState();
      return false;
    }
  }

  return true;
}

/**
 * Check if the running daemon version matches the current CLI version.
 * This should work from both the daemon itself & a new CLI process.
 * Works via the daemon.state.json file.
 * 
 * @returns true if versions match, false if versions differ or no daemon running
 */
export async function isDaemonRunningCurrentlyInstalledHappyVersion(): Promise<boolean> {
  logger.debug('[DAEMON CONTROL] Checking if daemon is running same version');
  const runningDaemon = await checkIfDaemonRunningAndCleanupStaleState();
  if (!runningDaemon) {
    logger.debug('[DAEMON CONTROL] No daemon running, returning false');
    return false;
  }

  const state = await readDaemonState();
  if (!state) {
    logger.debug('[DAEMON CONTROL] No daemon state found, returning false');
    return false;
  }
  
  // Compare the running daemon's recorded version against THIS CLI invocation's
  // bundled version. Both are read from the same source of truth: the `version`
  // field baked into `dist/` at build time via `import packageJson from '../package.json'`.
  //
  // Previously we read `package.json` fresh from disk on every check, but that
  // produced infinite restart loops (#1107) when `package.json.version` diverged
  // from the bundled version — e.g. when `happy-coder@0.13.1` was published as
  // a deprecation stub that bumped the manifest without rebuilding `dist/`.
  // The daemon would write its bundled version (0.13.0), read 0.13.1 from disk,
  // detect a mismatch, self-restart, and the new daemon would repeat the cycle.
  //
  // Using `configuration.currentCliVersion` instead guarantees the writer and
  // reader agree whenever they're executing the same `dist/` bundle, and still
  // correctly detects real npm upgrades (the new bundle has a new baked version).
  const currentCliVersion = configuration.currentCliVersion;
  logger.debug(`[DAEMON CONTROL] Current CLI version: ${currentCliVersion}, Daemon started with version: ${state.startedWithCliVersion}`);
  return currentCliVersion === state.startedWithCliVersion;
}

export async function cleanupDaemonState(): Promise<void> {
  try {
    await clearDaemonState();
    logger.debug('[DAEMON RUN] Daemon state file removed');
  } catch (error) {
    logger.debug('[DAEMON RUN] Error cleaning up daemon metadata', error);
  }
}

export async function stopDaemon() {
  try {
    const state = await readDaemonState();
    if (!state) {
      logger.debug('No daemon state found');
      return;
    }

    logger.debug(`Stopping daemon with PID ${state.pid}`);

    // Try HTTP graceful stop
    try {
      await stopDaemonHttp();

      // Wait for daemon to die
      await waitForProcessDeath(state.pid, 2000);
      logger.debug('Daemon stopped gracefully via HTTP');
      return;
    } catch (error) {
      logger.debug('HTTP stop failed, will force kill', error);
    }

    // Force kill
    try {
      process.kill(state.pid, 'SIGKILL');
      logger.debug('Force killed daemon');
    } catch (error) {
      logger.debug('Daemon already dead');
    }
  } catch (error) {
    logger.debug('Error stopping daemon', error);
  }
}

async function waitForProcessDeath(pid: number, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      process.kill(pid, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch {
      return; // Process is dead
    }
  }
  throw new Error('Process did not die within timeout');
}
