import { createHash, generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { Readable, Writable } from 'node:stream';
import type { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import {
  BrokerClient,
  createBrokerServer,
  parseBrokerClientConfig,
  parseBrokerServiceConfig,
  type BrokerClientConfig,
  type BrokerServiceConfig,
  validateDarwinClientConfigAclText,
  validateLinuxClientConfigAclText,
} from './broker';
import type { IssuerCredentialRecord, SecretStore } from './secretStore';
import {
  installSkillBundle,
  UNIVERSAL_SKILL_EXCLUSION_PATTERNS,
  type InstalledSkillBundle,
  type SkillBundleFile,
} from './skills';
import { registerInstalledSkillBundle } from './registry';

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

class MemoryVault implements SecretStore {
  record: IssuerCredentialRecord | null = null;
  set(record: IssuerCredentialRecord): void { this.record = record; }
  get(issuer: string): IssuerCredentialRecord | null { return this.record?.issuer === issuer ? this.record : null; }
  delete(): boolean { this.record = null; return true; }
  deleteAll(): number { const count = this.record ? 1 : 0; this.record = null; return count; }
  diagnostic(): string { return 'memory broker vault'; }
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function completedToolProcess(stdout: string, stderr: string, status = 0): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdout = Readable.from([stdout]);
  child.stderr = Readable.from([stderr]);
  child.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  child.kill = (() => true) as ChildProcessWithoutNullStreams['kill'];
  setImmediate(() => child.emit('close', status, null));
  return child;
}

function pendingToolProcess(onKill: (signal: NodeJS.Signals | number | undefined) => void): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdout = new Readable({ read: () => undefined });
  child.stderr = new Readable({ read: () => undefined });
  child.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  child.kill = ((signal?: NodeJS.Signals | number) => {
    onKill(signal);
    child.stdout.push(null);
    child.stderr.push(null);
    setImmediate(() => child.emit('close', null, signal ?? 'SIGTERM'));
    return true;
  }) as ChildProcessWithoutNullStreams['kill'];
  return child;
}

async function fixture(dependencies: Parameters<typeof createBrokerServer>[2] = {}): Promise<{
  server: Server;
  url: string;
  service: BrokerServiceConfig;
  client: BrokerClientConfig;
  vault: MemoryVault;
  directory: string;
}> {
  const directory = mkdtempSync(join(tmpdir(), 'happyherd-broker-'));
  directories.push(directory);
  const stateRoot = join(directory, 'state');
  const installationRoot = join(directory, 'install');
  mkdirSync(stateRoot, { mode: 0o700 });
  mkdirSync(installationRoot, { mode: 0o755 });
  const capability = 'a'.repeat(64);
  const capabilityPath = join(stateRoot, 'client-capability');
  writeFileSync(capabilityPath, `${capability}\n`, { mode: 0o600 });
  chmodSync(capabilityPath, 0o600);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePath = join(stateRoot, 'signing-private.pem');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  chmodSync(privatePath, 0o600);
  const ownerIdentity = process.platform === 'win32' ? 'sid:S-1-5-21-1000' : 'uid:1000';
  const serviceIdentity = process.platform === 'win32' ? 'nt-service:HappyHerdBroker' : 'uid:999';
  const toolIdentity = process.platform === 'win32' ? 'local-user:HappyHerdTool' : 'uid:998';
  const toolLauncher = join(installationRoot, process.platform === 'win32' ? 'tool-launcher.exe' : 'tool-launcher');
  writeFileSync(toolLauncher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  chmodSync(toolLauncher, 0o755);
  const service: BrokerServiceConfig = {
    schemaVersion: 1,
    product: 'HappyHerd',
    listen: { host: '127.0.0.1', port: 32199 },
    ownerIdentity,
    serviceIdentity,
    clientCapabilityPath: capabilityPath,
    signingPrivateKeyPath: privatePath,
    stateRoot,
    bundleRoot: join(stateRoot, 'bundles'),
    registryRoot: join(stateRoot, 'registry'),
    providerRoots: { claude: join(directory, 'claude'), codex: join(directory, 'codex') },
    installationRoot,
    nodeRuntime: join(installationRoot, 'node'),
    pythonRuntime: join(installationRoot, 'python'),
    toolLauncher,
    toolLauncherConfig: join(installationRoot, 'tool-launcher.json'),
    toolIdentity,
  };
  const vault = new MemoryVault();
  const server = createBrokerServer(service, '1.2.1-beta.1', {
    vault,
    currentIdentity: serviceIdentity,
    runtimeValidation: () => ({ nodeVersion: '20.19.0', pythonVersion: '3.13.7', timezone: 'America/New_York' }),
    ...dependencies,
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test broker did not bind TCP');
  const url = `http://127.0.0.1:${address.port}`;
  const client: BrokerClientConfig = {
    schemaVersion: 1,
    product: 'HappyHerd',
    brokerUrl: url,
    clientCapability: capability,
    signingPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    ownerIdentity,
    serviceIdentity,
  };
  return { server, url, service, client, vault, directory };
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function zip(entries: Array<{ path: string; bytes: Buffer }>): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  for (const entry of entries) archive.addBuffer(entry.bytes, entry.path, { mode: 0o100644 });
  archive.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.once('error', reject);
    archive.outputStream.once('end', () => resolve(Buffer.concat(chunks)));
  });
}

async function registerToolFixture(instance: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const script = Buffer.from('print("verified")\n');
  const skill = Buffer.from('# Generic Guide\n');
  const files: SkillBundleFile[] = [
    { path: 'generic-guide/SKILL.md', sizeBytes: skill.length, mode: 0o644, sha256: sha256(skill) },
    { path: 'generic-guide/scripts/check.py', sizeBytes: script.length, mode: 0o755, sha256: sha256(script) },
  ];
  const records = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map((file) => ({ mode: file.mode, path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes }));
  const manifest = {
    schemaVersion: 1,
    product: { name: 'Example', baseUrl: 'https://issuer.example/api', docsUrl: 'https://issuer.example/docs' },
    artifact: {
      id: 'generic-bundle', version: '1', format: 'zip', minHappyHerdVersion: '1.2.1-beta.1',
      skills: ['generic-guide'], contentSha256: sha256(JSON.stringify(records)),
    },
    source: { sha: 'a'.repeat(40) }, permissions: {},
    exclusions: { policy: 'example-allowlist', patterns: [...UNIVERSAL_SKILL_EXCLUSION_PATTERNS] }, files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const bytes = await zip([
    { path: 'manifest.json', bytes: manifestBytes },
    { path: files[0].path, bytes: skill },
    { path: files[1].path, bytes: script },
  ]);
  const source = join(instance.directory, 'bundle.zip');
  writeFileSync(source, bytes);
  const installed = await installSkillBundle({
    source,
    expectedSha256: sha256(bytes),
    expectedManifestSha256: sha256(manifestBytes),
    currentHappyHerdVersion: '1.2.1-beta.1',
    root: instance.service.bundleRoot,
  });
  registerInstalledSkillBundle(installed, {
    providerRoots: instance.service.providerRoots,
    registryRoot: instance.service.registryRoot,
    issuer: 'https://issuer.example',
  });
  return installed.path;
}

describe('OS-separated broker IPC', () => {
  it('accepts only a canonical Ed25519 broker trust anchor', () => {
    const publicKey = generateKeyPairSync('ed25519').publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const base = {
      schemaVersion: 1,
      product: 'HappyHerd',
      brokerUrl: 'http://127.0.0.1:32199',
      clientCapability: 'a'.repeat(64),
      ownerIdentity: 'uid:1000',
      serviceIdentity: 'uid:999',
    };

    expect(parseBrokerClientConfig({ ...base, signingPublicKey: publicKey }).signingPublicKey).toBe(publicKey);
    expect(parseBrokerClientConfig({
      ...base,
      signingPublicKey: publicKey.replace(/\n/g, '\r\n'),
    }).signingPublicKey).toBe(publicKey);

    const rsaPublicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    expect(() => parseBrokerClientConfig({ ...base, signingPublicKey: rsaPublicKey })).toThrow('signingPublicKey is invalid');
    expect(() => parseBrokerClientConfig({ ...base, signingPublicKey: `${publicKey}\n` })).toThrow('signingPublicKey is invalid');
    expect(() => parseBrokerClientConfig({ ...base, signingPublicKey: `${publicKey}\u0000` })).toThrow('signingPublicKey is invalid');
  });

  it('parses the exact service configuration emitted by the native installers', () => {
    const installerConfig = {
      schemaVersion: 1,
      product: 'HappyHerd',
      listen: { host: '127.0.0.1', port: 32199 },
      ownerIdentity: 'uid:1000',
      serviceIdentity: 'uid:999',
      clientCapabilityPath: '/var/lib/happyherd/state/client-capability',
      signingPrivateKeyPath: '/var/lib/happyherd/state/signing-private.pem',
      stateRoot: '/var/lib/happyherd/state',
      bundleRoot: '/var/lib/happyherd/state/bundles',
      registryRoot: '/var/lib/happyherd/state/registry',
      providerRoots: {
        claude: '/home/user/.claude/skills',
        codex: '/home/user/.codex/skills',
      },
      installationRoot: '/opt/happyherd/1000',
      nodeRuntime: '/opt/happyherd/1000/native/node',
      pythonRuntime: '/opt/happyherd/1000/native/python/bin/python3',
      toolLauncher: '/opt/happyherd/1000/native/happyherd-tool-launcher',
      toolLauncherConfig: '/var/lib/happyherd/state/tool-launcher.conf',
      toolIdentity: 'uid:998',
    };

    expect(parseBrokerServiceConfig(installerConfig)).toEqual(installerConfig);
  });

  it('requires an exclusive owner read ACL for Unix client capabilities', () => {
    const linux = 'user::rw-\nuser:1000:r--\ngroup::---\nmask::r--\nother::---\n';
    expect(() => validateLinuxClientConfigAclText(linux, 1000)).not.toThrow();
    expect(() => validateLinuxClientConfigAclText(`${linux}user:1001:r--\n`, 1000)).toThrow(/exclusive/);
    const darwin = '-rw-------+ 1 root wheel 1 Aug 17 00:00 broker.json\n 0: user:owner.name allow read\n';
    expect(() => validateDarwinClientConfigAclText(darwin, 'owner.name')).not.toThrow();
    expect(() => validateDarwinClientConfigAclText(`${darwin} 1: user:spy allow read\n`, 'owner.name')).toThrow(/exclusive/);
  });

  it('requires a different configured service identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'happyherd-broker-identity-'));
    directories.push(directory);
    mkdirSync(join(directory, 'state'), { mode: 0o700 });
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(join(directory, 'state', 'capability'), `${'a'.repeat(64)}\n`, { mode: 0o600 });
    writeFileSync(join(directory, 'state', 'private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    const identity = process.platform === 'win32' ? 'sid:S-1-5-21-1000' : 'uid:1000';
    const config: BrokerServiceConfig = {
      schemaVersion: 1,
      product: 'HappyHerd',
      listen: { host: '127.0.0.1', port: 32000 },
      ownerIdentity: identity,
      serviceIdentity: identity as BrokerServiceConfig['serviceIdentity'],
      clientCapabilityPath: join(directory, 'state', 'capability'),
      signingPrivateKeyPath: join(directory, 'state', 'private.pem'),
      stateRoot: join(directory, 'state'),
      bundleRoot: join(directory, 'state', 'bundles'),
      registryRoot: join(directory, 'state', 'registry'),
      providerRoots: { claude: join(directory, 'claude'), codex: join(directory, 'codex') },
      installationRoot: directory,
      nodeRuntime: join(directory, 'node'),
      pythonRuntime: join(directory, 'python'),
      toolLauncher: join(directory, 'tool-launcher'),
      toolLauncherConfig: join(directory, 'tool-launcher.json'),
      toolIdentity: process.platform === 'win32' ? 'local-user:HappyHerdTool' : 'uid:998',
    };
    expect(() => createBrokerServer(config, '1.2.1-beta.1', {
      currentIdentity: identity,
      runtimeValidation: () => ({ nodeVersion: '20', pythonVersion: '3.13', timezone: 'America/New_York' }),
    })).toThrow('must differ');
  });

  it('authenticates the real broker with a signed nonce and verifies protected runtime status', async () => {
    const instance = await fixture();
    const client = new BrokerClient({ config: instance.client });
    await expect(client.ping()).resolves.toEqual({ version: '1.2.1-beta.1', serviceIdentity: instance.service.serviceIdentity });
    await expect(client.status()).resolves.toContain('Python 3.13.7 with tzdata');

    const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const forged = new BrokerClient({ config: { ...instance.client, signingPublicKey: other } });
    await expect(forged.ping()).rejects.toThrow('signature is invalid');
  });

  it('rejects unauthorized, unknown, and over-broad IPC requests', async () => {
    const instance = await fixture();
    const post = (body: unknown, capability = instance.client.clientCapability) => fetch(`${instance.url}/v1/request`, {
      method: 'POST',
      headers: { Authorization: `HappyHerd-Broker ${capability}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await expect((await post({ schemaVersion: 1, operation: 'status' }, 'b'.repeat(64))).status).toBe(401);
    const unknown = await post({ schemaVersion: 1, operation: 'read-secret' });
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).not.toContain('accessToken');
    const extra = await post({ schemaVersion: 1, operation: 'status', path: '/etc/passwd' });
    expect(extra.status).toBe(400);
    const traversal = await post({
      schemaVersion: 1,
      operation: 'run-tool',
      issuer: 'https://issuer.example',
      skill: 'guide',
      script: '../../secret',
      args: [],
    });
    expect(traversal.status).toBe(400);
  });

  it('stores a device token only in the broker vault and never returns or prints it', async () => {
    const issuer = 'https://issuer.example';
    const requestId = '123e4567-e89b-42d3-a456-426614174000';
    const token = 'broker-only-token-value-that-is-long-enough';
    const responses = [
      json(200, {
        schemaVersion: 1,
        issuer,
        displayName: 'Example Organization',
        deviceAuthorizationEndpoint: `${issuer}/api/agent-toolkit/device-authorizations`,
        tokenEndpoint: `${issuer}/api/agent-toolkit/device-authorizations/token`,
        verificationUri: `${issuer}/agent-toolkit`,
      }),
      json(201, {
        requestId,
        deviceSecret: 's'.repeat(48),
        userCode: 'ABCD-EFGH',
        verificationUri: `${issuer}/agent-toolkit`,
        expiresIn: 600,
        interval: 1,
      }),
      json(200, {
        tokenType: 'Bearer',
        accessToken: token,
        expiresAt: '2027-01-01T00:00:00Z',
        scopes: ['guide.read'],
      }),
    ];
    const instance = await fixture({
      fetch: (async () => {
        const response = responses.shift();
        if (!response) throw new Error('unexpected issuer request');
        return response;
      }) as typeof fetch,
      sleep: async () => undefined,
      now: () => Date.parse('2026-08-17T00:00:00Z'),
    });
    const output: string[] = [];
    const client = new BrokerClient({ config: instance.client, stdout: (line) => output.push(line), openBrowser: () => undefined });
    const result = await client.connect(issuer, '1.2.1-beta.1');
    expect(result).toEqual({ expiresAt: '2027-01-01T00:00:00Z', scopes: ['guide.read'], skillBundleAvailable: false });
    expect(instance.vault.record?.accessToken).toBe(token);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(output.join('\n')).not.toContain(token);
    expect(responses).toHaveLength(0);
  });

  it('serializes Skill installation and releases the mutation slot after success', async () => {
    let releaseInstall!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseInstall = resolve; });
    let installCalls = 0;
    let registerCalls = 0;
    const installed = {
      id: 'generic-bundle',
      version: '1',
      skills: ['generic-guide'],
    } as InstalledSkillBundle;
    const instance = await fixture({
      installBundle: (async () => {
        installCalls += 1;
        if (installCalls === 1) await blocked;
        return installed;
      }),
      registerBundle: (() => {
        registerCalls += 1;
        return { registeredSkills: 1, detail: 'ready' };
      }),
    });
    instance.vault.record = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken: 'install-token-that-is-long-enough',
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
      skillBundle: {
        url: 'https://issuer.example/bundle.zip',
        sha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
      },
    };
    const firstClient = new BrokerClient({ config: instance.client });
    const first = firstClient.installSkills('https://issuer.example');
    while (installCalls === 0) await new Promise((resolve) => setImmediate(resolve));
    const secondClient = new BrokerClient({ config: instance.client });
    await expect(secondClient.installSkills('https://issuer.example')).rejects.toThrow('already running');
    expect(installCalls).toBe(1);
    expect(registerCalls).toBe(0);
    releaseInstall();
    await expect(first).resolves.toMatchObject({ id: 'generic-bundle', registry: 'ready' });
    await expect(secondClient.installSkills('https://issuer.example')).resolves.toMatchObject({ id: 'generic-bundle' });
    expect(installCalls).toBe(2);
    expect(registerCalls).toBe(2);
  });

  it('releases the Skill installation mutation slot after an exception', async () => {
    let installCalls = 0;
    const installed = {
      id: 'generic-bundle',
      version: '1',
      skills: ['generic-guide'],
    } as InstalledSkillBundle;
    const instance = await fixture({
      installBundle: (async () => {
        installCalls += 1;
        if (installCalls === 1) throw new Error('injected download failure');
        return installed;
      }),
      registerBundle: () => ({ registeredSkills: 1, detail: 'ready' }),
    });
    instance.vault.record = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken: 'install-token-that-is-long-enough',
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
      skillBundle: {
        url: 'https://issuer.example/bundle.zip',
        sha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
      },
    };
    const client = new BrokerClient({ config: instance.client });
    await expect(client.installSkills('https://issuer.example')).rejects.toThrow('injected download failure');
    await expect(client.installSkills('https://issuer.example')).resolves.toMatchObject({ id: 'generic-bundle' });
    expect(installCalls).toBe(2);
  });

  it('runs only a verified broker-owned tool with an exact child environment and sanitized output', async () => {
    const token = 'broker-child-token-that-must-never-escape';
    const legitimateLargeOutput = 'x'.repeat(96 * 1024);
    const calls: Array<{ command: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const instance = await fixture({
      spawnTool: ((command: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
        calls.push({ command, args, env: options.env ?? {} });
        return completedToolProcess(`${legitimateLargeOutput}${token}\n`, `\u001b[31m${token}\u001b[0m`);
      }) as typeof spawn,
    });
    mkdirSync(join(instance.service.installationRoot, 'python-dir'), { recursive: true });
    writeFileSync(instance.service.pythonRuntime, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(instance.service.pythonRuntime, 0o755);
    const bundlePath = await registerToolFixture(instance);
    instance.vault.record = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken: token,
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
    };
    const client = new BrokerClient({ config: instance.client });
    const result = await client.runTool('https://issuer.example', 'generic-guide', 'scripts/check.py', ['--read']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(legitimateLargeOutput);
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
    expect(`${result.stdout}${result.stderr}`).not.toContain('\u001b');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(instance.service.toolLauncher);
    expect(calls[0]?.args).toEqual([
      '--config', instance.service.toolLauncherConfig,
      '--runtime', 'python',
      '--script', join(bundlePath, 'generic-guide', 'scripts', 'check.py'),
      '--cwd', join(bundlePath, 'generic-guide'),
      '--', '--read',
    ]);
    expect(calls[0]?.env).toEqual({
      HAPPYHERD_ACCESS_TOKEN: token,
      HAPPYHERD_ISSUER: 'https://issuer.example',
      HAPPYHERD_API_BASE_URL: 'https://issuer.example/api',
    });
    writeFileSync(join(bundlePath, 'generic-guide', 'scripts', 'check.py'), 'tampered\n');
    await expect(client.runTool('https://issuer.example', 'generic-guide', 'scripts/check.py', [])).rejects.toThrow('stale');
    expect(calls).toHaveLength(1);
  });

  it('fails closed when a verified tool exceeds either captured-stream limit', async () => {
    const instance = await fixture({
      spawnTool: (() => completedToolProcess('x'.repeat(1_048_577), '')) as unknown as typeof spawn,
    });
    writeFileSync(instance.service.pythonRuntime, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(instance.service.pythonRuntime, 0o755);
    await registerToolFixture(instance);
    instance.vault.record = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken: 'bounded-output-token-that-is-long-enough',
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
    };
    const client = new BrokerClient({ config: instance.client });
    await expect(client.runTool(
      'https://issuer.example',
      'generic-guide',
      'scripts/check.py',
      [],
    )).rejects.toThrow('stdout exceeded the 1 MiB limit');
  });

  it('kills the isolated launcher when the requesting client disconnects', async () => {
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    let killedResolve!: (signal: NodeJS.Signals | number | undefined) => void;
    const killed = new Promise<NodeJS.Signals | number | undefined>((resolve) => { killedResolve = resolve; });
    let useCompletedProcess = false;
    const instance = await fixture({
      spawnTool: (() => {
        if (useCompletedProcess) return completedToolProcess('recovered\n', '');
        startedResolve();
        return pendingToolProcess(killedResolve);
      }) as unknown as typeof spawn,
    });
    writeFileSync(instance.service.pythonRuntime, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(instance.service.pythonRuntime, 0o755);
    await registerToolFixture(instance);
    instance.vault.record = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken: 'disconnect-token-that-is-long-enough',
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
    };
    const controller = new AbortController();
    const pending = fetch(`${instance.url}/v1/request`, {
      method: 'POST',
      headers: {
        Authorization: `HappyHerd-Broker ${instance.client.clientCapability}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        schemaVersion: 1,
        operation: 'run-tool',
        issuer: 'https://issuer.example',
        skill: 'generic-guide',
        script: 'scripts/check.py',
        args: [],
      }),
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(Promise.race([
      killed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('launcher was not killed')), 1_000)),
    ])).resolves.toBe('SIGKILL');
    useCompletedProcess = true;
    const client = new BrokerClient({ config: instance.client });
    await expect(client.runTool(
      'https://issuer.example',
      'generic-guide',
      'scripts/check.py',
      [],
    )).resolves.toMatchObject({ status: 0, stdout: 'recovered\n' });
  });

  it('never overlaps token-bearing tools and releases the global slot after completion', async () => {
    let firstChild: ChildProcessWithoutNullStreams | null = null;
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => { startedResolve = resolve; });
    let spawnCalls = 0;
    const instance = await fixture({
      spawnTool: (() => {
        spawnCalls += 1;
        if (spawnCalls > 1) return completedToolProcess('second\n', '');
        firstChild = new EventEmitter() as ChildProcessWithoutNullStreams;
        firstChild.stdout = new Readable({ read: () => undefined });
        firstChild.stderr = new Readable({ read: () => undefined });
        firstChild.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
        firstChild.kill = (() => true) as ChildProcessWithoutNullStreams['kill'];
        startedResolve();
        return firstChild;
      }) as unknown as typeof spawn,
    });
    writeFileSync(instance.service.pythonRuntime, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    chmodSync(instance.service.pythonRuntime, 0o755);
    await registerToolFixture(instance);
    instance.vault.record = {
      schemaVersion: 1,
      issuer: 'https://issuer.example',
      tokenType: 'Bearer',
      accessToken: 'serialized-token-that-is-long-enough',
      expiresAt: '2027-01-01T00:00:00Z',
      scopes: ['guide.read'],
      connectedAt: '2026-08-17T00:00:00Z',
    };
    const firstClient = new BrokerClient({ config: instance.client });
    const first = firstClient.runTool('https://issuer.example', 'generic-guide', 'scripts/check.py', []);
    await started;
    const secondClient = new BrokerClient({ config: instance.client });
    await expect(secondClient.runTool(
      'https://issuer.example',
      'generic-guide',
      'scripts/check.py',
      [],
    )).rejects.toThrow('already running');
    expect(spawnCalls).toBe(1);
    const runningChild = firstChild as ChildProcessWithoutNullStreams | null;
    if (!runningChild) throw new Error('first child did not start');
    runningChild.stdout.push('first\n');
    runningChild.stdout.push(null);
    runningChild.stderr.push(null);
    runningChild.emit('close', 0, null);
    await expect(first).resolves.toMatchObject({ status: 0, stdout: 'first\n' });
    await expect(secondClient.runTool(
      'https://issuer.example',
      'generic-guide',
      'scripts/check.py',
      [],
    )).resolves.toMatchObject({ status: 0, stdout: 'second\n' });
    expect(spawnCalls).toBe(2);
  });
});
