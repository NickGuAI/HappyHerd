import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveReleaseSha } from './releaseIdentity';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function releaseFile(value: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'happyherd-release-identity-'));
  temporaryDirectories.push(directory);
  const filePath = join(directory, 'happyherd-release.json');
  writeFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
  return filePath;
}

describe('resolveReleaseSha', () => {
  it('uses the immutable identity baked into a host artifact', () => {
    const sha = 'a'.repeat(40);
    expect(resolveReleaseSha({
      artifactPath: releaseFile({ schemaVersion: 1, happyHerdSha: sha }),
    })).toBe(sha);
  });

  it('allows an identical launcher environment identity', () => {
    const sha = 'b'.repeat(40);
    expect(resolveReleaseSha({
      artifactPath: releaseFile({ schemaVersion: 1, happyHerdSha: sha }),
      environmentSha: sha,
    })).toBe(sha);
  });

  it('fails closed when launcher and artifact identities disagree', () => {
    expect(() => resolveReleaseSha({
      artifactPath: releaseFile({ schemaVersion: 1, happyHerdSha: 'c'.repeat(40) }),
      environmentSha: 'd'.repeat(40),
    })).toThrow('does not match');
  });

  it('keeps source/npm runs identity-free when no release source is present', () => {
    expect(resolveReleaseSha({ artifactPath: join(tmpdir(), 'missing-happyherd-release.json') })).toBeUndefined();
  });
});
