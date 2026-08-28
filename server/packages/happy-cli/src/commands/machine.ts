import { posix, win32 } from 'node:path';

import {
  HappyControlClient,
  type DecryptedMachine,
} from 'happy-agent/control';
import {
  HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION,
  HAPPYHERD_MACHINE_SESSION_PROVIDERS,
  type HappyHerdMachineSessionProvider,
  type HappyHerdMachineSessionSettings,
} from '@slopus/happy-wire';
import {
  authLogin as linkMachineControlAccount,
  authLogout as unlinkMachineControlAccount,
  authStatus as machineControlAccountStatus,
} from 'happy-agent/auth';

import {
  AgentCapabilityCatalogSchema,
  MachineMetadataSchema,
  type AgentCapabilityCatalog,
  type MachineMetadata,
} from '@/api/types';
import { resolveEffectiveSessionSettings } from '@/capabilities/sessionLaunchSettings';
import { configuration } from '@/configuration';
import {
  getLocalHappyAgentCredentialPath,
  readLocalHappyAgentCredentials,
  type LocalHappyAgentCredentials,
} from '@/resume/localHappyAgentAuth';
import {
  handleSideChatCommand,
  sideChatHelp,
  type SideChatLifecycleReceipt,
  type SideChatLifecycleRequest,
} from './sideChat';
import { manageDaemonSideChat } from '@/daemon/controlClient';

const DAEMON_PROVIDERS = HAPPYHERD_MACHINE_SESSION_PROVIDERS;
type Provider = HappyHerdMachineSessionProvider;

type Output = (value: string) => void;

export type MachineControlClient = Pick<
  HappyControlClient,
  | 'listMachines'
  | 'resolveMachine'
  | 'resolveSession'
  | 'callMachineRpc'
  | 'spawnSessionOnMachineConfirmed'
>;

export type MachineCommandDependencies = {
  createClient?: () => Promise<MachineControlClient>;
  accountAuth?: {
    login: (config: AccountControlConfig) => Promise<void>;
    logout: (config: AccountControlConfig) => Promise<void>;
    status: (config: AccountControlConfig) => Promise<void>;
  };
  output?: Output;
  setExitCode?: (code: number) => void;
  manageLocalSideChat?: (request: SideChatLifecycleRequest) => Promise<SideChatLifecycleReceipt>;
};

type AccountControlConfig = {
  serverUrl: string;
  homeDir: string;
  credentialPath: string;
};

export type MachineKind = 'happy-cli-daemon' | 'rig' | 'unknown';

type ParsedFlags = Record<string, string | true>;

type SessionCreateOptions = {
  machineSelector: string;
  directory: string;
  provider: Provider;
  model?: string;
  effort?: string;
  permission?: string;
  createDirectory: boolean;
  json: boolean;
};

export type EffectiveSessionSettings = HappyHerdMachineSessionSettings;

function machineHelp(): string {
  return `happy machine - Discover account machines and manage machine control access

Usage:
  happy machine list [--json]
  happy machine auth <login|status|logout>

Selectors accepted by "happy session create" are an exact machine ID or an
exact, unambiguous hostname from this account catalog. Session creation is
supported only for machines running the native Happy CLI daemon; receipts mark
other account-machine kinds explicitly.`;
}

function machineAuthHelp(): string {
  return `happy machine auth - Link account-wide machine control

Usage:
  happy machine auth login
  happy machine auth status
  happy machine auth logout

Login displays a one-time QR code. Approve it from Settings -> Account -> Link
New Device in the Happy app. The account-control key is stored only in the
configured HappyHerd home and remains separate from normal Happy CLI auth.`;
}

function sessionHelp(): string {
  return `happy session - Create a tracked session on an account machine

Usage:
  happy session create --machine ID_OR_HOST --path ABSOLUTE_PATH --provider PROVIDER \\
    [--model MODEL] [--effort EFFORT] [--permission MODE] [--create-dir] [--json]
  happy session side-chat <parent-session-id> [--json]

Happy CLI daemon providers: ${DAEMON_PROVIDERS.join(', ')}

The selected machine must run a native Happy CLI daemon that advertises the
target-confirmed machine-session protocol. Upgrade and restart older daemons.
Rig machines use a separate, idempotent creation contract and are not accepted.
The target path must already exist unless --create-dir explicitly approves
directory creation on the selected machine.`;
}

function parseFlags(args: string[], allowedValueFlags: Set<string>, allowedBooleanFlags: Set<string>): ParsedFlags {
  const flags: ParsedFlags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const name = arg.slice(2);
    if (!name || name.includes('=')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      throw new Error(`Option --${name} may only be specified once`);
    }
    if (allowedBooleanFlags.has(name)) {
      flags[name] = true;
      continue;
    }
    if (!allowedValueFlags.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`--${name} requires a value`);
    }
    flags[name] = value;
    index += 1;
  }
  return flags;
}

function requiredFlag(flags: ParsedFlags, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value.trim();
}

function optionalFlag(flags: ParsedFlags, name: string): string | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`--${name} requires a value`);
  }
  return value.trim();
}

export function parseSessionCreateOptions(args: string[]): SessionCreateOptions {
  const flags = parseFlags(
    args,
    new Set(['machine', 'path', 'provider', 'model', 'effort', 'permission']),
    new Set(['create-dir', 'json']),
  );
  const machineSelector = requiredFlag(flags, 'machine');
  const directory = requiredFlag(flags, 'path');
  const providerValue = requiredFlag(flags, 'provider');
  if (!DAEMON_PROVIDERS.includes(providerValue as Provider)) {
    throw new Error(`Unsupported Happy CLI daemon provider "${providerValue}". Expected one of: ${DAEMON_PROVIDERS.join(', ')}`);
  }
  return {
    machineSelector,
    directory,
    provider: providerValue as Provider,
    model: optionalFlag(flags, 'model'),
    effort: optionalFlag(flags, 'effort'),
    permission: optionalFlag(flags, 'permission'),
    createDirectory: flags['create-dir'] === true,
    json: flags.json === true,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown, key: string): string | null {
  const candidate = record(value)?.[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

export function isRigMachineMetadata(metadata: unknown): boolean {
  const value = record(metadata);
  if (!value) return false;
  const client = record(value.client);
  const availability = record(value.cliAvailability);
  return value.machineKind === 'rig'
    || value.rigOnly === true
    || client?.id === 'rig'
    || availability?.rig === true;
}

export function classifyMachineKind(machine: DecryptedMachine): MachineKind {
  if (isRigMachineMetadata(machine.metadata)) return 'rig';
  return MachineMetadataSchema.safeParse(machine.metadata).success
    ? 'happy-cli-daemon'
    : 'unknown';
}

function machineIdentity(machine: DecryptedMachine) {
  return {
    host: stringField(machine.metadata, 'host'),
    platform: stringField(machine.metadata, 'platform'),
    happyCliVersion: stringField(machine.metadata, 'happyCliVersion'),
    homeDir: stringField(machine.metadata, 'homeDir'),
  };
}

function parseMetadata(machine: DecryptedMachine): MachineMetadata {
  if (isRigMachineMetadata(machine.metadata)) {
    throw new Error(`Machine ${machine.id} is a Rig machine; native happy session create supports Happy CLI daemon machines only`);
  }
  const parsed = MachineMetadataSchema.safeParse(machine.metadata);
  if (!parsed.success) {
    throw new Error(`Machine ${machine.id} does not advertise valid Happy CLI daemon capability metadata`);
  }
  return parsed.data;
}

function summaryMetadata(machine: DecryptedMachine): MachineMetadata | null {
  const parsed = MachineMetadataSchema.safeParse(machine.metadata);
  return parsed.success ? parsed.data : null;
}

function supportsConfirmedMachineSessions(metadata: MachineMetadata | null): boolean {
  return metadata?.machineSessionProtocolVersion === HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION;
}

function requireConfirmedMachineSessionTarget(machine: DecryptedMachine): MachineMetadata {
  const metadata = parseMetadata(machine);
  if (!machine.active) {
    throw new Error(`Machine ${machine.id} is offline`);
  }
  if (!supportsConfirmedMachineSessions(metadata)) {
    throw new Error(
      `Machine ${machine.id} does not advertise target-confirmed machine-session protocol version ${HAPPYHERD_MACHINE_SESSION_PROTOCOL_VERSION}; upgrade and restart its Happy CLI daemon`,
    );
  }
  return metadata;
}

function safeCatalogs(metadata: MachineMetadata | null): Record<string, AgentCapabilityCatalog> {
  const catalogs: Record<string, AgentCapabilityCatalog> = {};
  for (const provider of Object.keys(metadata?.agentCapabilities ?? {}).sort()) {
    const parsed = AgentCapabilityCatalogSchema.safeParse(metadata?.agentCapabilities?.[provider]);
    if (parsed.success) catalogs[provider] = parsed.data;
  }
  return catalogs;
}

export function machineListReceipt(machines: DecryptedMachine[]) {
  return {
    schemaVersion: 1,
    type: 'machine-list' as const,
    machines: [...machines].sort((left, right) => left.id.localeCompare(right.id)).map((machine) => {
      const metadata = summaryMetadata(machine);
      const identity = machineIdentity(machine);
      const kind = classifyMachineKind(machine);
      return {
        id: machine.id,
        host: identity.host,
        platform: identity.platform,
        online: machine.active,
        activeAt: machine.activeAt,
        kind,
        machineSessionProtocolVersion: metadata?.machineSessionProtocolVersion ?? null,
        sessionCreateSupported: kind === 'happy-cli-daemon' && supportsConfirmedMachineSessions(metadata),
        happyCliVersion: identity.happyCliVersion,
        homeDir: identity.homeDir,
        availableProviders: kind === 'happy-cli-daemon'
          ? DAEMON_PROVIDERS.filter((provider) => metadata?.cliAvailability?.[provider] === true)
          : [],
        providers: kind === 'happy-cli-daemon' ? safeCatalogs(metadata) : {},
      };
    }),
  };
}

export function resolveMachineSelector(machines: DecryptedMachine[], selector: string): DecryptedMachine {
  const exactId = machines.find((machine) => machine.id === selector);
  if (exactId) return exactId;

  const exactHostMatches = machines.filter((machine) => machineIdentity(machine).host === selector);
  if (exactHostMatches.length === 1) return exactHostMatches[0];
  if (exactHostMatches.length > 1) {
    throw new Error(`Ambiguous machine hostname "${selector}" matches ${exactHostMatches.length} machines`);
  }
  throw new Error(`No machine found matching "${selector}"`);
}

function isAbsoluteForMachine(directory: string, platform: string): boolean {
  if (directory.includes('\0')) return false;
  return platform.toLowerCase().startsWith('win')
    ? win32.isAbsolute(directory)
    : posix.isAbsolute(directory);
}

export function validateSessionSettings(
  machine: DecryptedMachine,
  options: SessionCreateOptions,
): EffectiveSessionSettings {
  const metadata = requireConfirmedMachineSessionTarget(machine);
  if (!isAbsoluteForMachine(options.directory, metadata.platform)) {
    throw new Error(`--path must be an absolute ${metadata.platform} path`);
  }
  return resolveEffectiveSessionSettings(metadata, machine.id, {
    provider: options.provider,
    model: options.model,
    effort: options.effort,
    permission: options.permission,
  });
}

export async function createDefaultClient(options: {
  homeDir?: string;
  readCredentials?: (homeDir: string) => LocalHappyAgentCredentials | null;
  create?: (credentials: LocalHappyAgentCredentials) => MachineControlClient;
} = {}): Promise<MachineControlClient> {
  const homeDir = options.homeDir ?? configuration.happyHomeDir;
  const credentials = (options.readCredentials ?? readLocalHappyAgentCredentials)(homeDir);
  if (!credentials) {
    throw new Error('Account-level machine control is not linked. Run `happy machine auth login` and approve the one-time link in the Happy app.');
  }
  return options.create?.(credentials) ?? new HappyControlClient({
    config: accountControlConfig(homeDir),
    credentials,
  });
}

function accountControlConfig(homeDir: string = configuration.happyHomeDir): AccountControlConfig {
  return {
    serverUrl: configuration.serverUrl.replace(/\/+$/, ''),
    homeDir,
    credentialPath: getLocalHappyAgentCredentialPath(homeDir),
  };
}

function accountAuthFor(dependencies?: MachineCommandDependencies) {
  return dependencies?.accountAuth ?? {
    login: linkMachineControlAccount,
    logout: unlinkMachineControlAccount,
    status: (config: AccountControlConfig) => machineControlAccountStatus(config, {
      loginCommand: 'happy machine auth login',
    }),
  };
}

async function handleMachineAuthCommand(
  args: string[],
  dependencies?: MachineCommandDependencies,
): Promise<void> {
  const [action, ...rest] = args;
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    outputFor(dependencies)(machineAuthHelp());
    return;
  }
  if (rest.length > 0) {
    throw new Error(`happy machine auth ${action} accepts no arguments`);
  }
  const auth = accountAuthFor(dependencies);
  const config = accountControlConfig();
  if (action === 'login') {
    await auth.login(config);
    return;
  }
  if (action === 'status') {
    await auth.status(config);
    return;
  }
  if (action === 'logout') {
    await auth.logout(config);
    return;
  }
  throw new Error(`Unknown machine auth command: ${action}`);
}

function outputFor(dependencies?: MachineCommandDependencies): Output {
  return dependencies?.output ?? console.log;
}

async function clientFor(dependencies?: MachineCommandDependencies): Promise<MachineControlClient> {
  return (dependencies?.createClient ?? createDefaultClient)();
}

async function controlCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('happy-agent auth login')) {
      throw new Error('Account-level machine authentication expired. Run `happy machine auth login` and approve the one-time link in the Happy app.');
    }
    if (message.startsWith('Directory creation requires approval:')) {
      throw new Error(`${message}. Rerun with --create-dir to approve it.`);
    }
    throw error;
  }
}

export async function handleMachineCommand(
  args: string[],
  dependencies?: MachineCommandDependencies,
): Promise<void> {
  const [action, ...rest] = args;
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    outputFor(dependencies)(machineHelp());
    return;
  }
  if (action === 'auth') {
    await handleMachineAuthCommand(rest, dependencies);
    return;
  }
  if (action !== 'list') throw new Error(`Unknown machine command: ${action}`);
  if (rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h')) {
    outputFor(dependencies)(machineHelp());
    return;
  }
  const flags = parseFlags(rest, new Set(), new Set(['json']));
  const client = await controlCall(() => clientFor(dependencies));
  const receipt = machineListReceipt(await controlCall(() => client.listMachines()));
  if (flags.json === true) {
    outputFor(dependencies)(JSON.stringify(receipt));
    return;
  }
  const lines = receipt.machines.map((machine) => (
    `${machine.id}\t${machine.host ?? '-'}\t${machine.online ? 'online' : 'offline'}\t${machine.kind}\t${machine.sessionCreateSupported ? 'yes' : 'no'}\t${machine.availableProviders.join(',') || '-'}`
  ));
  outputFor(dependencies)(['ID\tHOST\tSTATUS\tKIND\tSESSION_CREATE\tPROVIDERS', ...lines].join('\n'));
}

export async function handleSessionCommand(
  args: string[],
  dependencies?: MachineCommandDependencies,
): Promise<void> {
  const [action, ...rest] = args;
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    outputFor(dependencies)(sessionHelp());
    return;
  }
  if (action === 'side-chat') {
    if (rest.length === 0 || rest.includes('--help') || rest.includes('-h')) {
      outputFor(dependencies)(sideChatHelp());
      return;
    }
    await handleSideChatCommand(rest, {
      execute: dependencies?.manageLocalSideChat ?? manageDaemonSideChat,
      output: outputFor(dependencies),
      setExitCode: dependencies?.setExitCode,
    });
    return;
  }
  if (action !== 'create') throw new Error(`Unknown session command: ${action}`);
  if (rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h')) {
    outputFor(dependencies)(sessionHelp());
    return;
  }
  const options = parseSessionCreateOptions(rest);
  const client = await controlCall(() => clientFor(dependencies));
  const selected = resolveMachineSelector(
    await controlCall(() => client.listMachines()),
    options.machineSelector,
  );
  const machine = await controlCall(() => client.resolveMachine(selected.id));
  if (machine.id !== selected.id) {
    throw new Error(`Machine ${selected.id} could not be refreshed exactly`);
  }
  validateSessionSettings(machine, options);
  const created = await controlCall(() => client.spawnSessionOnMachineConfirmed(machine, {
    directory: options.directory,
    approvedNewDirectoryCreation: options.createDirectory,
    agent: options.provider,
    ...(options.model ? { modelMode: options.model } : {}),
    ...(options.effort ? { effortLevel: options.effort } : {}),
    ...(options.permission ? { permissionMode: options.permission } : {}),
  }));
  const metadata = summaryMetadata(machine);
  const receipt = {
    schemaVersion: 1,
    type: 'session-created' as const,
    sessionId: created.session.id,
    machine: {
      id: machine.id,
      host: metadata?.host ?? null,
      platform: metadata?.platform ?? null,
    },
    path: options.directory,
    settings: created.settings,
  };
  if (options.json) {
    outputFor(dependencies)(JSON.stringify(receipt));
    return;
  }
  outputFor(dependencies)(`Created Happy session ${created.session.id} on ${metadata?.host ?? machine.id} (${machine.id})`);
  outputFor(dependencies)(`Path: ${options.directory}`);
  outputFor(dependencies)(`Settings: ${JSON.stringify(created.settings)}`);
}
