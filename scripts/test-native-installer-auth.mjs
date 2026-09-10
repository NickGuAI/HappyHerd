#!/usr/bin/env node
// Run against an installed artifact and an already-running disposable server.
// The caller owns the disposable home/server; this helper owns its test daemon.
// Credentials are generated in memory and delivered through normal pairing APIs.
// No provider is launched: session/history persistence is verified at the API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [installRoot, testHome, serverUrl, separator, ...rerun] = process.argv.slice(2);
assert(installRoot && testHome && serverUrl && separator === '--' && rerun.length,
  'usage: test-native-installer-auth.mjs INSTALL_ROOT DISPOSABLE_HOME SERVER_URL -- RERUN_COMMAND [ARGS...]');
assert(path.isAbsolute(testHome), 'disposable home must be absolute');
assert.equal(installRoot, path.join(testHome, '.local/share/happyherd'));
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(serverUrl).hostname),
  'integration proof requires a disposable loopback server');

const require = createRequire(path.join(installRoot, 'runtime/package.json'));
const nacl = require('tweetnacl');
const { io } = require('socket.io-client');
const cli = path.join(testHome, '.local/bin/happyherd');
// Never inherit the orchestrator's runtime, account, provider, or tracing state.
const env = {
  PATH: process.env.PATH,
  HOME: testHome,
  HAPPY_HOME_DIR: path.join(testHome, '.happyherd'),
  HAPPY_DISABLE_CAFFEINATE: '1',
  SHELL: '/bin/sh',
  TERM: 'xterm',
  LANG: 'en_US.UTF-8',
};
for (const name of ['TMPDIR', 'TMP', 'TEMP', 'SystemRoot']) {
  if (process.env[name]) env[name] = process.env[name];
}

let stage = 'pairing';
let socket;
let authChild;
let daemonStarted = false;
const children = new Set();
const base64 = value => Buffer.from(value).toString('base64');

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: testHome, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true, ...options,
  });
  children.add(child);
  let output = '';
  // Never send raw auth/status/server output to CI logs or retained artifacts.
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-1024 * 1024); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-1024 * 1024); });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve(output);
      else reject(new Error(`child failed during ${stage}: exit=${code}, signal=${signal}`));
    });
  });
  // Auth is awaited only after approval; avoid an unhandled early-exit rejection.
  done.catch(() => {});
  return { child, done, output: () => output };
}

async function finish(process, timeout = 120_000) {
  let timer;
  try {
    return await Promise.race([
      process.done,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out during ${stage}`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function run(command, args, timeout) {
  const process = start(command, args);
  process.child.stdin.end();
  return finish(process, timeout);
}

async function waitFor(check, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`timed out during ${stage}`);
}

let token;
async function api(route, body) {
  const response = await fetch(`${serverUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  assert(response.ok, `API ${route} returned HTTP ${response.status} during ${stage}`);
  return response.json();
}

function box(plaintext, recipient) {
  const ephemeral = nacl.box.keyPair();
  const nonce = randomBytes(24);
  return Buffer.concat([
    ephemeral.publicKey, nonce, nacl.box(plaintext, nonce, recipient, ephemeral.secretKey),
  ]);
}

function dataKey(encrypted, recipient) {
  const bytes = Buffer.from(encrypted, 'base64');
  assert.equal(bytes[0], 0, 'expected v2 encrypted data key');
  const result = nacl.box.open(bytes.subarray(57), bytes.subarray(33, 57),
    bytes.subarray(1, 33), recipient.secretKey);
  assert(result && result.length === 32, 'account cannot decrypt data key');
  return Buffer.from(result);
}

function encrypt(value, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return base64(Buffer.concat([Buffer.from([0]), nonce, ciphertext, cipher.getAuthTag()]));
}

function decrypt(value, key) {
  const bytes = Buffer.from(value, 'base64');
  assert.equal(bytes[0], 0, 'expected AES-GCM version zero');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([
    decipher.update(bytes.subarray(13, -16)), decipher.final(),
  ]).toString());
}

async function connect() {
  socket?.disconnect();
  socket = io(serverUrl, {
    path: '/v1/updates', transports: ['websocket'],
    auth: { token, clientType: 'user-scoped' }, reconnection: true,
  });
  await waitFor(() => socket.connected);
}

async function onlineMachine(accountEncryption, expectedId) {
  const machine = await waitFor(async () => {
    const machines = await api('/v1/machines');
    assert.equal(machines.length, 1, 'pairing or upgrade changed the machine identity');
    const current = machines[0];
    if (!current.active) return false;
    return current;
  });
  if (expectedId) assert.equal(machine.id, expectedId);
  const key = dataKey(machine.dataEncryptionKey, accountEncryption);
  const metadata = decrypt(machine.metadata, key);
  assert.equal(metadata.homeDir, testHome, 'daemon used the wrong home');
  assert(metadata.host, 'machine has no display hostname');
  const response = await socket.timeout(40_000).emitWithAck('rpc-call', {
    method: `${machine.id}:happyherd-list-commanders`, params: encrypt({}, key),
  });
  assert.equal(response.ok, true, 'online daemon did not answer encrypted RPC');
  const result = decrypt(response.result, key);
  assert(Array.isArray(result.commanders), 'unexpected read-only machine RPC result');
  return { id: machine.id, key, metadata };
}

try {
  const identity = nacl.sign.keyPair();
  const challenge = randomBytes(32);
  ({ token } = await api('/v1/auth', {
    publicKey: base64(identity.publicKey), challenge: base64(challenge),
    signature: base64(nacl.sign.detached(challenge, identity.secretKey)),
  }));
  assert(token, 'disposable account authentication failed');
  const accountEncryption = nacl.box.keyPair();
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const scriptArgs = process.platform === 'darwin'
    ? ['-q', '/dev/null', cli, 'auth', 'login']
    : ['-q', '-e', '-c', `${quote(cli)} auth login`, '/dev/null'];
  authChild = start('script', scriptArgs);
  await waitFor(() => {
    if (authChild.child.exitCode !== null) throw new Error('auth CLI exited before method selection');
    return authChild.output().includes('How would you like to authenticate?');
  });
  authChild.child.stdin.write('1');
  const publicKey = await waitFor(() => {
    if (authChild.child.exitCode !== null) throw new Error('auth CLI exited before pairing request');
    const match = authChild.output().match(/happy:\/\/terminal\?([A-Za-z0-9_-]+)/);
    return match ? Buffer.from(match[1], 'base64url') : false;
  });
  assert.equal(publicKey.length, 32);
  await api('/v1/auth/response', {
    publicKey: base64(publicKey),
    response: base64(box(Buffer.concat([Buffer.from([0]), accountEncryption.publicKey]), publicKey)),
  });
  assert((await finish(authChild)).includes('Authentication successful'));
  console.log('native-installer-auth: v2 CLI pairing passed');

  stage = 'initial online daemon';
  daemonStarted = true;
  await run(cli, ['daemon', 'start']);
  await connect();
  const before = await onlineMachine(accountEncryption);
  console.log('native-installer-auth: registered machine online and encrypted RPC usable');

  stage = 'persisting session history';
  const sessionKey = randomBytes(32);
  const metadata = { machineId: before.id, path: testHome, host: before.metadata.host,
    name: 'Installer continuity proof' };
  const { session } = await api('/v1/sessions', {
    tag: `native-installer-${randomUUID()}`, metadata: encrypt(metadata, sessionKey),
    dataEncryptionKey: base64(Buffer.concat([
      Buffer.from([0]), box(sessionKey, accountEncryption.publicKey),
    ])),
  });
  assert(session?.id, 'session was not created');
  const localId = randomUUID();
  const message = { role: 'user', content: { type: 'text', text: 'Retain this installer test history.' } };
  await api(`/v3/sessions/${session.id}/messages`, {
    messages: [{ localId, content: encrypt(message, sessionKey) }],
  });
  const readMessage = async id => (await api(`/v1/sessions/${session.id}/messages`))
    .messages.find(item => item.localId === id);
  const storedBefore = await readMessage(localId);
  assert(storedBefore?.id, 'message was not persisted');
  assert.deepEqual(decrypt(storedBefore.content.c, sessionKey), message);

  stage = 'installer rerun';
  socket.disconnect();
  await run(rerun[0], rerun.slice(1), 300_000);
  await waitFor(async () => {
    try { return (await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(2000) })).ok; }
    catch { return false; }
  });
  assert((await run(cli, ['auth', 'login'])).includes('Already authenticated'),
    'upgrade lost CLI authentication');
  await connect();
  stage = 'post-upgrade online daemon and retained history';
  const after = await onlineMachine(accountEncryption, before.id);
  assert(after.key.equals(before.key), 'upgrade changed the machine encryption key');
  const retained = (await api('/v1/sessions')).sessions.find(item => item.id === session.id);
  assert(retained, 'upgrade lost the session');
  assert(dataKey(retained.dataEncryptionKey, accountEncryption).equals(sessionKey),
    'upgrade changed the session encryption key');
  assert.deepEqual(decrypt(retained.metadata, sessionKey), metadata);
  assert.deepEqual(await readMessage(localId), storedBefore, 'upgrade changed persisted history');
  const nextId = randomUUID();
  await api(`/v3/sessions/${session.id}/messages`, {
    messages: [{ localId: nextId, content: encrypt(message, sessionKey) }],
  });
  assert.deepEqual(decrypt((await readMessage(nextId)).content.c, sessionKey), message);
  console.log('native-installer-auth: rerun retained account, machine key, session and history; next message persisted');
} catch (error) {
  console.error(`native-installer-auth: failed during ${stage}: ${error.message}`);
  process.exitCode = 1;
} finally {
  socket?.disconnect();
  if (daemonStarted) {
    stage = 'test daemon cleanup';
    try { await run(cli, ['daemon', 'stop']); }
    catch { console.error('native-installer-auth: test daemon cleanup failed'); process.exitCode = 1; }
  }
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
}
