import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

type ProcessProbe = (pid: number, signal: 0) => unknown;

const execFileAsync = promisify(execFile);

/**
 * Return true only when the operating system confirms that the provider
 * process no longer exists. Permission and other probe failures are not exit
 * evidence, so they deliberately keep the session active.
 */
export function hasProviderProcessExited(
  pid: number,
  probe: ProcessProbe = process.kill,
): boolean {
  try {
    probe(pid, 0);
    return false;
  } catch (error) {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export type ProcessIdentity =
  /** `ps` found the process. */
  | {
    status: 'process';
    /** The command line the operating system reports for the process. */
    commandLine: string;
    /** The earliest time at which the process can have started. */
    earliestStartMs: number;
  }
  /**
   * `ps` ran and found no process with this ID: it exited, or on Linux the
   * number now names a thread of another process.
   */
  | { status: 'absent' }
  /** `ps` could not run, or its answer could not be read. */
  | { status: 'unavailable' };

/**
 * Read a process's command line and start time from POSIX `ps`, which the
 * supported macOS and Linux hosts provide.
 */
export async function readProcessIdentity(pid: number): Promise<ProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { status: 'absent' };
  const requestedAtMs = Date.now();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ps', ['-ww', '-o', 'etime=', '-o', 'args=', '-p', String(pid)], { timeout: 5_000 }));
  } catch (error) {
    // `ps` exits 1 with no output when it selects no process.
    const { code, stdout: output, stderr } = error as { code?: unknown; stdout?: string; stderr?: string };
    return code === 1 && !output?.trim() && !stderr?.trim() ? { status: 'absent' } : { status: 'unavailable' };
  }
  return parseProcessIdentity(stdout, requestedAtMs) ?? { status: 'unavailable' };
}

/** Parse `ps -o etime= -o args=` output for one process, read at `requestedAtMs`. */
export function parseProcessIdentity(stdout: string, requestedAtMs: number): ProcessIdentity | null {
  const match = /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s+(\S[\s\S]*?)\s*$/.exec(stdout);
  if (!match) return null;
  const [, days = '0', hours = '0', minutes, seconds, commandLine] = match;
  const elapsedSeconds = ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
  // `ps` reports whole seconds, less than one second short of the time elapsed
  // since the start, and measures them after this request.
  return { status: 'process', commandLine, earliestStartMs: requestedAtMs - (elapsedSeconds + 1) * 1000 };
}
