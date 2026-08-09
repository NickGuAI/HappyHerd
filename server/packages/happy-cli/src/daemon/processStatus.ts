type ProcessProbe = (pid: number, signal: 0) => unknown;

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
