#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'server/packages/happyherd-cli');
const home = mkdtempSync(join(tmpdir(), 'cli-runtime-'));
try {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^HAPPY(?:HERD)?_/.test(key)));
  Object.assign(env, { HOME: home, USERPROFILE: home, NO_COLOR: '1' });
  const run = (...args) => execFileSync(process.execPath, [join(cli, 'bin/happyherd.mjs'), ...args], { env, encoding: 'utf8', timeout: 20_000 });
  const manifest = JSON.parse(readFileSync(join(cli, 'package.json')));
  assert.equal(run('--version').trim(), `happyherd version: ${manifest.version}`);
  assert(!existsSync(join(home, '.happyherd')), 'version must not create state');
  const legacy = join(home, '.happy');
  mkdirSync(legacy);
  const state = { 'settings.json': '{"schemaVersion":2,"machineId":"retained-machine","daemonAutoStartWhenRunningHappy":false}',
    'sessions.json': '[{"id":"retained-session","updatedAt":1}]', 'access.key': 'retained-key', 'agent.key': 'independent-control-key' };
  for (const [file, contents] of Object.entries(state)) writeFileSync(join(legacy, file), contents);
  const help = run('--help');
  assert.match(help, /happyherd/);
  assert(!/\bhappy\b|\bHappy\b|\bHAPPY_/.test(help), 'active help must use only canonical CLI branding');
  assert(!existsSync(join(home, '.happyherd')), 'existing legacy home must be reused');
  assert(existsSync(join(legacy, 'logs')), 'configuration must select the original home');
  for (const [file, contents] of Object.entries(state)) assert.equal(readFileSync(join(legacy, file), 'utf8'), contents);
  for (const [name, entry] of Object.entries(manifest.bin)) {
    assert(name.startsWith('happyherd'));
    assert(existsSync(resolve(cli, entry)));
    execFileSync(process.execPath, ['--check', resolve(cli, entry)]);
  }
  assert(!existsSync(join(cli, 'bin/happy.mjs')));
  assert(!existsSync(join(cli, 'bin/happy-mcp.mjs')));
  console.log('cli-rename-runtime: built command/help/version, helpers and original state passed');
} finally { rmSync(home, { recursive: true, force: true }); }
