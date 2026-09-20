import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';

import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

const HAPPYHERD_TERMINAL_ENTRYPOINT = '@slopus/happy-terminal/dist/main.js';
export const HAPPYHERD_TERMINAL_BOOT_TIMEOUT_MS = 120_000;

const require = createRequire(import.meta.url);
let bootAttempted = false;

export type HappyHerdTerminalBootCommand = {
  command: string;
  args: string[];
};

export function buildHappyHerdTerminalBootCommand(
  resolvedEntrypoint: string,
  nodeExecutable: string = process.execPath,
): HappyHerdTerminalBootCommand {
  return {
    command: nodeExecutable,
    args: [resolvedEntrypoint, 'daemon', 'start'],
  };
}

export function resolveHappyHerdTerminalEntrypoint(): string {
  return require.resolve(HAPPYHERD_TERMINAL_ENTRYPOINT);
}

function logChildOutput(stream: NodeJS.ReadableStream | null, label: string): void {
  stream?.on('data', (chunk: Buffer | string) => {
    const text = String(chunk).trimEnd();
    if (text.length > 0) logger.debug(`[HAPPYHERD AGENT BOOT] ${label}: ${text}`);
  });
}

/**
 * Best-effort, one-shot startup of the machine-level HappyHerd Agent daemon.
 *
 * The child is intentionally not part of HappyHerd daemon shutdown: the agent
 * daemon is a machine service shared with HappyHerd Terminal and other clients.
 *
 * Off unless asked for. HappyHerd Agent registers a machine of its own on the
 * account, and until the phone knows the two daemons are one computer, booting
 * it for everybody would split every upgraded user's laptop into two rows in
 * their picker.
 */
export function startHappyHerdTerminalDaemon(): ChildProcess | null {
  if (!configuration.bootHappyHerdAgent) return null;
  if (bootAttempted) return null;
  bootAttempted = true;

  let command: HappyHerdTerminalBootCommand;
  try {
    command = buildHappyHerdTerminalBootCommand(resolveHappyHerdTerminalEntrypoint());
  } catch (error) {
    logger.debug('[HAPPYHERD AGENT BOOT] Could not resolve @slopus/happy-terminal:', error);
    return null;
  }

  logger.debug(`[HAPPYHERD AGENT BOOT] Starting: ${command.command} ${command.args.join(' ')}`);

  let child: ChildProcess;
  try {
    child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    logger.debug('[HAPPYHERD AGENT BOOT] Spawn failed; continuing without HappyHerd Agent:', error);
    return null;
  }

  logChildOutput(child.stdout, 'stdout');
  logChildOutput(child.stderr, 'stderr');

  const timeout = setTimeout(() => {
    logger.debug(
      `[HAPPYHERD AGENT BOOT] Startup exceeded ${HAPPYHERD_TERMINAL_BOOT_TIMEOUT_MS}ms; leaving child running`,
    );
  }, HAPPYHERD_TERMINAL_BOOT_TIMEOUT_MS);
  timeout.unref();

  child.once('error', (error) => {
    clearTimeout(timeout);
    logger.debug('[HAPPYHERD AGENT BOOT] Child failed; continuing without HappyHerd Agent:', error);
  });
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    logger.debug(`[HAPPYHERD AGENT BOOT] Child exited (code=${code}, signal=${signal ?? 'none'})`);
  });

  return child;
}