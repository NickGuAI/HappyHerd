/** Resolve and launch the bundled maintained Happy runtime. */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

export function resolveHappyBinary(): string {
  let current = dirname(require.resolve('happy'));
  while (true) {
    const packagePath = join(current, 'package.json');
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as Record<string, unknown>;
      if (packageJson.name === 'happy') {
        const binary = join(current, 'bin', 'happy.mjs');
        if (!existsSync(binary)) throw new Error('bundled Happy runtime is missing its executable');
        return binary;
      }
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('bundled Happy runtime could not be resolved');
    current = parent;
  }
}

export function runHappy(args: string[], stdio: 'inherit' | 'pipe' = 'inherit'): number {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      name === 'HAPPYHERD_ISSUER'
      || name === 'HAPPYHERD_API_BASE_URL'
      || /_ACCESS_TOKEN$/.test(name)
    ) delete env[name];
  }
  const result = spawnSync(process.execPath, [resolveHappyBinary(), ...args], {
    stdio,
    encoding: stdio === 'pipe' ? 'utf8' : undefined,
    env,
  });
  if (result.error) throw new Error(`Happy runtime could not start: ${result.error.message}`);
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return 1;
  }
  return result.status ?? 1;
}

export function launchAgent(provider: string, args: string[]): number {
  if (provider !== 'claude' && provider !== 'codex') {
    throw new Error('launch provider must be claude or codex');
  }
  return runHappy(provider === 'codex' ? ['codex', ...args] : args);
}
