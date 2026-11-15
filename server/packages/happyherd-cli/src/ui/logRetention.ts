import { lstat, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function removeExpiredLogFiles(logsDir: string, now = Date.now()): Promise<number> {
  let names: string[];
  try {
    names = await readdir(logsDir);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.log')) continue;
    const path = join(logsDir, name);
    try {
      const stat = await lstat(path);
      if (stat.isFile() && now - stat.mtimeMs > LOG_RETENTION_MS) {
        await unlink(path);
        removed++;
      }
    } catch {
      // A file may disappear or become inaccessible while cleanup runs.
    }
  }
  return removed;
}
