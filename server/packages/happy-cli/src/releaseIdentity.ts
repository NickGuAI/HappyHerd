/**
 * Resolves the immutable HappyHerd source identity baked into host artifacts.
 * Source/npm runs have no release file and intentionally fall back to the
 * package version without inventing a commit identity.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { projectPath } from '@/projectPath';

const FULL_GIT_SHA = /^[0-9a-f]{40}$/;

type ReleaseIdentityFile = {
  schemaVersion: 1;
  happyHerdSha: string;
};

export function validateReleaseSha(value: string, source: string): string {
  const normalized = value.trim();
  if (!FULL_GIT_SHA.test(normalized)) {
    throw new Error(`${source} must contain a full lowercase Git commit SHA`);
  }
  return normalized;
}

export function resolveReleaseSha(options: {
  artifactPath?: string;
  environmentSha?: string;
} = {}): string | undefined {
  const artifactPath = options.artifactPath ?? join(projectPath(), 'happyherd-release.json');
  let artifactSha: string | undefined;

  if (existsSync(artifactPath)) {
    const parsed = JSON.parse(readFileSync(artifactPath, 'utf8')) as Partial<ReleaseIdentityFile>;
    if (parsed.schemaVersion !== 1 || typeof parsed.happyHerdSha !== 'string') {
      throw new Error(`HappyHerd release identity is invalid: ${artifactPath}`);
    }
    artifactSha = validateReleaseSha(parsed.happyHerdSha, 'HappyHerd release identity');
  }

  const environmentSha = options.environmentSha?.trim()
    ? validateReleaseSha(options.environmentSha, 'HAPPYHERD_RELEASE_SHA')
    : undefined;
  if (artifactSha && environmentSha && artifactSha !== environmentSha) {
    throw new Error('HAPPYHERD_RELEASE_SHA does not match the installed HappyHerd artifact');
  }
  return artifactSha ?? environmentSha;
}
