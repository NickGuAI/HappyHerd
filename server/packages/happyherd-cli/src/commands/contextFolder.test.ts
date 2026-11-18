/** Exercise the command and built installer path with a recording gog executable. */
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cli = fileURLToPath(new URL('../../bin/happyherd.mjs', import.meta.url));
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const mimeType = 'application/vnd.google-apps.folder';
const missingAccount = 'missing --account (or set GOG_ACCOUNT, set default via `gog auth manage`, or store exactly one token)';
let directory: string;
let settingsPath: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(path.join(tmpdir(), 'happyherd-context-folder-'));
  const home = path.join(directory, 'home');
  const bin = path.join(directory, 'bin');
  await mkdir(path.join(home, '.happyherd'), { recursive: true });
  await mkdir(bin);
  settingsPath = path.join(home, '.happyherd/settings.json');
  env = {
    ...process.env,
    HOME: home,
    HAPPYHERD_HOME_DIR: path.join(home, '.happyherd'),
    HAPPYHERD_VARIANT: 'stable',
    PATH: `${bin}:/usr/bin:/bin`,
    GOG_TEST_CALLS: path.join(directory, 'calls.jsonl'),
    GOG_TEST_NAME: 'MyContext',
    GOG_TEST_SCENARIO: 'none',
  };
  await writeFile(path.join(bin, 'gog'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GOG_TEST_CALLS, JSON.stringify(args) + '\\n');
const scenario = process.env.GOG_TEST_SCENARIO;
const name = process.env.GOG_TEST_NAME;
const folder = { id: 'fixture-folder', name, mimeType: '${mimeType}' };
if (scenario === 'unsigned') { console.error('No Google account is signed in.'); process.exit(1); }
if (scenario === 'denied') { console.error('Drive access denied.'); process.exit(1); }
if (scenario === 'multi' && !args.includes('--account')) { console.error(${JSON.stringify(missingAccount)}); process.exit(1); }
const commandIndex = args.indexOf('drive') + 1;
switch (args[commandIndex]) {
  case 'get':
    console.log(JSON.stringify({ file: { ...folder, id: args[commandIndex + 1], mimeType: scenario === 'file' ? 'text/plain' : folder.mimeType } }));
    break;
  case 'ls':
    console.log(JSON.stringify({
      files: scenario === 'none' || scenario === 'multi' ? null : scenario === 'many'
        ? [folder, { ...folder, id: 'fixture-other' }]
        : scenario === 'paged' && args.includes('--page') ? [{ ...folder, id: 'fixture-other' }] : [folder],
      nextPageToken: scenario === 'paged' && !args.includes('--page') ? 'fixture-page-2' : '',
    }));
    break;
  case 'mkdir': console.log(JSON.stringify({ folder: { id: folder.id, name: args.at(-1) } })); break;
  default: process.exit(2);
}
`);
  await chmod(path.join(bin, 'gog'), 0o755);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});

async function run(args: string[]) {
  for (const key of ['HAPPYHERD_HOME_DIR', 'PATH', 'GOG_TEST_CALLS', 'GOG_TEST_NAME', 'GOG_TEST_SCENARIO']) {
    vi.stubEnv(key, env[key]);
  }
  const output: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((value) => output.push(value));
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  let stderr = '';
  try {
    const { handleContextFolderCommand } = await import('./contextFolder');
    await handleContextFolderCommand(args);
  } catch (error) {
    stderr = String(error);
    process.exitCode = 1;
  }
  const status = Number(process.exitCode ?? 0);
  process.exitCode = previousExitCode;
  log.mockRestore();
  return { status, stdout: output.join('\n'), stderr };
}

function runBuilt(args: string[]) {
  return spawnSync(process.execPath, [cli, 'context-folder', ...args], { env, encoding: 'utf8' });
}

async function settings() {
  return JSON.parse(await readFile(settingsPath, 'utf8'));
}

async function calls(): Promise<string[][]> {
  return (await readFile(env.GOG_TEST_CALLS!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
}

describe('context-folder', () => {
  it.each([undefined, '', '  '])('shows the default without gog when the name is %s', async (name) => {
    if (name !== undefined) await writeFile(settingsPath, JSON.stringify({ contextFolder: { name } }));
    await rm(path.join(directory, 'bin/gog'));
    const result = await run(['show', '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ name: 'MyContext', id: null, link: null, account: null });
    expect((await run(['show'])).stdout).toContain('no folder is recorded yet');
    await expect(readFile(env.GOG_TEST_CALLS!)).rejects.toThrow();
  });

  it('confirms a recorded ID without searching, creating or rewriting settings', async () => {
    const account = 'saved@example.com';
    env.GOG_TEST_SCENARIO = 'multi';
    const saved = JSON.stringify({ contextFolder: { name: 'Saved context', id: 'fixture-saved', account }, assistantName: 'River' });
    await writeFile(settingsPath, saved);
    const result = await run(['ensure', '--json']);
    expect(result.status, result.stderr).toBe(0);
    const receipt = { name: 'Saved context', id: 'fixture-saved', link: 'https://drive.google.com/drive/folders/fixture-saved', account };
    expect(JSON.parse(result.stdout)).toEqual(receipt);
    expect(JSON.parse((await run(['show', '--json'])).stdout)).toEqual(receipt);
    expect((await run(['show'])).stdout).toContain(`Account: ${account}`);
    expect(await calls()).toEqual([['--json', '--no-input', '--account', account, 'drive', 'get', 'fixture-saved', '--fields', 'id,name,mimeType']]);
    expect(await readFile(settingsPath, 'utf8')).toBe(saved);
  });

  it('records the one matching root folder without creating anything', async () => {
    env.GOG_TEST_SCENARIO = 'one';
    const name = "Team's \\ context $(literal)";
    env.GOG_TEST_NAME = name;
    await writeFile(settingsPath, JSON.stringify({ contextFolder: { name }, assistantName: 'River' }));
    const result = await run(['ensure', '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect((await settings()).contextFolder).toEqual({ name, id: 'fixture-folder' });
    expect((await settings()).assistantName).toBe('River');
    expect(await calls()).toEqual([[
      '--json', '--no-input', 'drive', 'ls', '--parent', 'root', '--no-all-drives',
      '--query', `name = 'Team\\'s \\\\ context $(literal)' and mimeType = '${mimeType}' and trashed = false`,
      '--fields', 'files(id,name),nextPageToken',
    ]]);
  });

  it('creates the missing folder once and reuses it on a second ensure', async () => {
    expect((await run(['ensure', '--json'])).status).toBe(0);
    expect((await settings()).contextFolder).toEqual({ name: 'MyContext', id: 'fixture-folder' });
    expect((await run(['ensure', '--json'])).status).toBe(0);
    const recorded = await calls();
    expect(recorded.map((args) => args[3])).toEqual(['ls', 'mkdir', 'get']);
    expect(recorded[1]).toEqual(['--json', '--no-input', 'drive', 'mkdir', '--parent', 'root', '--', 'MyContext']);
  });

  it.each(['multi', 'one'])('records an account when ensuring a folder and reuses it (%s)', async (scenario) => {
    env.GOG_TEST_SCENARIO = scenario;
    const account = 'selected@example.com';
    expect((await run(['ensure', '--account', account, '--json'])).status).toBe(0);
    expect((await settings()).contextFolder).toEqual({ name: 'MyContext', id: 'fixture-folder', account });
    expect(JSON.parse((await run(['show', '--json'])).stdout).account).toBe(account);
    expect((await run(['ensure', '--json'])).status).toBe(0);
    const recorded = await calls();
    expect(recorded.map((args) => args[5])).toEqual(scenario === 'multi' ? ['ls', 'mkdir', 'get'] : ['ls', 'get']);
    for (const args of recorded) expect(args.slice(0, 5)).toEqual(['--json', '--no-input', '--account', account, 'drive']);
  });

  it('records an explicit account after confirming an already-saved folder', async () => {
    env.GOG_TEST_SCENARIO = 'multi';
    const saved = { name: 'Saved context', id: 'fixture-saved', account: 'previous@example.com' };
    await writeFile(settingsPath, JSON.stringify({ contextFolder: saved }));
    const account = 'selected@example.com';
    expect((await run(['ensure', '--account', account, '--json'])).status).toBe(0);
    expect((await settings()).contextFolder).toEqual({ ...saved, account });
    expect(await calls()).toEqual([['--json', '--no-input', '--account', account, 'drive', 'get', saved.id, '--fields', 'id,name,mimeType']]);
  });

  it.each(['many', 'paged'])('lists all matches and leaves settings unchanged (%s)', async (scenario) => {
    env.GOG_TEST_SCENARIO = scenario;
    const saved = JSON.stringify({ contextFolder: { name: 'MyContext' }, assistantName: 'River' });
    await writeFile(settingsPath, saved);
    const result = await run(['ensure', '--account', 'selected@example.com', '--json']);
    expect(result.status).toBe(1);
    const receipt = JSON.parse(result.stdout);
    expect(receipt.error).toContain('happyherd context-folder set --id ID');
    expect(receipt.matches.map((match: { id: string }) => match.id)).toEqual(['fixture-folder', 'fixture-other']);
    expect(await readFile(settingsPath, 'utf8')).toBe(saved);
    expect((await calls()).every((args) => args[5] === 'ls' && args[3] === 'selected@example.com')).toBe(true);
    if (scenario === 'paged') expect((await calls())[1].slice(-2)).toEqual(['--page', 'fixture-page-2']);
    else expect((await run(['ensure'])).stdout).toContain('fixture-other');
  });

  it('sets a folder only after confirming its type and readable metadata', async () => {
    env.GOG_TEST_SCENARIO = 'multi';
    env.GOG_TEST_NAME = 'Selected context';
    const account = 'selected@example.com';
    const result = await run(['set', '--account', account, '--id', 'fixture-selected', '--json']);
    expect(result.status, result.stderr).toBe(0);
    expect((await settings()).contextFolder).toEqual({ name: 'Selected context', id: 'fixture-selected', account });
    expect(JSON.parse(result.stdout).account).toBe(account);
    expect((await run(['set', '--id', 'fixture-replacement', '--json'])).status).toBe(0);
    expect((await settings()).contextFolder).toEqual({ name: 'Selected context', id: 'fixture-replacement', account });
    for (const args of await calls()) expect(args.slice(0, 6)).toEqual(['--json', '--no-input', '--account', account, 'drive', 'get']);
    expect(JSON.parse(result.stdout).link).toBe('https://drive.google.com/drive/folders/fixture-selected');
  });

  it.each(['file', 'denied'])('preserves a saved folder when the replacement is %s', async (scenario) => {
    env.GOG_TEST_SCENARIO = scenario;
    const saved = JSON.stringify({ contextFolder: { name: 'Saved context', id: 'fixture-saved', account: 'saved@example.com' } });
    await writeFile(settingsPath, saved);
    const result = await run(['set', '--id', 'fixture-selected', '--account', 'replacement@example.com', '--json']);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain(scenario === 'file' ? 'not a folder' : 'Drive access denied');
    expect(await readFile(settingsPath, 'utf8')).toBe(saved);
  });

  it('names account selection and preserves settings when gog has several sign-ins', async () => {
    env.GOG_TEST_SCENARIO = 'multi';
    const saved = JSON.stringify({ contextFolder: { name: 'MyContext' } });
    await writeFile(settingsPath, saved);
    for (const args of [['ensure'], ['set', '--id', 'fixture-selected']]) {
      const result = await run([...args, '--json']);
      expect(result.status).toBe(1);
      const error = JSON.parse(result.stdout).error;
      expect(error).toContain(missingAccount);
      expect(error).toContain('Select a Google account, then run: happyherd context-folder ensure --account EMAIL');
      expect(error).not.toContain('Sign in to Google Workspace');
    }
    expect(await readFile(settingsPath, 'utf8')).toBe(saved);
    expect((await calls()).every((args) => !args.includes('--account'))).toBe(true);
  });

  it.each(['missing', 'unsigned'])('explains the Google sign-in step when gog is %s', async (scenario) => {
    if (scenario === 'missing') await rm(path.join(directory, 'bin/gog'));
    else env.GOG_TEST_SCENARIO = scenario;
    for (const args of [['ensure'], ['set', '--id', 'fixture-selected']]) {
      const result = await run([...args, '--json']);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).error).toContain('Sign in to Google Workspace with gog, then run: happyherd context-folder ensure');
    }
    await expect(readFile(settingsPath)).rejects.toThrow();
  });

  it('documents all three actions in the built help and shared guide', async () => {
    const result = runBuilt(['--help']);
    expect(result.status, result.stderr).toBe(0);
    for (const action of ['show [--json]', 'ensure [--account EMAIL] [--json]', 'set --id ID [--account EMAIL] [--json]']) expect(result.stdout).toContain(action);
    const guide = await readFile(new URL('../agentContext/sharedKnowledgeTemplates.ts', import.meta.url), 'utf8');
    for (const action of ['show', 'ensure', 'set --id ID']) expect(guide).toContain(`happyherd context-folder ${action}`);
    expect(guide).toContain('happyherd context-folder ensure --account EMAIL');
  });
});

async function installerAsset(): Promise<string> {
  const assetRoot = path.join(directory, 'asset/happyherd');
  const runtime = path.join(assetRoot, 'runtime');
  for (const folder of ['node/bin', 'runtime/bin', 'runtime/tools/unpacked', 'runtime/node_modules/happyherd-server-self-host/webapp']) {
    await mkdir(path.join(assetRoot, folder), { recursive: true });
  }
  await symlink(process.execPath, path.join(assetRoot, 'node/bin/node'));
  for (const file of ['node/LICENSE', 'runtime/node_modules/happyherd-server-self-host/package.json', 'runtime/node_modules/happyherd-server-self-host/webapp/index.html']) {
    await writeFile(path.join(assetRoot, file), '{}');
  }
  await writeFile(path.join(runtime, 'tools/unpacked/rg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const file of ['uninstall.sh', 'cleanup-legacy.sh']) await copyFile(path.join(root, 'installers', file), path.join(assetRoot, file));
  // Only the new command runs the real built CLI. Other installer probes use a
  // fixture, so this test neither starts a daemon nor installs a server.
  await writeFile(path.join(runtime, 'bin/happyherd.mjs'), `
import { spawnSync } from 'node:child_process';
if (process.argv[2] === 'context-folder') {
  const result = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
console.log('HappyHerd installer fixture');
`);
  const archive = path.join(directory, 'asset.tar.gz');
  expect(spawnSync('tar', ['-czf', archive, '-C', path.join(directory, 'asset'), 'happyherd']).status).toBe(0);
  return archive;
}

function install(asset: string, options: string[] = []) {
  return spawnSync('sh', [path.join(root, 'install.sh'), '--asset', asset, '--server', 'https://server.example', '--no-start', ...options], {
    env, encoding: 'utf8', timeout: 15_000,
  });
}

describe('installer context folder', () => {
  it('creates the default on a fresh install, preserves it on rerun, and honors a new name', async () => {
    const asset = await installerAsset();
    const first = install(asset);
    expect(first.status, first.stderr).toBe(0);
    expect((await settings()).contextFolder).toEqual({ name: 'MyContext', id: 'fixture-folder' });
    expect(install(asset).status).toBe(0);
    expect((await calls()).map((args) => args[3])).toEqual(['ls', 'mkdir', 'get']);
    const account = 'selected@example.com';
    expect((await run(['ensure', '--account', account, '--json'])).status).toBe(0);
    env.GOG_TEST_SCENARIO = 'multi';
    const name = '--Team "context" \\ $(literal)';
    const named = install(asset, ['--context-folder', name, '--assistant-name', 'River']);
    expect(named.status, named.stderr).toBe(0);
    expect((await settings()).contextFolder).toEqual({ name, id: 'fixture-folder', account });
    expect((await settings()).assistantName).toBe('River');
    expect((await calls()).at(-1)?.slice(-2)).toEqual(['--', name]);
    for (const args of (await calls()).slice(-2)) expect(args.slice(0, 5)).toEqual(['--json', '--no-input', '--account', account, 'drive']);
  }, 30_000);

  it.each(['missing', 'unsigned', 'multi'])('completes and prints the later command when gog is %s', async (scenario) => {
    if (scenario === 'missing') await rm(path.join(directory, 'bin/gog'));
    else env.GOG_TEST_SCENARIO = scenario;
    const result = install(await installerAsset(), ['--context-folder', 'Team context']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('HappyHerd installed.');
    expect(result.stdout).toContain('Next: happyherd context-folder ensure');
    if (scenario === 'multi') {
      expect(result.stderr).toContain(missingAccount);
      expect(result.stderr).toContain('happyherd context-folder ensure --account EMAIL');
      expect(result.stderr).not.toContain('Sign in to Google Workspace');
    } else expect(result.stderr).toContain('Sign in to Google Workspace with gog');
    expect((await settings()).contextFolder).toEqual({ name: 'Team context' });
    expect(runBuilt(['ensure']).status).toBe(1);
  }, 15_000);
});
