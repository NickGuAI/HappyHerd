import type { HappyHerdMachineSessionSettings } from '@slopus/happy-wire';
import { isAgyPermissionMode, type AgyPermissionMode } from './cliArgs';

export type AgyTurnMode = {
  permissionMode: AgyPermissionMode;
  model?: string;
  effort?: string;
};

/** Keep each queued prompt bound to the agy child settings selected for it. */
export function hashAgyTurnMode(mode: AgyTurnMode): string {
  return JSON.stringify([mode.permissionMode, mode.model ?? null, mode.effort ?? null]);
}

export type AgyIncomingPermissionResolution =
  | { ok: true; permissionMode: AgyPermissionMode }
  | { ok: false; error: string };

/** Refuse an unsupported remote policy without executing the prompt under stale authority. */
export function resolveAgyIncomingPermissionMode(
  current: AgyPermissionMode,
  incoming: string | undefined,
): AgyIncomingPermissionResolution {
  if (incoming === undefined) {
    return { ok: true, permissionMode: current };
  }
  if (!isAgyPermissionMode(incoming)) {
    return {
      ok: false,
      error: `Unsupported Antigravity permission mode: ${incoming}`,
    };
  }
  return { ok: true, permissionMode: incoming };
}

export function buildAgyLaunchMetadata(
  permissionMode: AgyPermissionMode,
  model: string,
  effort: string | null = null,
): {
  spawnSettings: HappyHerdMachineSessionSettings;
  permissionMode: string;
  modelMode: string;
  effortLevel: string | null;
} {
  return {
    spawnSettings: {
      provider: 'agy',
      model,
      effort,
      permission: permissionMode,
    },
    permissionMode,
    modelMode: model,
    effortLevel: effort,
  };
}
