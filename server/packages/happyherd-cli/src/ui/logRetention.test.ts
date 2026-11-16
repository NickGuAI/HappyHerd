import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeExpiredLogFiles } from './logRetention';

describe('removeExpiredLogFiles', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('removes only old direct log files based on modification time', async () => {
    dir = await mkdtemp(join(tmpdir(), 'happyherd-log-retention-'));
    const now = Date.UTC(2026, 10, 15);
    const day = 24 * 60 * 60 * 1000;
    const files = ['old.log', 'recent.log', '2026-01-01.log', 'old.txt', 'nested/old.log'];
    await mkdir(join(dir, 'nested'));
    for (const file of files) await writeFile(join(dir, file), file);
    for (const file of ['old.log', 'old.txt', 'nested/old.log']) {
      await utimes(join(dir, file), new Date(now - 8 * day), new Date(now - 8 * day));
    }
    await utimes(join(dir, 'recent.log'), new Date(now - day), new Date(now - day));
    await utimes(join(dir, '2026-01-01.log'), new Date(now), new Date(now));

    expect(await removeExpiredLogFiles(dir, now)).toBe(1);
    await expect(readFile(join(dir, 'old.log'))).rejects.toMatchObject({ code: 'ENOENT' });
    for (const file of files.slice(1)) {
      expect(await readFile(join(dir, file), 'utf8')).toBe(file);
    }
  });

  it('returns zero for a missing directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'happyherd-log-retention-'));
    expect(await removeExpiredLogFiles(join(dir, 'missing'), Date.UTC(2026, 10, 15))).toBe(0);
  });
});
