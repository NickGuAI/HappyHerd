import type { DecryptedSession, SessionKillResult } from 'happyherd-control-agent/control';
import type { MachineControlClient } from './machine';
import type { SideChatCloseAllReceipt } from './sideChat';

type ArchiveClient = Pick<MachineControlClient,
  'resolveSession' | 'resolveMachine' | 'callMachineRpc' | 'killSession' | 'deactivateSession' | 'updateSessionMetadata'>;
type Dependencies = {
  createClient?: () => Promise<ArchiveClient>;
  output?: (value: string) => void;
  wait?: (ms: number) => Promise<void>;
};

// The daemon closes side chats one at a time within five minutes; like the
// app, wait a little longer than that for its receipt.
const CLOSE_ALL_TIMEOUT_MS = 5 * 60_000 + 30_000;
// A stopping session host marks the session archived just before it exits.
const READBACK_ATTEMPTS = 60;
const READBACK_INTERVAL_MS = 500;

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isArchived(session: DecryptedSession): boolean {
  return object(session.metadata)?.lifecycleState === 'archived';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function help(): string {
  return `happyherd session archive - Archive one session, as Archive does in the app

Usage:
  happyherd session archive SESSION_ID [--json]

Its side chats are closed first. A running session is then stopped by its own
session host, which marks it archived. A session that is not running is marked
inactive and archived through the server. The conversation and the session
record stay; resume it later with "happyherd resume SESSION_ID".
Archive uses account-level machine control authentication; run
"happyherd machine auth login".`;
}

async function controlCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (errorMessage(error).includes('happyherd-control-agent auth login')) {
      throw new Error('Account-level machine authentication expired. Run `happyherd machine auth login` and approve the one-time link in the HappyHerd app.');
    }
    throw error;
  }
}

async function accountClient(dependencies?: Dependencies): Promise<ArchiveClient> {
  if (dependencies?.createClient) return dependencies.createClient();
  // machine.ts routes this command, so load its default client after startup to
  // avoid a runtime import cycle while retaining the shared account client.
  const { createDefaultClient } = await import('./machine');
  return createDefaultClient();
}

// The app closes the owning daemon's complete set of direct side chats before
// it stops the parent, and keeps the parent when any child does not close.
async function closeSideChats(client: ArchiveClient, session: DecryptedSession): Promise<number> {
  const machineId = object(session.metadata)?.machineId;
  if (typeof machineId !== 'string' || machineId.length === 0) {
    throw new Error(`Session ${session.id} has no machine binding`);
  }
  const machine = await controlCall(() => client.resolveMachine(machineId));
  if (machine.id !== machineId) throw new Error(`Machine ${machineId} could not be refreshed exactly`);
  const receipt = await controlCall(() => client.callMachineRpc<SideChatCloseAllReceipt>(
    machine,
    'happyherd-side-chat-close-all',
    { parentSessionId: session.id },
    { responseTimeoutMs: CLOSE_ALL_TIMEOUT_MS },
  ));
  if (
    receipt?.type !== 'side-chat-close-all'
    || receipt.action !== 'close-all'
    || receipt.parentSessionId !== session.id
    || receipt.success !== true
    || receipt.failed !== 0
    || receipt.closed !== receipt.total
    || !Array.isArray(receipt.children)
    || receipt.total !== receipt.children.length
    || receipt.children.some((child) => child.success !== true)
  ) {
    const closed = typeof receipt?.closed === 'number' && typeof receipt?.total === 'number'
      ? ` (${receipt.closed} of ${receipt.total} closed)`
      : '';
    throw new Error(`Session ${session.id} was not archived because its side chats did not all close${closed}. It stays open; run the command again.`);
  }
  return receipt.closed;
}

async function stopThroughSessionHost(client: ArchiveClient, session: DecryptedSession): Promise<SessionKillResult> {
  try {
    return await controlCall(() => client.killSession(session));
  } catch (error) {
    return { success: false, message: errorMessage(error) };
  }
}

async function readBackAfterStop(
  client: ArchiveClient,
  sessionId: string,
  wait: (ms: number) => Promise<void>,
): Promise<DecryptedSession> {
  let current = await controlCall(() => client.resolveSession(sessionId));
  for (let attempt = 1; attempt < READBACK_ATTEMPTS && !(isArchived(current) && !current.active); attempt += 1) {
    await wait(READBACK_INTERVAL_MS);
    current = await controlCall(() => client.resolveSession(sessionId));
  }
  return current;
}

// The app's archive for a session whose host does not answer: deactivate it on
// the server, then save the archived marker in its encrypted metadata.
async function archiveThroughServer(client: ArchiveClient, sessionId: string): Promise<DecryptedSession> {
  await controlCall(() => client.deactivateSession(sessionId));
  const latest = await controlCall(() => client.resolveSession(sessionId));
  try {
    return await controlCall(() => client.updateSessionMetadata(latest, (metadata) => ({
      ...(object(metadata) ?? {}),
      lifecycleState: 'archived',
      lifecycleStateSince: Date.now(),
      archivedBy: 'cli',
      archiveReason: 'Archived from HappyHerd CLI',
    })));
  } catch (error) {
    // The server can save the update and lose its reply; read it back before
    // reporting a failure.
    const current = await controlCall(() => client.resolveSession(sessionId));
    if (isArchived(current)) return current;
    throw error;
  }
}

export async function handleSessionArchiveCommand(
  args: string[],
  dependencies?: Dependencies,
): Promise<void> {
  const output = dependencies?.output ?? console.log;
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    output(help());
    return;
  }
  const [selector, ...flagArgs] = args;
  if (!selector || selector.startsWith('-')) throw new Error('session-id is required');
  const unknown = flagArgs.find((flag) => flag !== '--json');
  if (unknown !== undefined) throw new Error(`Unknown option: ${unknown}`);
  if (flagArgs.length > 1) throw new Error('Option --json may only be specified once');

  const client = await controlCall(() => accountClient(dependencies));
  const session = await controlCall(() => client.resolveSession(selector));
  // The account lookup also accepts a unique ID prefix; archive only the exact ID.
  if (session.id !== selector) {
    throw new Error(`Session "${selector}" was not found in this account. Use the exact session ID.`);
  }
  const metadata = object(session.metadata);
  let sideChatsClosed = 0;
  let stopped: SessionKillResult;
  if (metadata?.bot) {
    // As in the app, only the machine that owns a bot can stop it, and there
    // is no server fallback.
    stopped = await stopThroughSessionHost(client, session);
    if (!stopped.success) {
      throw new Error(`To archive bot session ${session.id}, connect the machine that owns it.${stopped.message ? ` ${stopped.message}` : ''}`);
    }
  } else {
    // Rig sessions have no HappyHerd daemon side chats; their lifecycle is
    // owned outside HappyHerd.
    if (object(metadata?.client)?.id !== 'rig') {
      sideChatsClosed = await closeSideChats(client, session);
    }
    stopped = await stopThroughSessionHost(client, session);
  }

  const wait = dependencies?.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const archived = stopped.success
    ? await readBackAfterStop(client, session.id, wait)
    : await archiveThroughServer(client, session.id);
  if (!isArchived(archived)) {
    throw new Error(stopped.success
      ? `Session ${session.id} accepted the stop but did not show the archived state within ${READBACK_ATTEMPTS * READBACK_INTERVAL_MS / 1000} seconds. Run the command again to finish archiving it.`
      : `Session ${session.id} did not confirm the archived state.`);
  }

  const receipt = {
    schemaVersion: 1,
    type: 'session-archived' as const,
    sessionId: archived.id,
    archivedThrough: stopped.success ? 'session-host' as const : 'server' as const,
    sideChatsClosed,
    active: archived.active,
    lifecycleState: 'archived' as const,
  };
  if (flagArgs.includes('--json')) {
    output(JSON.stringify(receipt));
    return;
  }
  output(`Archived session ${archived.id}.`);
  output(stopped.success
    ? 'Its session host stopped the provider.'
    : 'Its session host did not take the stop request, so the server marked it inactive.');
  if (sideChatsClosed > 0) output(`Closed ${sideChatsClosed} side chat${sideChatsClosed === 1 ? '' : 's'} first.`);
  output(`The conversation is kept. Resume it with "happyherd resume ${archived.id}".`);
}
