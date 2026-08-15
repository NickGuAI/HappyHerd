import { constants } from 'node:fs';
import { access, lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export type BridgeConfig = {
  discordApplicationId: string;
  discordBotTokenFile: string;
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
  const isLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  if (production && url.protocol !== 'https:' && !isLoopback) {
    throw new Error(`${key} must use HTTPS outside loopback`);
  }
  return url.toString().replace(/\/+$/, '');
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
    pmaiApiBaseUrl,
    pmaiAuthorizationPath: env.PMAI_AUTHORIZATION_PATH?.trim() || '/api/internal/discord/authorize',
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
    || !['127.0.0.1', 'localhost', '::1'].includes(broker.hostname)
    || brokerPort !== config.listenPort
    || broker.pathname !== '/mcp'
  ) {
    throw new Error('PMAI_BROKER_URL must be this bridge’s loopback /mcp endpoint');
  }
  if (new Set([
    config.discordBotTokenFile,
    config.pmaiServiceSigningSecretFile,
    config.bridgeTransportSecretFile,
  ]).size !== 3) {
    throw new Error('Discord, PMAI signing, and bridge transport secrets must use separate files');
  }
  if (production && (config.allowedGuildIds.size === 0 || config.allowedChannelIds.size === 0)) {
    throw new Error('Production requires explicit PMAI guild and channel allowlists');
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
