import {
  GrokPermissionModeTransitionReceiptSchema,
  HappyHerdMachineSessionProviderSchema,
} from '@happyherd/wire';
import type { DecryptedSession } from 'happyherd-control-agent/control';
import type { MachineControlClient } from './machine';
import { MachineMetadataSchema, type MachineMetadata } from '@/api/types';
import {
  persistedProviderPermissionMode,
  resolveEffectiveSessionSettings,
} from '@/capabilities/sessionLaunchSettings';

type SettingsClient = Pick<MachineControlClient,
  'resolveSession' | 'resolveMachine' | 'callMachineRpc' | 'updateSessionMetadata'>;
type Dependencies = { createClient?: () => Promise<SettingsClient>; output?: (value: string) => void };
type ParsedFlags = Record<string, string | true>;
type RequestedSettings = { model?: string; effort?: string; permission?: string };

function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (!name || name.includes('=')) throw new Error(`Unknown option: ${arg}`);
    if (Object.prototype.hasOwnProperty.call(flags, name)) {
      throw new Error(`Option --${name} may only be specified once`);
    }
    if (name === 'json') {
      flags[name] = true;
      continue;
    }
    if (!['model', 'effort', 'permission'].includes(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    flags[name] = value;
    index += 1;
  }
  return flags;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function help(): string {
  return `happyherd session set-settings - Set model, effort, or permission for an existing session

Usage:
  happyherd session set-settings SESSION_ID [--model MODEL] [--effort EFFORT]
    [--permission MODE] [--json]

Use exact setting codes advertised by the session's owning machine, including
an advertised default code when available. At least one setting is required.
A running turn keeps its current settings; supported runtime selections apply
to the next message. Otherwise they apply on resume.
Changes use account-level machine control authentication. Grok permission
changes use the owning daemon's confirmed resume transition.`;
}

function withSettings(
  metadata: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const current = object(metadata);
  if (!current) throw new Error('Session metadata is not an object');
  return { ...current, ...patch };
}

function providerFromSession(session: DecryptedSession) {
  const provider = HappyHerdMachineSessionProviderSchema.safeParse(object(session.metadata)?.flavor);
  if (!provider.success) {
    throw new Error(`Session ${session.id} does not have a supported native HappyHerd CLI provider`);
  }
  return provider.data;
}

function owningMachineId(session: DecryptedSession): string {
  const machineId = string(object(session.metadata)?.machineId);
  if (!machineId) throw new Error(`Session ${session.id} has no machine binding`);
  return machineId;
}

function resolveSessionSettings(
  machineMetadata: MachineMetadata,
  machineId: string,
  provider: ReturnType<typeof providerFromSession>,
  sessionMetadata: unknown,
  requested: RequestedSettings,
) {
  const metadata = object(sessionMetadata);
  if (!metadata) throw new Error('Session metadata is not an object');
  const spawn = object(metadata.spawnSettings);
  const matchingSpawn = spawn?.provider === provider ? spawn : null;
  const retainedPermission = provider === 'grok' || provider === 'dsh'
    ? persistedProviderPermissionMode(
        metadata as Parameters<typeof persistedProviderPermissionMode>[0],
        provider,
      )
    : metadata.permissionMode === null
      ? undefined
      : string(metadata.permissionMode) ?? string(matchingSpawn?.permission);
  const retained = (field: 'modelMode' | 'effortLevel', launchField: 'model' | 'effort') => {
    if (metadata[field] === null) return undefined;
    return string(metadata[field]) ?? string(matchingSpawn?.[launchField]);
  };
  return resolveEffectiveSessionSettings(machineMetadata, machineId, {
    provider,
    model: requested.model ?? retained('modelMode', 'model'),
    effort: requested.effort ?? retained('effortLevel', 'effort'),
    permission: requested.permission ?? retainedPermission,
  });
}

function settingsPatch(
  settings: ReturnType<typeof resolveSessionSettings>,
  requested: RequestedSettings,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (requested.model !== undefined) patch.modelMode = settings.model;
  if (requested.effort !== undefined) patch.effortLevel = settings.effort;
  if (requested.permission !== undefined) patch.permissionMode = settings.permission;
  return patch;
}

async function controlCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('happyherd-control-agent auth login')) {
      throw new Error('Account-level machine authentication expired. Run `happyherd machine auth login` and approve the one-time link in the HappyHerd app.');
    }
    throw error;
  }
}

async function accountClient(dependencies?: Dependencies): Promise<SettingsClient> {
  if (dependencies?.createClient) return dependencies.createClient();
  // machine.ts routes this command, so load its default client after startup to
  // avoid a runtime import cycle while retaining the shared account client.
  const { createDefaultClient } = await import('./machine');
  return createDefaultClient();
}

export async function handleSessionSettingsCommand(
  args: string[],
  dependencies?: Dependencies,
): Promise<void> {
  const output = dependencies?.output ?? console.log;
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    output(help());
    return;
  }
  const [selector, ...flagArgs] = args;
  if (!selector || selector.startsWith('--')) throw new Error('session-id is required');
  const flags = parseFlags(flagArgs);
  const requested = {
    model: typeof flags.model === 'string' ? flags.model : undefined,
    effort: typeof flags.effort === 'string' ? flags.effort : undefined,
    permission: typeof flags.permission === 'string' ? flags.permission : undefined,
  };
  if (requested.model === undefined && requested.effort === undefined && requested.permission === undefined) {
    throw new Error('At least one of --model, --effort, or --permission is required');
  }

  const client = await controlCall(() => accountClient(dependencies));
  const session = await controlCall(() => client.resolveSession(selector));
  const machineId = owningMachineId(session);
  const machine = await controlCall(() => client.resolveMachine(machineId));
  if (machine.id !== machineId) throw new Error(`Machine ${machineId} could not be refreshed exactly`);
  const machineMetadata = MachineMetadataSchema.safeParse(machine.metadata);
  if (!machineMetadata.success) {
    throw new Error(`Machine ${machine.id} does not advertise valid HappyHerd CLI capability metadata`);
  }

  const provider = providerFromSession(session);
  // DSH permission is daemon-confirmed launch state, shown read-only by the active composer.
  if (provider === 'dsh' && requested.permission !== undefined) {
    throw new Error('DSH permission is selected at launch and cannot be changed for an existing session');
  }
  let initialSettings: ReturnType<typeof resolveSessionSettings>;
  try {
    initialSettings = resolveSessionSettings(machineMetadata.data, machine.id, provider, session.metadata, requested);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const context = requested.model !== undefined && requested.effort === undefined
      ? ' Set a compatible --effort value in the same command if the existing effort is unavailable for that model.'
      : '';
    throw new Error(`${detail}${context}`);
  }

  let grokTransitionConfirmed = false;
  if (requested.permission !== undefined) {
    const initialMetadata = object(session.metadata);
    const launchPermission = provider === 'grok' && initialMetadata
      ? persistedProviderPermissionMode(
          initialMetadata as Parameters<typeof persistedProviderPermissionMode>[0],
          'grok',
        )
      : undefined;
    if (provider === 'grok' && launchPermission !== initialSettings.permission) {
      const receipt = GrokPermissionModeTransitionReceiptSchema.parse(
        await controlCall(() => client.callMachineRpc<unknown>(machine, 'grok-permission-mode-transition', {
          sessionId: session.id,
          permissionMode: initialSettings.permission,
        })),
      );
      if (receipt.sessionId !== session.id || receipt.permissionMode !== initialSettings.permission) {
        throw new Error(`Grok daemon did not confirm the requested permission for session ${session.id}`);
      }
      grokTransitionConfirmed = true;
    }
  }

  const updateBase = provider === 'grok' && grokTransitionConfirmed
    ? await controlCall(() => client.resolveSession(session.id))
    : session;
  const updated = await controlCall(() => client.updateSessionMetadata(updateBase, (latest) => {
    // Re-resolve against the versioned latest metadata on every retry. A
    // concurrent pick can change the compatibility of the requested tuple.
    const latestSettings = resolveSessionSettings(machineMetadata.data, machine.id, provider, latest, requested);
    return withSettings(latest, settingsPatch(latestSettings, requested));
  }));
  if (updated.id !== session.id) throw new Error(`Settings update returned unexpected session ${updated.id}`);
  const readback = object(updated.metadata);
  // Verify the requested dimensions, then report every dimension as resolved
  // from authoritative readback metadata (including concurrent retained picks).
  const requestedReadback = resolveSessionSettings(machineMetadata.data, machine.id, provider, updated.metadata, requested);
  const readbackPatch = settingsPatch(requestedReadback, requested);
  for (const [field, expected] of Object.entries(readbackPatch)) {
    if (readback?.[field] !== expected) {
      throw new Error(`Session ${session.id} did not confirm ${field}=${String(expected)} in authoritative readback`);
    }
  }
  const settings = resolveSessionSettings(machineMetadata.data, machine.id, provider, updated.metadata, {});
  const requestedDimensions = [
    ['model', requested.model],
    ['effort', requested.effort],
    ['permission', requested.permission],
  ] as const;
  for (const [dimension, requestedValue] of requestedDimensions) {
    if (requestedValue !== undefined && settings[dimension] !== requestedReadback[dimension]) {
      throw new Error(
        `Session ${session.id} authoritative ${dimension} setting resolved to ${String(settings[dimension])} instead of requested ${String(requestedReadback[dimension])}`,
      );
    }
  }

  const hasModelOrEffortRequest = requested.model !== undefined || requested.effort !== undefined;
  const permissionTakesEffect = provider === 'grok' && requested.permission !== undefined
    ? grokTransitionConfirmed ? 'confirmed-resume' as const : 'unchanged' as const
    : undefined;
  const takesEffect = grokTransitionConfirmed && !hasModelOrEffortRequest
    ? 'confirmed-resume' as const
    : provider === 'grok'
      && requested.permission !== undefined
      && !grokTransitionConfirmed
      && !hasModelOrEffortRequest
      ? 'unchanged' as const
      : 'next-message-or-resume' as const;
  const receipt = {
    schemaVersion: 1,
    type: 'session-settings-updated' as const,
    sessionId: session.id,
    provider,
    settings,
    takesEffect,
    ...(permissionTakesEffect ? { permissionTakesEffect } : {}),
  };
  if (flags.json === true) output(JSON.stringify(receipt));
  else {
    output(`Updated settings for ${session.id} (${provider}).`);
    if (receipt.takesEffect === 'confirmed-resume') {
      output('The daemon confirmed the Grok permission through its resume transition.');
    } else if (receipt.takesEffect === 'unchanged') {
      output('The saved Grok permission already matches; no resume transition was requested.');
    } else if (receipt.permissionTakesEffect === 'confirmed-resume') {
      output('The Grok permission was confirmed through resume; model and effort selections take effect on a later message or resume.');
    } else if (receipt.permissionTakesEffect === 'unchanged') {
      output('The selected model and effort take effect on a later message or resume.');
      output('The saved Grok permission already matches; no resume transition was requested.');
    } else {
      output('The next message or resume uses the selected settings.');
    }
  }
}
