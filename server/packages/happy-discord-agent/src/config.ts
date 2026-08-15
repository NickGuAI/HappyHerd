import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export type BridgeConfig = {
  discordApplicationId: string;
  discordBotTokenFile: string;
  discordTokenRotationReceiptFile: string | null;
  pmaiApiBaseUrl: string;
  pmaiAuthorizationPath: string;
  pmaiBridgeId: string;
  pmaiServiceSigningSecretFile: string;
  bridgeTransportSecretFile: string;
  happyHomeDir: string;
  happyMachineId: string;
  agentWorkspace: string;
  commanderId: string;
  stateDir: string;
  allowedGuildIds: Set<string>;
  allowedChannelIds: Set<string>;
  listenHost: string;
  listenPort: number;
  brokerUrl: string;
  permissionMode: string;
  modelMode?: string;
  effortLevel?: string;
  turnTimeoutMs: number;
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function absolutePath(env: NodeJS.ProcessEnv, key: string): string {
  const value = required(env, key);
  if (!isAbsolute(value)) {
    throw new Error(`${key} must be an absolute path`);
  }
  return resolve(value);
}

function parseCsv(value: string | undefined): Set<string> {
  return new Set((value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? '3210');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PMAI_BRIDGE_PORT must be an integer from 1 to 65535');
  }
  return port;
}

function parsePositiveInteger(value: string | undefined, fallback: number, key: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

function parseUrl(raw: string, key: string, production: boolean): string {
  const url = new URL(raw);
  if (url.username || url.password) {
    throw new Error(`${key} must not contain credentials`);
  }
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (production && url.protocol !== 'https:' && !isLoopback) {
    throw new Error(`${key} must use HTTPS outside loopback`);
  }
  return url.toString().replace(/\/+$/, '');
}

function parseAuthorizationPath(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//')) {
    throw new Error('PMAI_AUTHORIZATION_PATH must be an origin-relative path');
  }
  const parsed = new URL(raw, 'https://pmai.invalid');
  if (parsed.origin !== 'https://pmai.invalid' || parsed.search || parsed.hash) {
    throw new Error('PMAI_AUTHORIZATION_PATH must not change origin or include query/fragment data');
  }
  return parsed.pathname;
}

function assertDedicatedPaths(config: Pick<BridgeConfig, 'happyHomeDir' | 'agentWorkspace' | 'stateDir'>): void {
  const personalRoots = [
    resolve(homedir(), '.happyherd'),
    resolve(homedir(), '.happy'),
    resolve(homedir(), '.herd'),
    resolve(homedir(), 'App'),
  ];
  for (const [label, candidate] of [
    ['HAPPY_HOME_DIR', config.happyHomeDir],
    ['PMAI_AGENT_WORKSPACE', config.agentWorkspace],
    ['PMAI_BRIDGE_STATE_DIR', config.stateDir],
  ] as const) {
    if (personalRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`))) {
      throw new Error(`${label} must use a dedicated PMAI service path, not ${candidate}`);
    }
  }
  if (new Set([config.happyHomeDir, config.agentWorkspace, config.stateDir]).size !== 3) {
    throw new Error('Happy home, agent workspace, and bridge state directories must be distinct');
  }
}

export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const production = env.NODE_ENV === 'production';
  const listenHost = env.PMAI_BRIDGE_HOST?.trim() || '127.0.0.1';
  const listenPort = parsePort(env.PMAI_BRIDGE_PORT);
  const pmaiApiBaseUrl = parseUrl(required(env, 'PMAI_ACCESS_API_URL'), 'PMAI_ACCESS_API_URL', production);
  const brokerUrl = parseUrl(
    env.PMAI_BROKER_URL ?? `http://127.0.0.1:${listenPort}/mcp`,
    'PMAI_BROKER_URL',
    production,
  );

  const config: BridgeConfig = {
    discordApplicationId: required(env, 'PMAI_DISCORD_APPLICATION_ID'),
    discordBotTokenFile: absolutePath(env, 'PMAI_DISCORD_TOKEN_FILE'),
    discordTokenRotationReceiptFile: env.PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE
      ? absolutePath(env, 'PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE')
      : null,
    pmaiApiBaseUrl,
    pmaiAuthorizationPath: parseAuthorizationPath(
      env.PMAI_AUTHORIZATION_PATH?.trim() || '/api/internal/discord/authorize',
    ),
    pmaiBridgeId: env.PMAI_BRIDGE_ID?.trim() || 'pmai-discord',
    pmaiServiceSigningSecretFile: absolutePath(env, 'PMAI_SERVICE_SIGNING_SECRET_FILE'),
    bridgeTransportSecretFile: absolutePath(env, 'PMAI_BRIDGE_TRANSPORT_SECRET_FILE'),
    happyHomeDir: absolutePath(env, 'HAPPY_HOME_DIR'),
    happyMachineId: required(env, 'PMAI_HAPPY_MACHINE_ID'),
    agentWorkspace: absolutePath(env, 'PMAI_AGENT_WORKSPACE'),
    commanderId: env.PMAI_COMMANDER_ID?.trim() || 'pmai-team-agent',
    stateDir: absolutePath(env, 'PMAI_BRIDGE_STATE_DIR'),
    allowedGuildIds: parseCsv(env.PMAI_ALLOWED_GUILD_IDS),
    allowedChannelIds: parseCsv(env.PMAI_ALLOWED_CHANNEL_IDS),
    listenHost,
    listenPort,
    brokerUrl,
    permissionMode: env.PMAI_CODEX_PERMISSION_MODE?.trim() || 'read-only',
    ...(env.PMAI_CODEX_MODEL?.trim() ? { modelMode: env.PMAI_CODEX_MODEL.trim() } : {}),
    ...(env.PMAI_CODEX_EFFORT?.trim() ? { effortLevel: env.PMAI_CODEX_EFFORT.trim() } : {}),
    turnTimeoutMs: parsePositiveInteger(env.PMAI_TURN_TIMEOUT_MS, 300_000, 'PMAI_TURN_TIMEOUT_MS'),
  };
  assertDedicatedPaths(config);
  const broker = new URL(config.brokerUrl);
  const brokerPort = Number(broker.port || (broker.protocol === 'https:' ? '443' : '80'));
  if (
    broker.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]', 'pmai-broker.localhost'].includes(broker.hostname)
    || brokerPort !== config.listenPort
    || broker.pathname !== '/mcp'
  ) {
    throw new Error('PMAI_BROKER_URL must be this bridge’s loopback /mcp endpoint');
  }
  const secretFiles = [
    config.discordBotTokenFile,
    config.pmaiServiceSigningSecretFile,
    config.bridgeTransportSecretFile,
    ...(config.discordTokenRotationReceiptFile ? [config.discordTokenRotationReceiptFile] : []),
  ];
  if (new Set(secretFiles).size !== secretFiles.length) {
    throw new Error('Discord, rotation receipt, PMAI signing, and bridge transport material must use separate files');
  }
  if (production && (config.allowedGuildIds.size === 0 || config.allowedChannelIds.size === 0)) {
    throw new Error('Production requires explicit PMAI guild and channel allowlists');
  }
  if (production && broker.hostname !== 'pmai-broker.localhost') {
    throw new Error('Production PMAI broker must use the sandbox-proxied loopback alias');
  }
  if (production && !config.discordTokenRotationReceiptFile) {
    throw new Error('Production requires PMAI_DISCORD_TOKEN_ROTATION_RECEIPT_FILE');
  }
  return config;
}

export async function readSecretFile(path: string, label: string): Promise<string> {
  const stats = await lstat(path);
  if (!stats.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be readable or writable by group or other users`);
  }
  if (stats.size > 65_536) {
    throw new Error(`${label} is unexpectedly large`);
  }
  await access(path, constants.R_OK);
  const value = (await readFile(path, 'utf8')).trim();
  if (!value) {
    throw new Error(`${label} is empty`);
  }
  return value;
}

const EXPOSED_TOKEN_INCIDENT_AT = Date.parse('2026-08-15T00:00:00.000Z');

export async function verifyDiscordTokenRotationReceipt(options: {
  receiptPath: string | null;
  token: string;
  applicationId: string;
  production: boolean;
  now?: number;
}): Promise<void> {
  if (!options.receiptPath) {
    if (options.production) throw new Error('Discord token rotation receipt is required');
    return;
  }
  const raw = await readSecretFile(options.receiptPath, 'Discord token rotation receipt');
  let receipt: unknown;
  try {
    receipt = JSON.parse(raw);
  } catch {
    throw new Error('Discord token rotation receipt must be valid JSON');
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Discord token rotation receipt must be an object');
  }
  const record = receipt as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['applicationId', 'rotatedAt', 'schemaVersion', 'tokenSha256'])) {
    throw new Error('Discord token rotation receipt has unexpected fields');
  }
  if (record.schemaVersion !== 1 || record.applicationId !== options.applicationId) {
    throw new Error('Discord token rotation receipt does not match this application');
  }
  const rotatedAt = typeof record.rotatedAt === 'string' ? Date.parse(record.rotatedAt) : Number.NaN;
  const now = options.now ?? Date.now();
  if (!Number.isFinite(rotatedAt) || rotatedAt <= EXPOSED_TOKEN_INCIDENT_AT || rotatedAt > now + 5 * 60_000) {
    throw new Error('Discord token rotation receipt is not after the exposure incident');
  }
  if (typeof record.tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.tokenSha256)) {
    throw new Error('Discord token rotation receipt tokenSha256 is invalid');
  }
  const expected = Buffer.from(createHash('sha256').update(options.token).digest('hex'));
  const actual = Buffer.from(record.tokenSha256);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error('Discord token rotation receipt does not match the installed token');
  }
}
