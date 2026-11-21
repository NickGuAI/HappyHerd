/**
 * Minimal persistence functions for the HappyHerd CLI
 * 
 * Handles settings and private key storage in ~/.happyherd/ or local .happyherd/
 */

import { FileHandle } from 'node:fs/promises'
import { readFile, writeFile, mkdir, open, unlink, rename, stat } from 'node:fs/promises'
import { existsSync, writeFileSync, readFileSync, unlinkSync, renameSync, linkSync, statSync } from 'node:fs'
import { constants } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { configuration } from '@/configuration'
import * as z from 'zod';
import { encodeBase64, decodeBase64 } from '@/api/encryption';
import type { Metadata } from '@/api/types';
import { logger } from '@/ui/logger';
import { migrateCliSettings } from './legacyCompatibility';

export const SandboxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  workspaceRoot: z.string().optional(),
  sessionIsolation: z.enum(['strict', 'workspace', 'custom']).default('workspace'),
  customWritePaths: z.array(z.string()).default([]),
  denyReadPaths: z.array(z.string()).default(['~/.ssh', '~/.aws', '~/.gnupg']),
  extraWritePaths: z.array(z.string()).default(['/tmp']),
  denyWritePaths: z.array(z.string()).default(['.env']),
  networkMode: z.enum(['blocked', 'allowed', 'custom']).default('allowed'),
  allowedDomains: z.array(z.string()).default([]),
  deniedDomains: z.array(z.string()).default([]),
  allowLocalBinding: z.boolean().default(true),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

// Settings schema version: Integer for overall Settings structure compatibility
// Incremented when Settings structure changes (e.g., adding profiles array was v1→v2)
// Used for migration logic in readSettings()
export const SUPPORTED_SCHEMA_VERSION = 2;

interface Settings {
  schemaVersion: number
  onboardingCompleted: boolean
  machineId?: string
  machineIdConfirmedByServer?: boolean
  daemonAutoStartWhenRunningHappyHerd?: boolean
  chromeMode?: boolean
  sandboxConfig?: SandboxConfig
  serverUrl?: string
  webappUrl?: string
  assistantName?: string
  contextFolder?: { name: string; id?: string; account?: string }
}

const defaultSettings: Settings = {
  schemaVersion: SUPPORTED_SCHEMA_VERSION,
  onboardingCompleted: false,
  sandboxConfig: undefined,
}

/**
 * Migrate settings from old schema versions to current
 * Always backwards compatible - preserves all data
 */
function migrateSettings(raw: any, fromVersion: number): any {
  let migrated = migrateCliSettings(raw);

  // Future migrations go here:
  // if (fromVersion < 3) { ... }

  return migrated;
}

/**
 * Daemon state persisted locally (different from API DaemonState)
 * This is written to disk by the daemon to track its local process state
 */
export interface DaemonLocallyPersistedState {
  pid: number;
  httpPort: number;
  startTime: string;
  startedWithCliVersion: string;
  instanceId?: string;
  lastHeartbeat?: string;
  daemonLogPath?: string;
}

export async function readSettings(): Promise<Settings> {
  if (!existsSync(configuration.settingsFile)) {
    return { ...defaultSettings }
  }

  try {
    // Read raw settings
    const content = await readFile(configuration.settingsFile, 'utf8')
    const raw = JSON.parse(content)

    // Check schema version (default to 1 if missing)
    const schemaVersion = raw.schemaVersion ?? 1;

    // Warn if schema version is newer than supported
    if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
      logger.warn(
        `⚠️ Settings schema v${schemaVersion} > supported v${SUPPORTED_SCHEMA_VERSION}. ` +
        'Update @happyherd/cli for full functionality.'
      );
    }

    // Migrate if needed
    const migrated = migrateSettings(raw, schemaVersion);

    if (migrated.sandboxConfig !== undefined) {
      try {
        migrated.sandboxConfig = SandboxConfigSchema.parse(migrated.sandboxConfig);
      } catch (error: any) {
        logger.warn(`⚠️ Invalid sandbox config - skipping. Error: ${error.message}`);
        migrated.sandboxConfig = undefined;
      }
    }

    // Merge with defaults to ensure all required fields exist
    return { ...defaultSettings, ...migrated };
  } catch (error: any) {
    logger.warn(`Failed to read settings: ${error.message}`);
    // Return defaults on any error
    return { ...defaultSettings }
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  if (!existsSync(configuration.happyHomeDir)) {
    await mkdir(configuration.happyHomeDir, { recursive: true })
  }

  // Ensure schema version is set before writing
  const settingsWithVersion = {
    ...settings,
    schemaVersion: settings.schemaVersion ?? SUPPORTED_SCHEMA_VERSION
  };

  await writeFile(configuration.settingsFile, JSON.stringify(settingsWithVersion, null, 2))
}

/**
 * Atomically update settings with multi-process safety via file locking
 * @param updater Function that takes current settings and returns updated settings
 * @returns The updated settings
 */
export async function updateSettings(
  updater: (current: Settings) => Settings | Promise<Settings>
): Promise<Settings> {
  // Timing constants
  const LOCK_RETRY_INTERVAL_MS = 100;  // How long to wait between lock attempts
  const MAX_LOCK_ATTEMPTS = 50;        // Maximum number of attempts (5 seconds total)
  const STALE_LOCK_TIMEOUT_MS = 10000; // Consider lock stale after 10 seconds

  const lockFile = configuration.settingsFile + '.lock';
  const tmpFile = configuration.settingsFile + '.tmp';
  let fileHandle;
  let attempts = 0;

  // Acquire exclusive lock with retries
  while (attempts < MAX_LOCK_ATTEMPTS) {
    try {
      // O_CREAT | O_EXCL | O_WRONLY = create exclusively, fail if exists
      fileHandle = await open(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      break;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        // Lock file exists, wait and retry
        attempts++;
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS));

        // Check for stale lock
        try {
          const stats = await stat(lockFile);
          if (Date.now() - stats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
            await unlink(lockFile).catch(() => { });
          }
        } catch { }
      } else {
        throw err;
      }
    }
  }

  if (!fileHandle) {
    throw new Error(`Failed to acquire settings lock after ${MAX_LOCK_ATTEMPTS * LOCK_RETRY_INTERVAL_MS / 1000} seconds`);
  }

  try {
    // Read current settings with defaults
    const current = await readSettings() || { ...defaultSettings };

    // Apply update
    const updated = await updater(current);

    // Ensure directory exists
    if (!existsSync(configuration.happyHomeDir)) {
      await mkdir(configuration.happyHomeDir, { recursive: true });
    }

    // Write atomically using rename
    await writeFile(tmpFile, JSON.stringify(updated, null, 2));
    await rename(tmpFile, configuration.settingsFile); // Atomic on POSIX

    return updated;
  } finally {
    // Release lock
    await fileHandle.close();
    await unlink(lockFile).catch(() => { }); // Remove lock file
  }
}

//
// Authentication
//

const credentialsSchema = z.object({
  token: z.string(),
  secret: z.string().base64().nullish(), // Legacy
  encryption: z.object({
    publicKey: z.string().base64(),
    machineKey: z.string().base64()
  }).nullish()
})

export type Credentials = {
  token: string,
  encryption: {
    type: 'legacy', secret: Uint8Array
  } | {
    type: 'dataKey', publicKey: Uint8Array, machineKey: Uint8Array
  }
}

export async function readCredentials(): Promise<Credentials | null> {
  if (!existsSync(configuration.privateKeyFile)) {
    return null
  }
  try {
    const keyBase64 = (await readFile(configuration.privateKeyFile, 'utf8'));
    const credentials = credentialsSchema.parse(JSON.parse(keyBase64));
    if (credentials.secret) {
      return {
        token: credentials.token,
        encryption: {
          type: 'legacy',
          secret: new Uint8Array(Buffer.from(credentials.secret, 'base64'))
        }
      };
    } else if (credentials.encryption) {
      return {
        token: credentials.token,
        encryption: {
          type: 'dataKey',
          publicKey: new Uint8Array(Buffer.from(credentials.encryption.publicKey, 'base64')),
          machineKey: new Uint8Array(Buffer.from(credentials.encryption.machineKey, 'base64'))
        }
      }
    }
  } catch {
    return null
  }
  return null
}

export async function writeCredentialsLegacy(credentials: { secret: Uint8Array, token: string }): Promise<void> {
  if (!existsSync(configuration.happyHomeDir)) {
    await mkdir(configuration.happyHomeDir, { recursive: true })
  }
  await writeFile(configuration.privateKeyFile, JSON.stringify({
    secret: encodeBase64(credentials.secret),
    token: credentials.token
  }, null, 2));
}

export async function writeCredentialsDataKey(credentials: { publicKey: Uint8Array, machineKey: Uint8Array, token: string }): Promise<void> {
  if (!existsSync(configuration.happyHomeDir)) {
    await mkdir(configuration.happyHomeDir, { recursive: true })
  }
  await writeFile(configuration.privateKeyFile, JSON.stringify({
    encryption: { publicKey: encodeBase64(credentials.publicKey), machineKey: encodeBase64(credentials.machineKey) },
    token: credentials.token
  }, null, 2));
}

export async function clearCredentials(): Promise<void> {
  if (existsSync(configuration.privateKeyFile)) {
    await unlink(configuration.privateKeyFile);
  }
}

export async function clearMachineId(): Promise<void> {
  await updateSettings(settings => ({
    ...settings,
    machineId: undefined
  }));
}

/**
 * Read daemon state from local file
 */
export async function readDaemonState(): Promise<DaemonLocallyPersistedState | null> {
  try {
    if (!existsSync(configuration.daemonStateFile)) {
      return null;
    }
    const content = await readFile(configuration.daemonStateFile, 'utf-8');
    return JSON.parse(content) as DaemonLocallyPersistedState;
  } catch (error) {
    // State corrupted somehow :(
    console.error(`[PERSISTENCE] Daemon state file corrupted: ${configuration.daemonStateFile}`, error);
    return null;
  }
}

/**
 * Write daemon state to local file (synchronously for atomic operation)
 */
export function writeDaemonState(state: DaemonLocallyPersistedState): void {
  writeFileSync(configuration.daemonStateFile, JSON.stringify(state, null, 2), 'utf-8');
}

/** One daemon process run, as its state file records it. */
export type DaemonInstance = { pid: number; instanceId?: string };

function daemonStateRecords(owner: DaemonInstance): boolean {
  try {
    const state = JSON.parse(readFileSync(configuration.daemonStateFile, 'utf-8')) as Partial<DaemonLocallyPersistedState>;
    return state.pid === owner.pid && state.instanceId === owner.instanceId;
  } catch {
    return false;
  }
}

function daemonLockRecords(pid: number): boolean {
  try {
    return readFileSync(configuration.daemonLockFile, 'utf-8').trim() === String(pid);
  } catch {
    return false;
  }
}

/**
 * Clean up daemon state file and lock file. Given their owner, remove only the
 * files that still record it, so a daemon that stops after another daemon
 * started cannot delete that daemon's files.
 */
export async function clearDaemonState(owner?: DaemonInstance): Promise<void> {
  if (existsSync(configuration.daemonStateFile) && (!owner || daemonStateRecords(owner))) {
    await unlink(configuration.daemonStateFile);
  }
  // Also clean up lock file if it exists (for stale cleanup)
  if (existsSync(configuration.daemonLockFile) && (!owner || daemonLockRecords(owner.pid))) {
    try {
      await unlink(configuration.daemonLockFile);
    } catch {
      // Lock file might be held by running daemon, ignore error
    }
  }
}

/**
 * Acquire an exclusive lock file for the daemon.
 * The lock file proves the daemon is running and prevents multiple instances.
 * Returns the file handle to hold for the daemon's lifetime, or null if locked.
 */
export async function acquireDaemonLock(
  maxAttempts: number = 5,
  delayIncrementMs: number = 200
): Promise<FileHandle | null> {
  // Lock creation is atomic INCLUDING the PID payload: the PID is written to
  // a private temp file first and hard-linked into place (link fails with
  // EEXIST exactly like O_EXCL). A lock file therefore never exists in an
  // empty/partially-written state, so any lock without a live-PID payload is
  // unambiguously stale and can be reclaimed immediately.
  const tempPath = `${configuration.daemonLockFile}.${process.pid}.tmp`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      writeFileSync(tempPath, String(process.pid));
      linkSync(tempPath, configuration.daemonLockFile);
      unlinkSync(tempPath);
      // Hold an open handle for the daemon's lifetime (released by releaseDaemonLock)
      return await open(configuration.daemonLockFile, constants.O_RDONLY);
    } catch (error: any) {
      try {
        unlinkSync(tempPath);
      } catch { }

      if (error.code === 'EEXIST') {
        // Lock file exists, check if its owner is still running
        let lockIsStale = false;
        try {
          const lockPid = readFileSync(configuration.daemonLockFile, 'utf-8').trim();
          const lockPidNumber = Number(lockPid);
          if (!lockPid || !Number.isSafeInteger(lockPidNumber) || lockPidNumber <= 0) {
            lockIsStale = true;
          } else {
            try {
              process.kill(lockPidNumber, 0); // Check if process exists
            } catch {
              lockIsStale = true;
            }
          }
        } catch {
          // Can't read the lock file — corrupted leftovers, reclaim
          lockIsStale = true;
        }

        if (lockIsStale) {
          try {
            unlinkSync(configuration.daemonLockFile);
            continue; // Retry acquisition
          } catch { }
        }
      }

      if (attempt === maxAttempts) {
        return null;
      }
      const delayMs = attempt * delayIncrementMs;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

/**
 * Release daemon lock by closing handle and deleting lock file while it is
 * still this process's lock
 */
export async function releaseDaemonLock(lockHandle: FileHandle): Promise<void> {
  try {
    await lockHandle.close();
  } catch { }

  try {
    if (daemonLockRecords(process.pid)) {
      unlinkSync(configuration.daemonLockFile);
    }
  } catch { }
}

// ─── Session persistence (survives daemon restarts) ───

export type PersistedSession = {
  encryptionKey: string;
  encryptionVariant: 'legacy' | 'dataKey';
  seq: number;
  metadataVersion: number;
  agentStateVersion: number;
  metadata: Metadata;
  savedAt: number;
};

type SessionsFile = {
  sessions: Record<string, PersistedSession>;
};

// Registration requests share one save. Direct writers join the same pending
// updates, so a later authoritative save cannot be overwritten by a timer.
const pendingRegistrations = new Map<string, PersistedSession>();
let registrationWaiters: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
let registrationTimer: ReturnType<typeof setTimeout> | undefined;
let registrationSnapshot: { revision: string; sessions: Record<string, PersistedSession> } | undefined;

export function readPersistedSessions(options?: { throwOnError?: boolean }): Record<string, PersistedSession> {
  let sessions: Record<string, PersistedSession> = {};
  try {
    const data = JSON.parse(readFileSync(configuration.sessionsFile, 'utf-8')) as SessionsFile;
    if (data?.sessions && typeof data.sessions === 'object') sessions = data.sessions;
  } catch (error) {
    if (options?.throwOnError && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  // Resume and other direct writers must see registrations awaiting their save.
  return Object.assign(sessions, Object.fromEntries(pendingRegistrations));
}

function saveSessionUpdates(sessionId?: string, session?: PersistedSession): boolean {
  if (registrationTimer) clearTimeout(registrationTimer);
  registrationTimer = undefined;
  let failure: Error | undefined;
  try {
    // Re-read at commit time, rather than writing an old cached file snapshot.
    // There is no await between this read and rename, including for direct saves.
    const existing = readPersistedSessions();
    if (sessionId && session) existing[sessionId] = session;
    const tmpFile = configuration.sessionsFile + '.tmp';
    writeFileSync(tmpFile, JSON.stringify({ sessions: existing }, null, 2), 'utf-8');
    renameSync(tmpFile, configuration.sessionsFile);
  } catch (error) {
    logger.debug('[PERSISTENCE] Failed to persist session updates:', error);
    failure = new Error('Failed to persist session reconnect data');
  }
  registrationSnapshot = undefined;
  pendingRegistrations.clear();
  const waiters = registrationWaiters;
  registrationWaiters = [];
  for (const waiter of waiters) {
    if (failure) waiter.reject(failure);
    else waiter.resolve();
  }
  return !failure;
}

export function persistSession(sessionId: string, session: PersistedSession): boolean {
  return saveSessionUpdates(sessionId, session);
}

/** Coalesce local registrations, acknowledging them only after their save. */
export async function persistSessionRegistration(
  sessionId: string, session: PersistedSession, bootTimeMs: number,
): Promise<void> {
  let revision: string;
  try {
    const info = statSync(configuration.sessionsFile, { bigint: true });
    revision = `${configuration.sessionsFile}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    revision = `${configuration.sessionsFile}:missing`;
  }
  if (registrationSnapshot?.revision !== revision) {
    registrationSnapshot = { revision, sessions: readPersistedSessions() };
  }
  const pending = pendingRegistrations.get(sessionId);
  const previous = pending ?? registrationSnapshot.sessions[sessionId];
  // savedAt is process provenance relative to MACHINE boot, not daemon start.
  // Repeated registrations during that boot do not change resume conflicts.
  const unchanged = previous && previous.savedAt >= bootTimeMs
    && isDeepStrictEqual({ ...previous, savedAt: 0 }, { ...session, savedAt: 0 });
  if (unchanged && !pending) return;
  if (!unchanged) pendingRegistrations.set(sessionId, session);
  const saved = new Promise<void>((resolve, reject) => { registrationWaiters.push({ resolve, reject }); });
  // A fixed window (not a debounce) also flushes under a continuous stream.
  registrationTimer ??= setTimeout(() => saveSessionUpdates(), 25);
  return saved;
}
