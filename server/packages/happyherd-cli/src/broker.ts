/**
 * Narrow IPC boundary between an untrusted same-user agent session and the
 * OS-separated HappyHerd broker service. The client capability authorizes only
 * the operations defined here; no response schema has a credential field.
 */

import {
  createPublicKey,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { connectIssuer, openApprovalUrl, type ConnectEvent } from './deviceFlow';
import { normalizeIssuer } from './contracts';
import { installSkillBundle, descriptorFromCredential, type InstalledSkillBundle } from './skills';
import {
  registerInstalledSkillBundle,
  validateManagedSkillRegistry,
  type ProviderRoots,
  type RegistryOptions,
  type RegistryReport,
} from './registry';
import { executeManagedTool } from './toolRunner';
import { KeyringSecretStore, type SecretStore } from './secretStore';
import { readBoundedJson } from './boundedResponse';

const MAX_REQUEST_BYTES = 64 * 1024;
// A verified tool may return up to 1 MiB on each captured stream. JSON escaping
// can double ASCII quotes/backslashes, so the client keeps a hard 5 MiB ceiling
// while request and device-event bounds remain much smaller.
const MAX_BROKER_JSON_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 32 * 1024;

export function isolatedChildEnvironment(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (platform !== 'win32') return {};
  const systemRoot = Object.entries(environment)
    .find(([name]) => name.toLowerCase() === 'systemroot')?.[1];
  if (
    typeof systemRoot !== 'string'
    || systemRoot.length === 0
    || systemRoot.length > 4096
    || /[\u0000-\u001f\u007f-\u009f]/.test(systemRoot)
    || !win32.isAbsolute(systemRoot)
  ) throw new Error('Windows SystemRoot is unavailable for an isolated child process');
  return { SystemRoot: systemRoot };
}

export interface BrokerServiceConfig {
  schemaVersion: 1;
  product: 'HappyHerd';
  listen: { host: '127.0.0.1'; port: number };
  ownerIdentity: string;
  serviceIdentity: string;
  clientCapabilityPath: string;
  signingPrivateKeyPath: string;
  stateRoot: string;
  bundleRoot: string;
  registryRoot: string;
  providerRoots: ProviderRoots;
  installationRoot: string;
  nodeRuntime: string;
  pythonRuntime: string;
  toolLauncher: string;
  toolLauncherConfig: string;
  toolIdentity: string;
}

export interface BrokerClientConfig {
  schemaVersion: 1;
  product: 'HappyHerd';
  brokerUrl: string;
  clientCapability: string;
  signingPublicKey: string;
  ownerIdentity: string;
  serviceIdentity: string;
}

type BrokerRequest =
  | { schemaVersion: 1; operation: 'ping'; nonce: string }
  | { schemaVersion: 1; operation: 'status' }
  | { schemaVersion: 1; operation: 'connect'; issuer: string; clientVersion: string }
  | { schemaVersion: 1; operation: 'disconnect'; issuer?: string; all?: true }
  | { schemaVersion: 1; operation: 'install-skills'; issuer: string }
  | { schemaVersion: 1; operation: 'run-tool'; issuer: string; skill: string; script: string; args: string[] };

export interface BrokerDependencies {
  vault?: SecretStore;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  currentIdentity?: string;
  spawnTool?: typeof spawn;
  runtimeValidation?: () => BrokerRuntimeReport;
  installBundle?: typeof installSkillBundle;
  registerBundle?: (
    bundle: InstalledSkillBundle,
    registration: RegistryOptions & { issuer?: string },
  ) => RegistryReport;
}

export interface BrokerRuntimeReport {
  nodeVersion: string;
  pythonVersion: string;
  timezone: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has unexpected keys`);
  }
}

function strictString(value: unknown, label: string, maximum: number, pattern?: RegExp): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || /[\u0000-\u001f\u007f-\u009f]/.test(value)
    || (pattern && !pattern.test(value))
  ) throw new Error(`${label} is invalid`);
  return value;
}

function canonicalSigningPublicKey(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 4096
    || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)
  ) throw new Error('signingPublicKey is invalid');

  let key;
  try {
    key = createPublicKey(value);
  } catch {
    throw new Error('signingPublicKey is invalid');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('signingPublicKey is invalid');

  const canonical = key.export({ type: 'spki', format: 'pem' }).toString();
  if (value.replace(/\r\n/g, '\n') !== canonical) throw new Error('signingPublicKey is invalid');
  return canonical;
}

function absolutePath(value: unknown, label: string): string {
  const path = strictString(value, label, 4096);
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error(`${label} must be an absolute normalized path`);
  return path;
}

function cleanLoopbackUrl(value: unknown): string {
  const url = new URL(strictString(value, 'brokerUrl', 256));
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== '/'
  ) throw new Error('brokerUrl must be a clean IPv4 loopback HTTP origin');
  return url.origin;
}

function protectedFile(path: string, label: string): string {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
    throw new Error(`${label} is missing or unsafe`);
  }
  if (process.platform === 'win32') {
    verifyWindowsProtectedPaths([{ kind: 'file', path }], label);
  } else if ((statSync(path).mode & 0o077) !== 0) {
    throw new Error(`${label} must not be accessible to group or other users`);
  }
  return readFileSync(path, 'utf8').trim();
}

function windowsVerifierDiagnostic(
  result: SpawnSyncReturns<string>,
  verifier: string,
  installationRoot: string,
): string {
  if (!result.error) {
    return result.stderr.trim().replace(/\s+/g, ' ').slice(0, 512)
      || `verifier exited ${String(result.status)}`;
  }
  const error = result.error as NodeJS.ErrnoException & { path?: string; spawnargs?: string[] };
  const bounded = (value: unknown): string => String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .slice(0, 512);
  return [
    `verifier process failed (${bounded(error.code || error.name)})`,
    `errno=${bounded(error.errno)}`,
    `syscall=${bounded(error.syscall)}`,
    `path=${bounded(error.path)}`,
    `spawnargs=${bounded(error.spawnargs?.join(' '))}`,
    `inheritedCwd=${bounded(process.cwd())}`,
    `spawnCwd=${bounded(installationRoot)}`,
    `verifier=${bounded(verifier)}`,
  ].join('; ').slice(0, 2048);
}

function verifyWindowsProtectedPaths(
  entries: Array<{ kind: 'file' | 'directory'; path: string }>,
  label: string,
): void {
  if (process.platform !== 'win32' || process.env.HAPPYHERD_NATIVE_INSTALLATION !== '1') return;
  const installationRoot = dirname(dirname(resolve(process.execPath)));
  const verifier = join(installationRoot, 'service', 'happyherd-acl-check.exe');
  if (!existsSync(verifier) || lstatSync(verifier).isSymbolicLink() || !statSync(verifier).isFile()) {
    throw new Error(`${label} ACL verifier is missing or unsafe`);
  }
  const args = entries.flatMap((entry) => [entry.kind === 'file' ? '--file' : '--directory', resolve(entry.path)]);
  const result = spawnSync(verifier, args, {
    cwd: installationRoot,
    encoding: 'utf8',
    env: isolatedChildEnvironment(),
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const verifierDiagnostic = windowsVerifierDiagnostic(result, verifier, installationRoot);
    throw new Error(`${label} Windows ACL verification failed: ${verifierDiagnostic}`);
  }
}

function escapedRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateLinuxClientConfigAclText(text: string, ownerUid: number): void {
  const actual = text.split(/\r?\n/).filter(Boolean).sort();
  const expected = [
    'group::---',
    'mask::r--',
    'other::---',
    `user:${ownerUid}:r--`,
    'user::rw-',
  ].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('HappyHerd broker client configuration Linux ACL is not exclusive to its owner');
  }
}

export function validateDarwinClientConfigAclText(text: string, ownerName: string): void {
  if (!/^[A-Za-z0-9._-]{1,255}$/.test(ownerName)) {
    throw new Error('HappyHerd broker client configuration owner account is invalid');
  }
  const entries = text.split(/\r?\n/).filter((line) => /^\s*\d+:/.test(line));
  const expected = new RegExp(`^\\s*0: user:${escapedRegularExpression(ownerName)} allow read\\s*$`);
  if (entries.length !== 1 || !expected.test(entries[0])) {
    throw new Error('HappyHerd broker client configuration macOS ACL is not exclusive to its owner');
  }
}

function verifyUnixClientConfigAcl(path: string, ownerUid: number): void {
  const metadata = statSync(path);
  if (metadata.uid !== 0 || metadata.gid !== 0) {
    throw new Error('HappyHerd broker client configuration is not administrator-owned');
  }
  if (process.platform === 'linux') {
    if ((metadata.mode & 0o777) !== 0o640) {
      throw new Error('HappyHerd broker client configuration Linux mode does not match its ACL mask');
    }
    const result = spawnSync('/usr/bin/getfacl', [
      '--absolute-names', '--numeric', '--omit-header', '--', path,
    ], { encoding: 'utf8', env: isolatedChildEnvironment(), timeout: 10_000, maxBuffer: 64 * 1024 });
    if (result.error || result.status !== 0 || result.stderr) {
      throw new Error('HappyHerd broker client configuration Linux ACL could not be verified');
    }
    validateLinuxClientConfigAclText(result.stdout, ownerUid);
    return;
  }
  if (process.platform === 'darwin') {
    if ((metadata.mode & 0o777) !== 0o600) {
      throw new Error('HappyHerd broker client configuration macOS mode is not private');
    }
    const identity = spawnSync('/usr/bin/id', ['-un', String(ownerUid)], {
      encoding: 'utf8', env: isolatedChildEnvironment(), timeout: 10_000, maxBuffer: 4096,
    });
    if (identity.error || identity.status !== 0 || identity.stderr) {
      throw new Error('HappyHerd broker client configuration owner account could not be verified');
    }
    const ownerName = identity.stdout.trim();
    const acl = spawnSync('/bin/ls', ['-lde', path], {
      encoding: 'utf8', env: isolatedChildEnvironment(), timeout: 10_000, maxBuffer: 64 * 1024,
    });
    if (acl.error || acl.status !== 0 || acl.stderr) {
      throw new Error('HappyHerd broker client configuration macOS ACL could not be verified');
    }
    validateDarwinClientConfigAclText(acl.stdout, ownerName);
  }
}

function verifyWindowsClientConfig(path: string, ownerSid: string): void {
  if (process.platform !== 'win32' || process.env.HAPPYHERD_NATIVE_INSTALLATION !== '1') return;
  const installationRoot = dirname(dirname(resolve(process.execPath)));
  const verifier = join(installationRoot, 'service', 'happyherd-acl-check.exe');
  const result = spawnSync(verifier, ['--client-file', resolve(path), ownerSid], {
    cwd: installationRoot,
    encoding: 'utf8',
    env: isolatedChildEnvironment(),
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const verifierDiagnostic = windowsVerifierDiagnostic(result, verifier, installationRoot);
    throw new Error(`HappyHerd broker client configuration Windows ACL verification failed: ${verifierDiagnostic}`);
  }
}

export function currentBrokerIdentity(): string {
  if (process.platform === 'win32') {
    return process.env.HAPPYHERD_BROKER_SERVICE_IDENTITY ?? 'untrusted-windows-process';
  }
  if (!process.getuid) throw new Error('broker cannot determine its OS user identity');
  return `uid:${process.getuid()}`;
}

export function parseBrokerServiceConfig(value: unknown): BrokerServiceConfig {
  const config = objectValue(value, 'broker service config');
  exactKeys(config, [
    'schemaVersion',
    'product',
    'listen',
    'ownerIdentity',
    'serviceIdentity',
    'clientCapabilityPath',
    'signingPrivateKeyPath',
    'stateRoot',
    'bundleRoot',
    'registryRoot',
    'providerRoots',
    'installationRoot',
    'nodeRuntime',
    'pythonRuntime',
    'toolLauncher',
    'toolLauncherConfig',
    'toolIdentity',
  ], 'broker service config');
  if (config.schemaVersion !== 1 || config.product !== 'HappyHerd') {
    throw new Error('broker service config identity is invalid');
  }
  const listen = objectValue(config.listen, 'broker service listen');
  exactKeys(listen, ['host', 'port'], 'broker service listen');
  if (listen.host !== '127.0.0.1' || !Number.isInteger(listen.port) || Number(listen.port) < 1024 || Number(listen.port) > 65535) {
    throw new Error('broker service listen address is invalid');
  }
  const roots = objectValue(config.providerRoots, 'broker providerRoots');
  exactKeys(roots, ['claude', 'codex'], 'broker providerRoots');
  return {
    schemaVersion: 1,
    product: 'HappyHerd',
    listen: { host: '127.0.0.1', port: Number(listen.port) },
    ownerIdentity: strictString(config.ownerIdentity, 'ownerIdentity', 128, /^(?:uid:\d+|sid:[A-Za-z0-9-]+)$/),
    serviceIdentity: strictString(config.serviceIdentity, 'serviceIdentity', 128, /^(?:uid:\d+|nt-service:[A-Za-z0-9_.-]+)$/),
    clientCapabilityPath: absolutePath(config.clientCapabilityPath, 'clientCapabilityPath'),
    signingPrivateKeyPath: absolutePath(config.signingPrivateKeyPath, 'signingPrivateKeyPath'),
    stateRoot: absolutePath(config.stateRoot, 'stateRoot'),
    bundleRoot: absolutePath(config.bundleRoot, 'bundleRoot'),
    registryRoot: absolutePath(config.registryRoot, 'registryRoot'),
    providerRoots: {
      claude: absolutePath(roots.claude, 'providerRoots.claude'),
      codex: absolutePath(roots.codex, 'providerRoots.codex'),
    },
    installationRoot: absolutePath(config.installationRoot, 'installationRoot'),
    nodeRuntime: absolutePath(config.nodeRuntime, 'nodeRuntime'),
    pythonRuntime: absolutePath(config.pythonRuntime, 'pythonRuntime'),
    toolLauncher: absolutePath(config.toolLauncher, 'toolLauncher'),
    toolLauncherConfig: absolutePath(config.toolLauncherConfig, 'toolLauncherConfig'),
    toolIdentity: strictString(config.toolIdentity, 'toolIdentity', 128, /^(?:uid:\d+|local-user:[A-Za-z0-9_.-]+)$/),
  };
}

export function loadBrokerServiceConfig(pathInput: string): BrokerServiceConfig {
  const path = resolve(pathInput);
  const text = protectedFile(path, 'broker service config');
  try {
    return parseBrokerServiceConfig(JSON.parse(text));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('broker service config')) throw error;
    throw new Error(`broker service config is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseBrokerClientConfig(value: unknown): BrokerClientConfig {
  const config = objectValue(value, 'broker client config');
  exactKeys(config, [
    'schemaVersion',
    'product',
    'brokerUrl',
    'clientCapability',
    'signingPublicKey',
    'ownerIdentity',
    'serviceIdentity',
  ], 'broker client config');
  if (config.schemaVersion !== 1 || config.product !== 'HappyHerd') {
    throw new Error('broker client config identity is invalid');
  }
  const signingPublicKey = canonicalSigningPublicKey(config.signingPublicKey);
  return {
    schemaVersion: 1,
    product: 'HappyHerd',
    brokerUrl: cleanLoopbackUrl(config.brokerUrl),
    clientCapability: strictString(config.clientCapability, 'clientCapability', 64, /^[0-9a-f]{64}$/),
    signingPublicKey,
    ownerIdentity: strictString(config.ownerIdentity, 'ownerIdentity', 128, /^(?:uid:\d+|sid:[A-Za-z0-9-]+)$/),
    serviceIdentity: strictString(config.serviceIdentity, 'serviceIdentity', 128, /^(?:uid:\d+|nt-service:[A-Za-z0-9_.-]+)$/),
  };
}

export function defaultBrokerClientConfigPath(): string {
  return join(dirname(dirname(resolve(process.execPath))), 'client', 'broker.json');
}

export function loadBrokerClientConfig(pathInput = defaultBrokerClientConfigPath()): BrokerClientConfig {
  const path = resolve(pathInput);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
    throw new Error('HappyHerd broker client configuration is missing; reinstall HappyHerd');
  }
  if (process.platform !== 'win32') {
    const stat = statSync(path);
    if (stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
      throw new Error('HappyHerd broker trust anchor is not administrator-owned and immutable');
    }
    const installationRoot = dirname(dirname(path));
    for (const current of [installationRoot, dirname(path)]) {
      const parent = lstatSync(current);
      if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o022) !== 0) {
        throw new Error('HappyHerd broker trust anchor parent is unsafe');
      }
    }
    if (!process.getuid || process.getuid() === 0) {
      throw new Error('HappyHerd broker client must run as the non-root installation owner');
    }
    verifyUnixClientConfigAcl(path, process.getuid());
  } else {
    const installationRoot = dirname(dirname(path));
    verifyWindowsProtectedPaths([
      { kind: 'directory', path: installationRoot },
      { kind: 'directory', path: dirname(path) },
      { kind: 'file', path },
    ], 'HappyHerd broker trust anchor');
  }
  try {
    const parsed = parseBrokerClientConfig(JSON.parse(readFileSync(path, 'utf8')));
    if (process.platform !== 'win32' && parsed.ownerIdentity !== `uid:${process.getuid?.()}`) {
      throw new Error('HappyHerd broker client configuration belongs to a different OS user');
    }
    if (process.platform === 'win32') {
      verifyWindowsClientConfig(path, parsed.ownerIdentity.slice('sid:'.length));
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('HappyHerd')) throw error;
    throw new Error(`HappyHerd broker client configuration is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseBrokerRequest(value: unknown): BrokerRequest {
  const request = objectValue(value, 'broker request');
  if (request.schemaVersion !== 1) throw new Error('broker request schemaVersion must equal 1');
  const operation = strictString(request.operation, 'broker operation', 32);
  if (operation === 'ping') {
    exactKeys(request, ['schemaVersion', 'operation', 'nonce'], 'ping request');
    return { schemaVersion: 1, operation, nonce: strictString(request.nonce, 'ping nonce', 64, /^[0-9a-f]{64}$/) };
  }
  if (operation === 'status') {
    exactKeys(request, ['schemaVersion', 'operation'], 'status request');
    return { schemaVersion: 1, operation };
  }
  if (operation === 'connect') {
    exactKeys(request, ['schemaVersion', 'operation', 'issuer', 'clientVersion'], 'connect request');
    return {
      schemaVersion: 1,
      operation,
      issuer: normalizeIssuer(strictString(request.issuer, 'connect issuer', 2048)),
      clientVersion: strictString(request.clientVersion, 'clientVersion', 64, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
    };
  }
  if (operation === 'disconnect') {
    const hasAll = request.all === true;
    const hasIssuer = Object.hasOwn(request, 'issuer');
    if (hasAll === hasIssuer) throw new Error('disconnect requires exactly one of issuer or all');
    if (hasAll) {
      exactKeys(request, ['schemaVersion', 'operation', 'all'], 'disconnect request');
      return { schemaVersion: 1, operation, all: true };
    }
    exactKeys(request, ['schemaVersion', 'operation', 'issuer'], 'disconnect request');
    return {
      schemaVersion: 1,
      operation,
      issuer: normalizeIssuer(strictString(request.issuer, 'disconnect issuer', 2048)),
    };
  }
  if (operation === 'install-skills') {
    exactKeys(request, ['schemaVersion', 'operation', 'issuer'], 'install-skills request');
    return {
      schemaVersion: 1,
      operation,
      issuer: normalizeIssuer(strictString(request.issuer, 'install issuer', 2048)),
    };
  }
  if (operation === 'run-tool') {
    exactKeys(request, ['schemaVersion', 'operation', 'issuer', 'skill', 'script', 'args'], 'run-tool request');
    if (!Array.isArray(request.args) || request.args.length > MAX_ARGUMENTS) throw new Error('run-tool args are invalid');
    let total = 0;
    const args = request.args.map((argument, index) => {
      const parsed = strictString(argument, `run-tool args[${index}]`, 4096);
      total += Buffer.byteLength(parsed, 'utf8');
      return parsed;
    });
    if (total > MAX_ARGUMENT_BYTES) throw new Error('run-tool args exceed the total byte limit');
    return {
      schemaVersion: 1,
      operation,
      issuer: normalizeIssuer(strictString(request.issuer, 'run-tool issuer', 2048)),
      skill: strictString(request.skill, 'run-tool skill', 128, /^[a-z0-9][a-z0-9._-]{0,127}$/),
      script: strictString(request.script, 'run-tool script', 1024, /^[A-Za-z0-9._+@/-]+$/),
      args,
    };
  }
  throw new Error('broker operation is not allowed');
}

async function requestBody(request: IncomingMessage): Promise<BrokerRequest> {
  const rawLength = request.headers['content-length'];
  const declared = rawLength === undefined ? 0 : Number(rawLength);
  if (!Number.isInteger(declared) || declared < 0) throw new Error('broker request content-length is invalid');
  if (declared > MAX_REQUEST_BYTES) throw new Error('broker request exceeds the byte limit');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunkValue of request) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    length += chunk.length;
    if (length > MAX_REQUEST_BYTES) {
      request.destroy();
      throw new Error('broker request exceeds the byte limit');
    }
    chunks.push(chunk);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('broker request is not valid JSON');
  }
  return parseBrokerRequest(value);
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const value = request.headers.authorization;
  if (typeof value !== 'string' || !value.startsWith('HappyHerd-Broker ')) return false;
  const supplied = value.slice('HappyHerd-Broker '.length);
  if (!/^[0-9a-f]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  response.end(bytes);
}

function attestationPayload(
  nonce: string,
  pid: number,
  ownerIdentity: string,
  serviceIdentity: string,
  version: string,
): string {
  return ['happyherd-broker-attestation-v1', nonce, String(pid), ownerIdentity, serviceIdentity, version].join('\n');
}

function assertServiceBoundary(config: BrokerServiceConfig, currentIdentity: string): void {
  if (currentIdentity !== config.serviceIdentity) throw new Error('broker is not running as its configured OS service identity');
  if (currentIdentity === config.ownerIdentity) throw new Error('broker service identity must differ from the agent owner identity');
  if (config.toolIdentity === config.ownerIdentity || config.toolIdentity === config.serviceIdentity) {
    throw new Error('tool execution identity must differ from both broker and agent owner identities');
  }
  mkdirSync(config.stateRoot, { recursive: true, mode: process.platform === 'win32' ? 0o700 : 0o710 });
  if (process.platform !== 'win32') {
    // The isolated tool identity has the broker service group as its sole
    // supplementary boundary. It needs traverse-only access to stateRoot in
    // order to reach the service-owned 0750 immutable bundle tree. Never
    // collapse this installer-established boundary to 0700 at broker startup.
    chmodSync(config.stateRoot, 0o710);
    const stat = statSync(config.stateRoot);
    if ((stat.mode & 0o777) !== 0o710 || (process.getuid && stat.uid !== process.getuid())) {
      throw new Error('broker state root must be service-owned with group-traverse-only mode 0710');
    }
  }
}

function pathInside(rootInput: string, pathInput: string): boolean {
  const root = resolve(rootInput);
  const path = resolve(pathInput);
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function protectedRuntimeFile(path: string, root: string, label: string): string {
  if (!pathInside(root, path)) throw new Error(`${label} must be inside the protected HappyHerd installation`);
  if (process.platform !== 'win32') {
    const rootPath = resolve(root);
    const rootStat = lstatSync(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== 0 || (rootStat.mode & 0o022) !== 0) {
      throw new Error('HappyHerd installation root is not protected by the OS administrator');
    }
    let current = rootPath;
    for (const part of relative(rootPath, path).split(sep).slice(0, -1)) {
      current = join(current, part);
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
        throw new Error(`${label} has an unsafe parent directory`);
      }
    }
  }
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) {
    throw new Error(`${label} is missing or unsafe`);
  }
  const stat = statSync(path);
  if (process.platform !== 'win32' && (stat.uid !== 0 || (stat.mode & 0o111) === 0 || (stat.mode & 0o022) !== 0)) {
    throw new Error(`${label} permissions are unsafe`);
  }
  return resolve(path);
}

export function validateBrokerRuntime(config: BrokerServiceConfig): BrokerRuntimeReport {
  const nodeRuntime = protectedRuntimeFile(config.nodeRuntime, config.installationRoot, 'broker Node runtime');
  if (resolve(process.execPath) !== nodeRuntime) {
    throw new Error('broker process is not running on its configured protected Node runtime');
  }
  const pythonRuntime = protectedRuntimeFile(config.pythonRuntime, config.installationRoot, 'broker Python runtime');
  protectedRuntimeFile(config.toolLauncher, config.installationRoot, 'isolated tool launcher');
  const check = spawnSync(pythonRuntime, [
    '-I',
    '-X',
    'utf8',
    '-c',
    'import json,sys;from zoneinfo import ZoneInfo;print(json.dumps({"version":list(sys.version_info[:3]),"timezone":ZoneInfo("America/New_York").key}))',
  ], {
    cwd: config.installationRoot,
    env: isolatedChildEnvironment(),
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 64 * 1024,
    stdio: 'pipe',
  });
  if (check.error || check.status !== 0) throw new Error('broker-owned Python runtime or tzdata failed its isolated smoke test');
  let value: unknown;
  try { value = JSON.parse(check.stdout.trim()); } catch { throw new Error('broker-owned Python runtime returned an invalid smoke result'); }
  const result = objectValue(value, 'broker Python smoke result');
  exactKeys(result, ['version', 'timezone'], 'broker Python smoke result');
  if (
    !Array.isArray(result.version)
    || result.version.length !== 3
    || result.version.some((part) => !Number.isInteger(part))
    || Number(result.version[0]) !== 3
    || Number(result.version[1]) < 10
    || result.timezone !== 'America/New_York'
  ) throw new Error('broker-owned Python 3.10+ runtime with tzdata is required');
  return {
    nodeVersion: process.versions.node,
    pythonVersion: (result.version as number[]).join('.'),
    timezone: result.timezone,
  };
}

export function createBrokerServer(
  config: BrokerServiceConfig,
  version: string,
  dependencies: BrokerDependencies = {},
): Server {
  const currentIdentity = dependencies.currentIdentity ?? currentBrokerIdentity();
  assertServiceBoundary(config, currentIdentity);
  const capability = protectedFile(config.clientCapabilityPath, 'broker client capability');
  if (!/^[0-9a-f]{64}$/.test(capability)) throw new Error('broker client capability is invalid');
  const signingPrivateKey = protectedFile(config.signingPrivateKeyPath, 'broker signing private key');
  const vault = dependencies.vault ?? new KeyringSecretStore();
  const registryOptions = { providerRoots: config.providerRoots, registryRoot: config.registryRoot };
  const runtime = (dependencies.runtimeValidation ?? (() => validateBrokerRuntime(config)))();
  let connecting = false;
  // Every token-bearing native launcher uses the same isolated OS identity.
  // Serializing globally prevents a malicious tool for issuer A from running
  // alongside (and inspecting) issuer B's token-bearing process.
  let toolRunning = false;
  let installingSkills = false;

  return createServer(async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    try {
      if (request.method !== 'POST' || request.url !== '/v1/request') {
        json(response, 404, { error: 'not_found' });
        return;
      }
      if (!authorized(request, capability)) {
        json(response, 401, { error: 'unauthorized' });
        return;
      }
      const message = await requestBody(request);
      if (message.operation === 'ping') {
        const payload = attestationPayload(
          message.nonce,
          process.pid,
          config.ownerIdentity,
          config.serviceIdentity,
          version,
        );
        json(response, 200, {
          schemaVersion: 1,
          product: 'HappyHerd',
          nonce: message.nonce,
          pid: process.pid,
          ownerIdentity: config.ownerIdentity,
          serviceIdentity: config.serviceIdentity,
          version,
          signature: sign(null, Buffer.from(payload), signingPrivateKey).toString('base64url'),
        });
        return;
      }
      if (message.operation === 'status') {
        const report = validateManagedSkillRegistry(registryOptions);
        json(response, 200, {
          schemaVersion: 1,
          ready: true,
          registry: report.detail,
          runtime,
          secretStore: vault.diagnostic(),
        });
        return;
      }
      if (message.operation === 'connect') {
        if (connecting) throw new Error('another broker connection is already in progress');
        connecting = true;
        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.flushHeaders();
        const emit = (event: ConnectEvent): void => {
          response.write(`${JSON.stringify({ schemaVersion: 1, ...event })}\n`);
        };
        try {
          const record = await connectIssuer({
            issuer: message.issuer,
            clientVersion: message.clientVersion,
            secretStore: vault,
            ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
            ...(dependencies.sleep ? { sleep: dependencies.sleep } : {}),
            ...(dependencies.now ? { now: dependencies.now } : {}),
            openBrowser: () => undefined,
            onEvent: emit,
          });
          response.end(`${JSON.stringify({
            schemaVersion: 1,
            type: 'result',
            expiresAt: record.expiresAt,
            scopes: record.scopes,
            skillBundleAvailable: Boolean(record.skillBundle),
          })}\n`);
        } catch (error) {
          response.end(`${JSON.stringify({
            schemaVersion: 1,
            type: 'error',
            message: error instanceof Error ? error.message : 'broker connection failed',
          })}\n`);
        } finally {
          connecting = false;
        }
        return;
      }
      if (message.operation === 'install-skills') {
        if (installingSkills) throw new Error('another Skill installation is already running');
        installingSkills = true;
        try {
          const credential = vault.get(message.issuer);
          if (!credential) throw new Error('issuer is not connected; run happyherd connect first');
          const descriptor = descriptorFromCredential(credential);
          const installed = await (dependencies.installBundle ?? installSkillBundle)({
            source: descriptor.url,
            expectedSha256: descriptor.sha256,
            expectedManifestSha256: descriptor.manifestSha256,
            currentHappyHerdVersion: version,
            root: config.bundleRoot,
            credential,
            ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
          });
          const registry = (dependencies.registerBundle ?? registerInstalledSkillBundle)(installed, {
            ...registryOptions,
            issuer: credential.issuer,
          });
          json(response, 200, {
            schemaVersion: 1,
            id: installed.id,
            version: installed.version,
            skills: installed.skills,
            registry: registry.detail,
          });
          return;
        } finally {
          installingSkills = false;
        }
      }
      if (message.operation === 'disconnect') {
        const removed = message.all ? vault.deleteAll() : Number(vault.delete(message.issuer!));
        json(response, 200, { schemaVersion: 1, removed });
        return;
      }
      if (toolRunning) throw new Error('another verified Skill tool is already running');
      toolRunning = true;
      const controller = new AbortController();
      const cancel = (): void => controller.abort();
      const cancelOnClosedResponse = (): void => {
        if (!response.writableEnded) controller.abort();
      };
      request.once('aborted', cancel);
      response.once('close', cancelOnClosedResponse);
      let result;
      try {
        result = await executeManagedTool({
          issuer: message.issuer,
          skill: message.skill,
          script: message.script,
          args: message.args,
          secretStore: vault,
          ...registryOptions,
          parentEnv: {},
          signal: controller.signal,
          launcher: {
            command: config.toolLauncher,
            configPath: config.toolLauncherConfig,
            pythonRuntime: config.pythonRuntime,
            nodeRuntime: config.nodeRuntime,
          },
          ...(dependencies.spawnTool ? { spawn: dependencies.spawnTool } : {}),
        });
      } finally {
        request.off('aborted', cancel);
        response.off('close', cancelOnClosedResponse);
        toolRunning = false;
      }
      if (controller.signal.aborted || response.destroyed) return;
      json(response, 200, { schemaVersion: 1, ...result });
    } catch (error) {
      if (!response.destroyed && !response.headersSent) {
        json(response, 400, { error: 'broker_request_failed', message: error instanceof Error ? error.message : 'broker request failed' });
      } else if (!response.writableEnded) {
        response.end();
      }
    }
  });
}

export async function listenBroker(
  config: BrokerServiceConfig,
  version: string,
  dependencies: BrokerDependencies = {},
): Promise<Server> {
  const server = createBrokerServer(config, version, dependencies);
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(config.listen.port, config.listen.host, () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
  return server;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return objectValue(
    await readBoundedJson(response, MAX_BROKER_JSON_RESPONSE_BYTES, 'broker response'),
    'broker response',
  );
}

export interface BrokerClientOptions {
  config: BrokerClientConfig;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void;
  stdout?: (message: string) => void;
}

export type BrokerClientConnectEvent =
  | { type: 'approval'; message: string; verificationUri: string; userCode: string }
  | { type: 'pending' | 'connected'; message: string };

export interface BrokerClientInterface {
  ping(): Promise<{ version: string; serviceIdentity: string }>;
  status(): Promise<string>;
  connect(
    issuer: string,
    clientVersion: string,
    onEvent?: (event: BrokerClientConnectEvent) => void,
  ): Promise<{ expiresAt: string; scopes: string[]; skillBundleAvailable: boolean }>;
  installSkills(issuer: string): Promise<{ id: string; version: string; skills: string[]; registry: string }>;
  disconnect(issuer?: string): Promise<number>;
  runTool(issuer: string, skill: string, script: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }>;
}

export class BrokerClient {
  readonly #config: BrokerClientConfig;
  readonly #fetch: typeof fetch;
  readonly #openBrowser: (url: string) => void;
  readonly #stdout: (message: string) => void;
  #attested = false;

  constructor(options: BrokerClientOptions) {
    this.#config = options.config;
    this.#fetch = options.fetch ?? fetch;
    this.#openBrowser = options.openBrowser ?? openApprovalUrl;
    this.#stdout = options.stdout ?? console.log;
  }

  async #request(message: BrokerRequest): Promise<Record<string, unknown>> {
    const response = await this.#fetch(`${this.#config.brokerUrl}/v1/request`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `HappyHerd-Broker ${this.#config.clientCapability}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    const body = await responseJson(response);
    if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : `broker request failed with HTTP ${response.status}`);
    return body;
  }

  async ping(): Promise<{ version: string; serviceIdentity: string }> {
    const nonce = randomBytes(32).toString('hex');
    const response = await this.#request({ schemaVersion: 1, operation: 'ping', nonce });
    exactKeys(response, [
      'schemaVersion',
      'product',
      'nonce',
      'pid',
      'ownerIdentity',
      'serviceIdentity',
      'version',
      'signature',
    ], 'broker attestation');
    if (
      response.schemaVersion !== 1
      || response.product !== 'HappyHerd'
      || response.nonce !== nonce
      || !Number.isInteger(response.pid)
      || response.ownerIdentity !== this.#config.ownerIdentity
      || response.serviceIdentity !== this.#config.serviceIdentity
      || response.ownerIdentity === response.serviceIdentity
      || typeof response.version !== 'string'
      || typeof response.signature !== 'string'
    ) throw new Error('broker attestation identity is invalid');
    const payload = attestationPayload(
      nonce,
      Number(response.pid),
      response.ownerIdentity,
      response.serviceIdentity,
      response.version,
    );
    if (!verify(
      null,
      Buffer.from(payload),
      this.#config.signingPublicKey,
      Buffer.from(response.signature, 'base64url'),
    )) throw new Error('broker attestation signature is invalid');
    this.#attested = true;
    return { version: response.version, serviceIdentity: response.serviceIdentity };
  }

  async #ensureAttested(): Promise<void> {
    if (!this.#attested) await this.ping();
  }

  async status(): Promise<string> {
    await this.#ensureAttested();
    const response = await this.#request({ schemaVersion: 1, operation: 'status' });
    const runtime = response.runtime;
    if (
      response.schemaVersion !== 1
      || response.ready !== true
      || typeof response.registry !== 'string'
      || typeof response.secretStore !== 'string'
      || !runtime
      || typeof runtime !== 'object'
      || Array.isArray(runtime)
    ) {
      throw new Error('broker status response is invalid');
    }
    const runtimeRecord = runtime as Record<string, unknown>;
    exactKeys(runtimeRecord, ['nodeVersion', 'pythonVersion', 'timezone'], 'broker runtime status');
    if (
      typeof runtimeRecord.nodeVersion !== 'string'
      || typeof runtimeRecord.pythonVersion !== 'string'
      || runtimeRecord.timezone !== 'America/New_York'
    ) throw new Error('broker runtime status is invalid');
    return `${response.registry}; broker Node ${runtimeRecord.nodeVersion}; Python ${runtimeRecord.pythonVersion} with tzdata; ${response.secretStore}`;
  }

  async connect(
    issuer: string,
    clientVersion: string,
    onEvent?: (event: BrokerClientConnectEvent) => void,
  ): Promise<{ expiresAt: string; scopes: string[]; skillBundleAvailable: boolean }> {
    await this.#ensureAttested();
    const normalizedIssuer = normalizeIssuer(issuer);
    const response = await this.#fetch(`${this.#config.brokerUrl}/v1/request`, {
      method: 'POST',
      headers: {
        Accept: 'application/x-ndjson',
        Authorization: `HappyHerd-Broker ${this.#config.clientCapability}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ schemaVersion: 1, operation: 'connect', issuer, clientVersion }),
      redirect: 'error',
      signal: AbortSignal.timeout(11 * 60_000),
    });
    if (!response.ok || !response.body) throw new Error(`broker connection failed with HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let total = 0;
    let result: { expiresAt: string; scopes: string[]; skillBundleAvailable: boolean } | null = null;
    const consume = (line: string): void => {
      if (!line) return;
      const event = objectValue(JSON.parse(line), 'broker connect event');
      if (event.schemaVersion !== 1 || typeof event.type !== 'string') throw new Error('broker connect event is invalid');
      if (event.type === 'approval') {
        if (typeof event.message !== 'string' || typeof event.verificationUrl !== 'string' || typeof event.userCode !== 'string') {
          throw new Error('broker approval event is invalid');
        }
        const message = strictString(event.message, 'broker approval message', 512);
        const verification = new URL(strictString(event.verificationUrl, 'broker verification URL', 2048));
        if (verification.origin !== normalizedIssuer || verification.username || verification.password || verification.hash) {
          throw new Error('broker verification URL is outside the connected issuer');
        }
        const userCode = strictString(event.userCode, 'broker user code', 32, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
        if (onEvent) onEvent({ type: 'approval', message, verificationUri: verification.toString(), userCode });
        else {
          this.#stdout(message);
          this.#stdout(`Open: ${verification.toString()}`);
          this.#stdout(`Code: ${userCode}`);
        }
        try { this.#openBrowser(verification.toString()); } catch { /* the printed URL is the fallback */ }
      } else if (event.type === 'pending' || event.type === 'connected') {
        const message = strictString(event.message, 'broker progress message', 512);
        if (onEvent) onEvent({ type: event.type, message });
        else this.#stdout(message);
      } else if (event.type === 'result') {
        if (
          typeof event.expiresAt !== 'string'
          || !Number.isFinite(Date.parse(event.expiresAt))
          || !Array.isArray(event.scopes)
          || event.scopes.length > 256
          || event.scopes.some((scope) => typeof scope !== 'string' || scope.length > 240 || /[\u0000-\u001f\u007f-\u009f]/.test(scope))
          || typeof event.skillBundleAvailable !== 'boolean'
        ) throw new Error('broker result event is invalid');
        result = {
          expiresAt: event.expiresAt,
          scopes: event.scopes as string[],
          skillBundleAvailable: event.skillBundleAvailable,
        };
      } else if (event.type === 'error') {
        throw new Error(typeof event.message === 'string' ? event.message : 'broker connection failed');
      } else {
        throw new Error('broker returned an unknown connect event');
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error('broker connect response exceeds the byte limit');
      }
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) consume(line);
    }
    pending += decoder.decode();
    if (pending) consume(pending);
    if (!result) throw new Error('broker connection ended without a result');
    return result;
  }

  async installSkills(issuer: string): Promise<{ id: string; version: string; skills: string[]; registry: string }> {
    await this.#ensureAttested();
    const response = await this.#request({ schemaVersion: 1, operation: 'install-skills', issuer });
    if (
      response.schemaVersion !== 1
      || typeof response.id !== 'string'
      || typeof response.version !== 'string'
      || !Array.isArray(response.skills)
      || response.skills.some((skill) => typeof skill !== 'string')
      || typeof response.registry !== 'string'
    ) throw new Error('broker install response is invalid');
    return {
      id: response.id,
      version: response.version,
      skills: response.skills as string[],
      registry: response.registry,
    };
  }

  async disconnect(issuer?: string): Promise<number> {
    await this.#ensureAttested();
    const request: BrokerRequest = issuer === undefined
      ? { schemaVersion: 1, operation: 'disconnect', all: true }
      : { schemaVersion: 1, operation: 'disconnect', issuer: normalizeIssuer(issuer) };
    const response = await this.#request(request);
    if (response.schemaVersion !== 1 || !Number.isInteger(response.removed) || Number(response.removed) < 0) {
      throw new Error('broker disconnect response is invalid');
    }
    return Number(response.removed);
  }

  async runTool(issuer: string, skill: string, script: string, args: string[]): Promise<{
    status: number;
    stdout: string;
    stderr: string;
  }> {
    await this.#ensureAttested();
    const response = await this.#request({ schemaVersion: 1, operation: 'run-tool', issuer, skill, script, args });
    if (
      response.schemaVersion !== 1
      || !Number.isInteger(response.status)
      || typeof response.stdout !== 'string'
      || typeof response.stderr !== 'string'
    ) throw new Error('broker tool response is invalid');
    return { status: Number(response.status), stdout: response.stdout, stderr: response.stderr };
  }
}
