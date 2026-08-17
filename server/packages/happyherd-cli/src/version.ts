/** Launcher release identity sourced from the package that is actually running. */

import { readFileSync } from 'node:fs';

interface PackageIdentity {
  name: string;
  version: string;
}

export function packageIdentity(): PackageIdentity {
  const value = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('launcher package identity is invalid');
  const record = value as Record<string, unknown>;
  if (record.name !== '@happyherd/cli' || typeof record.version !== 'string') {
    throw new Error('launcher package identity does not match HappyHerd');
  }
  return { name: record.name, version: record.version };
}
