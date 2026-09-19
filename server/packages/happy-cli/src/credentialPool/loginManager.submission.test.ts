import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CredentialLoginManager, type CredentialLoginManagerDependencies } from './loginManager';
import { spawnPtyLoginProcess } from './ptyLoginProcess';
import { readCredentialPoolState, type CredentialPoolPaths } from './store';

const AUTH_URL = 'https://claude.com/cai/oauth/authorize?client_id=fixture&code=true&response_type=code&redirect_uri=https%3A%2F%2Fexample.test%2Fcallback&scope=user%3Ainference&code_challenge=fixture&code_challenge_method=S256&state=fixture';
const require = createRequire(import.meta.url);

function fakeChild(stdin: Writable = new PassThrough()) {
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    kill: vi.fn(),
  });
  child.kill.mockImplementation(() => {
    queueMicrotask(() => {
      child.exitCode = 143;
      child.emit('close', 143);
    });
    return true;
  });
  return child;
}

describe('Claude credential code submission', () => {
  let root: string;
  let paths: CredentialPoolPaths;
  let managers: CredentialLoginManager[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'happy-claude-submission-'));
    paths = { stateFile: join(root, 'pool.json'), accountsDir: join(root, 'accounts') };
    managers = [];
  });

  afterEach(async () => {
    await Promise.all(managers.map((manager) => manager.dispose()));
    await rm(root, { recursive: true, force: true });
  });

  function createManager(dependencies: CredentialLoginManagerDependencies) {
    const manager = new CredentialLoginManager({ paths, ...dependencies });
    managers.push(manager);
    return manager;
  }

  it('keeps submission pending through old-URL redraws and rejects duplicate codes', async () => {
    const child = fakeChild();
    const manager = createManager({ spawnPty: () => child as unknown as ChildProcess });
    const started = await manager.start('claude', 'work');
    child.stdout.write(`${AUTH_URL}\nPaste code here > `);
    const writes: string[] = [];
    child.stdin.on('data', (chunk) => {
      writes.push(String(chunk));
      child.stdout.write(`\u001b[2K${AUTH_URL}\nChecking...`);
    });

    expect(await manager.submitCode(started.id, 'fixture-code')).toMatchObject({ state: 'starting' });
    expect(writes).toEqual(['fixture-code', '\r']);
    child.stderr.write('\nWaiting for the provider...');
    expect(manager.status(started.id).state).toBe('starting');
    await expect(manager.submitCode(started.id, 'duplicate')).rejects.toThrow('not waiting');
    expect(writes).toHaveLength(2);
    expect((await readCredentialPoolState(paths)).accounts).toEqual([]);
  });

  it('does not send Enter after cancellation while the pasted code is settling', async () => {
    const child = fakeChild();
    const manager = createManager({ spawnPty: () => child as unknown as ChildProcess });
    const started = await manager.start('claude', 'canceled');
    child.stdout.write(`${AUTH_URL}\n`);
    const writes: string[] = [];
    child.stdin.on('data', (chunk) => writes.push(String(chunk)));
    const submission = manager.submitCode(started.id, 'fixture-code');
    await manager.cancel(started.id);
    expect(await submission).toMatchObject({ state: 'canceled' });
    expect(writes).toEqual(['fixture-code']);
    expect((await readCredentialPoolState(paths)).accounts).toEqual([]);
  });

  it('fails a broken input stream without exposing its error or retrying a partial code', async () => {
    const child = fakeChild(new Writable({
      write(_chunk, _encoding, callback) { callback(new Error('private-input-detail')); },
    }));
    const manager = createManager({ spawnPty: () => child as unknown as ChildProcess });
    const started = await manager.start('claude', 'broken');
    child.stdout.write(`${AUTH_URL}\n`);
    await expect(manager.submitCode(started.id, 'fixture-code')).rejects.toThrow('did not accept the code');
    expect(manager.status(started.id).state).toBe('failed');
    expect(JSON.stringify(manager.status(started.id))).not.toContain('private-input-detail');
    expect((await readCredentialPoolState(paths)).accounts).toEqual([]);
    await expect(manager.submitCode(started.id, 'second-code')).rejects.toThrow('not waiting');
  });

  it('reports a nonzero provider exit after submission and permits a fresh retry', async () => {
    const children = [fakeChild(), fakeChild()];
    const failed = children[0];
    const retry = children[1];
    const manager = createManager({ spawnPty: () => children.shift()! as unknown as ChildProcess });
    const started = await manager.start('claude', 'retry');
    failed.stdout.write(`${AUTH_URL}\n`);
    await manager.submitCode(started.id, 'fixture-code');
    failed.exitCode = 7;
    failed.emit('close', 7);
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('failed'));
    const restarted = await manager.start('claude', 'retry');
    retry.stdout.write(`${AUTH_URL}\n`);
    expect(restarted.id).not.toBe(started.id);
    expect(manager.status(restarted.id).state).toBe('waiting-user');
    expect((await readCredentialPoolState(paths)).accounts).toEqual([]);
  });

  it('submits exact React state on a real Ink Enter event through a real PTY', async () => {
    const fixture = join(root, 'ink-login.mjs');
    const receipt = join(root, 'receipt');
    await writeFile(fixture, [
      `import React, { useEffect, useState } from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};`,
      `import { render, Text, useInput } from ${JSON.stringify(pathToFileURL(require.resolve('ink')).href)};`,
      "import { writeFileSync } from 'node:fs';",
      'if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(12);',
      'setTimeout(() => process.exit(13), 8000).unref();',
      'function Login() {',
      "  const [value, setValue] = useState('');",
      '  useInput((input, key) => {',
      '    if (key.return) {',
      "      if (value !== 'fixture-code') process.exit(14);",
      `      writeFileSync(${JSON.stringify(receipt)}, 'exact-code-submitted');`,
      "      process.stdout.write('\\r\\nLong-lived authentication token created\\r\\nsk-ant-neutral-fixture\\r\\n');",
      '      setTimeout(() => process.exit(0), 10);',
      '    } else { setValue((previous) => previous + input); }',
      '  });',
      `  useEffect(() => { process.stdout.write(${JSON.stringify(`${AUTH_URL}\r\n`)}); }, []);`,
      "  return React.createElement(Text, null, 'Paste code here > ' + value);",
      '}',
      'render(React.createElement(Login));',
    ].join('\n'));
    const manager = createManager({
      spawnPty: (_command, _args, options) => spawnPtyLoginProcess(process.execPath, [fixture], options),
    });
    const started = await manager.start('claude', 'ink');
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('waiting-user'), { timeout: 3000 });
    await manager.submitCode(started.id, 'fixture-code');
    await vi.waitFor(() => expect(manager.status(started.id).state).toBe('succeeded'), { timeout: 3000 });
    expect(await readFile(receipt, 'utf8')).toBe('exact-code-submitted');
    expect((await readCredentialPoolState(paths)).accounts).toEqual([
      expect.objectContaining({ provider: 'claude', name: 'ink' }),
    ]);
    expect(JSON.stringify(manager.status(started.id))).not.toContain('sk-ant-neutral-fixture');
    expect(JSON.stringify(manager.status(started.id))).not.toContain('fixture-code');
  }, 10000);
});
