#!/usr/bin/env node
// Real isolated acceptance. Never serializes credentials, transcripts, or raw child output.
// Usage: node scripts/issue-321-live-acceptance.mjs ABSOLUTE_WEB_EXPORT [--baseline]
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, mkdtemp, copyFile, chmod, readFile, writeFile, cp, symlink, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = path.join(root, 'server/packages/happyherd-cli');
const req = createRequire(path.join(cliRoot, 'package.json'));
const nacl = req('tweetnacl');
const { io } = req('socket.io-client');
const appReq = createRequire(path.join(root, 'server/packages/happyherd-app/package.json'));
const { chromium } = appReq('playwright-core');
async function directoryDigest(directory) {
  const hash = createHash('sha256');
  async function visit(relative = '') {
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    entries.sort((a,b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(relative, entry.name);
      if(entry.isDirectory()) await visit(file);
      else if(entry.isFile()) { hash.update(file); hash.update('\0'); hash.update(await readFile(path.join(directory, file))); }
    }
  }
  await visit(); return hash.digest('hex');
}
const webExport = process.argv[2];
assert(webExport && path.isAbsolute(webExport), 'Pass an absolute production Web export directory');
const baseline = process.argv.includes('--baseline');
const privateDir = await mkdtemp(path.join(os.tmpdir(), 'happyherd-321-'));
await chmod(privateDir, 0o700);
const artifactDir = path.join(root, '.artifacts/issue-321', path.basename(privateDir));
await mkdir(artifactDir, { recursive: true });
let stage = 'setup';
const receipt = { schemaVersion: 1, baseline, startedAt: new Date().toISOString(), stages: [] };
const children = new Set();
let browser, server, socket, sessionId, daemonStarted = false;
const b64 = x => Buffer.from(x).toString('base64');
const cliHome = path.join(privateDir, 'cli');
const codexHome = path.join(privateDir, 'codex');
const workspace = path.join(privateDir, 'workspace');
const runtimeCliRoot = path.join(privateDir, 'cli-runtime');
await mkdir(runtimeCliRoot);
for (const entry of ['bin', 'dist', 'package.json']) await cp(path.join(process.env.HAPPYHERD_321_CLI_SNAPSHOT || cliRoot, entry), path.join(runtimeCliRoot, entry), { recursive: true });
await symlink(path.join(cliRoot, 'node_modules'), path.join(runtimeCliRoot, 'node_modules'));
await symlink(path.join(root, 'server/node_modules'), path.join(privateDir, 'node_modules'));
receipt.revision = { cliDistSha256: await directoryDigest(path.join(runtimeCliRoot, 'dist')), webExportSha256: await directoryDigest(webExport), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), trackedDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', '--binary'], { cwd: root })).digest('hex'), cliEntrySha256: createHash('sha256').update(await readFile(path.join(runtimeCliRoot, 'dist/index.mjs'))).digest('hex'), runnerSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex') };
await Promise.all([cliHome, codexHome, workspace].map(p => mkdir(p, { recursive: true, mode: 0o700 })));
await copyFile(path.join(os.homedir(), '.codex/auth.json'), path.join(codexHome, 'auth.json'));
await chmod(path.join(codexHome, 'auth.json'), 0o600);
const env = { PATH: process.env.PATH, HOME: os.homedir(), SHELL: '/bin/zsh', TERM: 'xterm', LANG: 'en_US.UTF-8',
  HAPPYHERD_HOME_DIR: cliHome, CODEX_HOME: codexHome, HAPPYHERD_DISABLE_CAFFEINATE: '1',
  ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}) };
function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: workspace, env, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  children.add(child);
  let output = '';
  child.stdout.on('data', x => { output = (output + x).slice(-2_000_000); });
  child.stderr.on('data', x => { output = (output + x).slice(-2_000_000); });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      children.delete(child);
      if (code === 0) resolve(output);
      else {
        let detail = '';
        for (const line of output.trim().split('\n').reverse()) { try { const parsed = JSON.parse(line); if(typeof parsed.error === 'string') { detail = parsed.error.replace(/[A-Za-z0-9_+/=-]{45,}/g, '[redacted]'); break; } } catch {} }
        reject(new Error(`child exit=${code} signal=${signal} during ${stage}${detail ? ': ' + detail : ''}`));
      }
    });
  });
  done.catch(() => {});
  return { child, done, output: () => output };
}
async function waitFor(check, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  do { const result = await check(); if (result) return result; await delay(250); } while (Date.now() < deadline);
  throw new Error(`Timed out during ${stage}`);
}
async function bounded(promise, timeout = 180_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Command timeout during ${stage}`)), timeout); })]); }
  finally { clearTimeout(timer); }
}
async function cli(args) {
  const p = start(process.execPath, [path.join(runtimeCliRoot, 'bin/happyherd.mjs'), ...args]);
  p.child.stdin.end();
  return bounded(p.done);
}
function jsonOutput(output) {
  for (const line of output.trim().split('\n').reverse()) { try { return JSON.parse(line); } catch {} }
  return JSON.parse(output);
}
async function record(name, values = {}) {
  receipt.stages.push({ name, at: new Date().toISOString(), ...values });
  await writeFile(path.join(artifactDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(`issue-321: ${name}`);
}
function providerPids(ownerPid) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => { const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/); return match && { pid: Number(match[1]), parent: Number(match[2]), executable: path.basename(match[3]) }; }).filter(Boolean);
  const descendants = new Set([ownerPid]);
  let changed;
  do { changed = false; for (const row of rows) if(descendants.has(row.parent) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; } } while(changed);
  return rows.filter(row => descendants.has(row.pid) && row.executable === 'codex').map(row => row.pid).sort((a,b) => a-b);
}
async function freePort() { const s = net.createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
const actualPort = await freePort();
const actual = `http://127.0.0.1:${actualPort}`;
async function proxy() {
  const sockets = new Set();
  let enabled = true;
  const p = http.createServer((request, response) => {
    if (!enabled) { response.writeHead(503); response.end('Disposable stale endpoint'); return; }
    const upstream = http.request(actual + request.url, { method: request.method, headers: request.headers }, r => { response.writeHead(r.statusCode, r.headers); r.pipe(response); });
    upstream.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(upstream);
  });
  p.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  p.on('upgrade', (request, client, head) => {
    if (!enabled) { client.destroy(); return; }
    const upstream = net.connect(actualPort, '127.0.0.1', () => {
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${Object.entries(request.headers).map(([k,v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy()); client.on('close', () => upstream.destroy());
  });
  await new Promise(r => p.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${p.address().port}`, disable() { enabled = false; for (const s of sockets) s.destroy(); }, close() { for (const s of sockets) s.destroy(); p.close(); } };
}
const a = await proxy(), b = await proxy();
env.HAPPYHERD_SERVER_URL = a.url; env.HAPPYHERD_WEBAPP_URL = b.url;
const masterSecret = randomBytes(32);
const identity = nacl.sign.keyPair.fromSeed(masterSecret);
let token;
async function api(route, body) {
  const response = await fetch(b.url + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  assert(response.ok, `API ${route} HTTP ${response.status}`); return response.json();
}
function box(value, recipient) { const ephemeral = nacl.box.keyPair(), nonce = randomBytes(24); return Buffer.concat([ephemeral.publicKey, nonce, nacl.box(value, nonce, recipient, ephemeral.secretKey)]); }
function decrypt(value) { const raw = Buffer.from(value, 'base64'); const clear = nacl.secretbox.open(raw.subarray(24), raw.subarray(0,24), masterSecret); assert(clear, 'Cannot decrypt isolated account record'); return JSON.parse(Buffer.from(clear).toString()); }
function encrypt(value) { const nonce = randomBytes(24); return b64(Buffer.concat([nonce, nacl.secretbox(Buffer.from(JSON.stringify(value)), nonce, masterSecret)])); }
async function session() { const result = await api('/v1/sessions'); const s = result.sessions.find(item => item.id === sessionId); assert(s, 'Same session missing from server'); return { ...s, metadata: decrypt(s.metadata) }; }
async function local(route, body = {}) { const state = JSON.parse(await readFile(path.join(cliHome, 'daemon.state.json'), 'utf8')); const r = await fetch(`http://127.0.0.1:${state.httpPort}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert(r.ok, `Local ${route}: HTTP ${r.status}`); return r.json(); }
async function rpc(method) { const machines = await api('/v1/machines'); assert.equal(machines.length, 1); const response = await socket.timeout(45_000).emitWithAck('rpc-call', { method: `${machines[0].id}:${method}`, params: encrypt({ sessionId }) }); assert(response.ok, `RPC ${method} failed`); return decrypt(response.result); }
function backupKey() { let bits = 0, buffer = 0, encoded = ''; for (const byte of masterSecret) { buffer = (buffer << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; encoded += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(buffer >>> bits) & 31]; } } if(bits) encoded += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(buffer << (5 - bits)) & 31]; return encoded.match(/.{1,5}/g).join('-'); }
try {
  const serverEnv = { PATH: process.env.PATH, DB_PROVIDER: 'pglite', DATA_DIR: path.join(privateDir, 'data'), PGLITE_DIR: path.join(privateDir, 'data/pglite'), HANDY_MASTER_SECRET: randomBytes(32).toString('hex'), HOST: '127.0.0.1', PORT: String(actualPort), METRICS_ENABLED: 'false', HAPPYHERD_STATIC_DIR: webExport, HAPPYHERD_INJECT_HTML_CONFIG: JSON.stringify({ serverUrl: b.url, disableAnalytics: true }) };
  const serverArgs = ['--import', path.join(root, 'server/node_modules/tsx/dist/loader.mjs'), 'sources/standalone.ts'];
  const serverOptions = { cwd: path.join(root, 'server/packages/happyherd-server'), env: serverEnv };
  stage = 'database migrations'; await bounded(start(process.execPath, [...serverArgs, 'migrate'], serverOptions).done);
  stage = 'server startup'; server = start(process.execPath, [...serverArgs, 'serve'], serverOptions);
  await waitFor(async () => { try { return (await fetch(actual + '/health')).ok; } catch { return false; } });
  await record('isolated-server-ready');
  stage = 'account and CLI pairing'; const challenge = randomBytes(32);
  ({ token } = await api('/v1/auth', { publicKey: b64(identity.publicKey), challenge: b64(challenge), signature: b64(nacl.sign.detached(challenge, identity.secretKey)) }));
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  const auth = start('/bin/sh', ['-c', `cat | script -q /dev/null ${quote(process.execPath)} ${quote(path.join(runtimeCliRoot, 'bin/happyherd.mjs'))} auth login`]);
  await waitFor(() => { if(auth.child.exitCode !== null) throw new Error('Pairing CLI exited before method selection'); return auth.output().includes('How would you like to authenticate?'); }); auth.child.stdin.write('1');
  // Retained pairing protocol; docs/cli-renaming.md requires these bytes.
  const publicKey = await waitFor(() => { const m = auth.output().match(/* rename:preserve */ /happy:\/\/terminal\?([A-Za-z0-9_-]+)/ /* /rename:preserve */); return m && Buffer.from(m[1], 'base64url'); });
  await api('/v1/auth/response', { publicKey: b64(publicKey), response: b64(box(masterSecret, publicKey)) });
  await waitFor(() => auth.output().includes('Authentication successful')); auth.child.stdin.end(); await bounded(auth.done);
  const commander = 'issue-321-proof';
  const manifest = path.join(privateDir, 'commander.json');
  await writeFile(manifest, JSON.stringify({ id: commander, name: 'Issue 321 proof', workspace, role: 'Disposable acceptance', commanderMarkdown: `---\nidentity_and_scope:\n  name: Issue 321 proof\n  commander_id: ${commander}\n  workspace: ${workspace}\n  role: Disposable acceptance\n---\nComplete only the requested harmless acceptance replies.\n` }));
  await cli(['commander', 'create', '--manifest', manifest]);
  stage = 'isolated daemon start'; await cli(['daemon', 'start']); daemonStarted = true;
  stage = 'Super Session create';
  const created = jsonOutput(await cli(['session', 'create', '--local', '--path', workspace, '--provider', 'codex', '--commander', commander, '--super-session', '--model', 'gpt-6-astra', '--effort', 'medium', '--permission', 'yolo', '--json']));
  sessionId = created.sessionId; assert(sessionId);
  const prompt = path.join(privateDir, 'prompt.txt');
  async function send(id, text) { await writeFile(prompt, text); return jsonOutput(await cli(['session', 'send', sessionId, '--text-file', prompt, '--message-id', id, '--json'])); }
  async function replies(marker) { const inspection = jsonOutput(await cli(['session', 'inspect', sessionId, '--limit', '100', '--json'])); return inspection.messages.filter(m => m.content?.role === 'session' && m.content.content?.role === 'agent' && m.content.content.ev?.t === 'text' && m.content.content.ev.text === marker); }
  stage = 'initial real Codex reply';
  await send('issue-321-initial', 'Reply with exactly INITIAL_321_OK. Do not use tools.');
  await waitFor(async () => (await replies('INITIAL_321_OK')).length > 0, 240_000);
  const before = await session(); const savedProviderAuth = await readFile(path.join(codexHome, 'auth.json')); const savedCliAuth = await readFile(path.join(cliHome, 'access.key')); const owners = await local('/list');
  const owner = owners.children.find(c => c.happySessionId === sessionId); assert(owner); assert(before.metadata.codexThreadId); const nativePids = providerPids(owner.pid); assert.equal(nativePids.length, 1, 'Expected exactly one native Codex process');
  await record('initial-real-codex-reply', { sessionId, threadId: before.metadata.codexThreadId, commander, wrapperPid: owner.pid, nativePids });
  stage = 'stale endpoint and isolated daemon move';
  await cli(['daemon', 'stop']); daemonStarted = false; process.kill(owner.pid, 0);
  a.disable(); env.HAPPYHERD_SERVER_URL = b.url;
  await cli(['daemon', 'start']); daemonStarted = true;
  socket = io(b.url, { path: '/v1/updates', transports: ['websocket'], auth: { token, clientType: 'user-scoped' } });
  await waitFor(() => socket.connected); process.kill(owner.pid, 0);
  await record('stale-endpoint-live-process', { wrapperPid: owner.pid, oldEndpoint: a.url, currentEndpoint: b.url, sessionActive: (await session()).active, staleHttpStatus: (await fetch(a.url + '/health')).status });
  if (baseline) { await record('baseline-reproduced'); }
  else {
    stage = 'supported status'; const status = await waitFor(async () => { const value = await rpc('session-transport-status'); return value.canRecover && value.errorCode === 'stale-endpoint' && value; });
    assert.equal(status.providerRunning, true); assert.equal(status.state, 'disconnected'); assert.equal(status.endpoint, a.url); assert.equal(status.currentEndpoint, b.url); assert.equal(status.pendingMessages, 'replay-on-reconnect');
    await record('supported-status', { status });
    stage = 'queued message'; const queued = await send('issue-321-queued', 'Reply with exactly RECOVERED_321_OK. Do not use tools.'); assert(queued.success);
    await record('input-persisted', { messageId: queued.messageId, seq: queued.seq });
    assert.equal((await replies('RECOVERED_321_OK')).length, 0, 'Disconnected input executed before recovery');
    const machinesForLabel = await api('/v1/machines'); assert.equal(machinesForLabel.length, 1);
    const machineForLabel = machinesForLabel[0];
    const labelResult = await socket.timeout(15_000).emitWithAck('machine-update-metadata', { machineId: machineForLabel.id, expectedVersion: machineForLabel.metadataVersion, metadata: encrypt({ ...decrypt(machineForLabel.metadata), displayName: 'Issue 321 disposable machine' }) });
    assert.equal(labelResult.result, 'success');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const pages = [];
    for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      stage = `${name} browser recovery`;
      const context = await browser.newContext({ viewport }); const page = await context.newPage();
      await page.goto(b.url + '/restore/manual');
      await page.getByRole('textbox').fill(backupKey());
      await page.getByText('Restore Account', { exact: true }).click();
      await page.waitForTimeout(1500);
      await page.goto(`${b.url}/session/${sessionId}`);
      const reconnect = page.getByRole('button', { name: 'Reconnect to current server', exact: true });
      try { await reconnect.waitFor({ timeout: 45_000 }); } catch (error) {
        await page.screenshot({ path: path.join(artifactDir, `${name}-session-failure.png`) });
        const visibleText = (await page.locator('body').innerText()).replaceAll(backupKey(), '[redacted]').replaceAll(masterSecret.toString('base64url'), '[redacted]');
        await writeFile(path.join(artifactDir, `${name}-visible-failure.txt`), visibleText);
        throw error;
      }
      await page.screenshot({ path: path.join(artifactDir, `${name}-disconnected.png`) });
      pages.push({ name, context, page, reconnect });
    }
    stage = 'desktop and mobile repeated recovery gestures';
    await Promise.all(pages.map(({ reconnect }) => reconnect.click()));
    await waitFor(async () => (await replies('RECOVERED_321_OK')).length > 0, 240_000);
    for (const { name, context, page, reconnect } of pages) {
      await reconnect.waitFor({ state: 'detached', timeout: 45_000 });
      const visibleReply = page.getByText('RECOVERED_321_OK', { exact: true });
      await visibleReply.waitFor({ state: 'visible', timeout: 45_000 });
      await visibleReply.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(artifactDir, `${name}-recovered.png`) });
      await record(`${name}-visible-recovery`);
      await context.close();
    }
    const after = await session(); assert.equal(after.id, before.id); assert.equal(after.metadata.codexThreadId, before.metadata.codexThreadId); assert.equal(after.metadata.commanderId, before.metadata.commanderId); assert.equal(after.metadata.path, before.metadata.path);
    assert.equal((await replies('RECOVERED_321_OK')).length, 1);
    const finalOwners = (await local('/list')).children.filter(c => c.happySessionId === sessionId); assert.equal(finalOwners.length, 1); assert.equal(finalOwners[0].pid, owner.pid); assert.deepEqual(providerPids(owner.pid), nativePids, 'Recovery changed native process ownership');
    assert((await readFile(path.join(codexHome, 'auth.json'))).equals(savedProviderAuth), 'Saved provider authentication changed during recovery');
    assert((await readFile(path.join(cliHome, 'access.key'))).equals(savedCliAuth), 'Saved CLI authentication changed during recovery');
    const recoveredStatus = await rpc('session-transport-status'); assert.equal(recoveredStatus.state, 'connected');
    await record('continuity-and-single-execution-confirmed', { sessionId, threadId: after.metadata.codexThreadId, commander, workspaceUnchanged: true, authenticationUnchanged: true, wrapperPid: owner.pid, nativePids, recoveredStatus });
  }
  receipt.success = true;
} catch(error) {
  receipt.success = false; receipt.failure = { stage, message: error.message };
  console.error(`issue-321 failed: ${stage}: ${error.message}`); process.exitCode = 1;
} finally {
  stage = 'cleanup';
  if(daemonStarted) { try { const owned = await local('/list'); for (const child of owned.children) await local('/stop-session', { sessionId: child.happySessionId }); } catch {} }
  if(daemonStarted) { try { await cli(['daemon', 'stop']); } catch {} }
  socket?.disconnect(); await browser?.close();
  a.close(); b.close();
  for(const child of children) child.kill('SIGTERM');
  receipt.finishedAt = new Date().toISOString(); await writeFile(path.join(artifactDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(`Sanitized receipt: ${path.join(artifactDir, 'receipt.json')}`);
}
