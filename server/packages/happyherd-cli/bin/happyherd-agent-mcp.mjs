#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hasNoWarnings = process.execArgv.includes('--no-warnings');
const hasNoDeprecation = process.execArgv.includes('--no-deprecation');

if (!hasNoWarnings || !hasNoDeprecation) {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const entrypoint = join(projectRoot, 'dist', 'codex', 'agentMcpStdioBridge.mjs');
  try {
    execFileSync(process.execPath, [
      '--no-warnings',
      '--no-deprecation',
      entrypoint,
      ...process.argv.slice(2),
    ], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (error) {
    process.exit(error.status || 1);
  }
} else {
  import('../dist/codex/agentMcpStdioBridge.mjs');
}
