import { randomBytes } from 'node:crypto';
import type { AuthorizationGrant, SurfaceBinding } from './types';

export type ActiveCapability = {
  id: string;
  surfaceKey: string;
  subjectId: string | null;
  discordUserId: string;
  sourceMessageId: string;
  mode: AuthorizationGrant['mode'];
  grant: AuthorizationGrant;
  activatedAt: number;
};

export function createCapabilityId(): string {
  return randomBytes(32).toString('base64url');
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, ActiveCapability>();

  activate(
    binding: SurfaceBinding,
    grant: AuthorizationGrant,
    sourceMessageId: string,
  ): ActiveCapability {
    if (binding.surfaceKind === 'dm' && binding.subjectId !== grant.actor.subjectId) {
      throw new Error('Authorized subject does not own this Discord DM surface');
    }
    if (binding.surfaceKind !== 'dm' && grant.mode !== 'shared-read-only') {
      throw new Error('Guild surfaces must use a shared read-only capability');
    }
    const active: ActiveCapability = {
      id: binding.capabilityId,
      surfaceKey: binding.surfaceKey,
      subjectId: binding.subjectId,
      discordUserId: grant.actor.discordUserId,
      sourceMessageId,
      mode: grant.mode,
      grant,
      activatedAt: Date.now(),
    };
    this.capabilities.set(binding.capabilityId, active);
    return active;
  }

  resolve(capabilityId: string, now = Date.now()): ActiveCapability {
    const active = this.capabilities.get(capabilityId);
    if (!active) {
      throw new Error('Unknown or inactive agent session capability');
    }
    if (active.grant.delegation.expiresAt <= now) {
      this.capabilities.delete(capabilityId);
      throw new Error('Expired agent session capability');
    }
    return active;
  }

  revoke(capabilityId: string): void {
    this.capabilities.delete(capabilityId);
  }
}
