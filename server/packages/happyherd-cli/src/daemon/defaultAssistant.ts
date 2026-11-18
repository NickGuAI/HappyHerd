import type { HappyHerdCommanderSummary, HappyHerdMachineSessionSettings } from '@happyherd/wire';
import type { DefaultAssistantApi } from '@/api/defaultAssistant';
import type { MachineMetadata, Metadata, Session } from '@/api/types';
import { resolveEffectiveSessionSettings } from '@/capabilities/sessionLaunchSettings';

export type DefaultAssistantReceipt = {
  schemaVersion: 1;
  type: 'default-assistant';
  sessionId: string | null;
  commanderId?: string;
  machineId?: string;
  retiredSessionId?: string | null;
  status: 'created' | 'existing' | 'waiting-for-provider';
};

export function hasAssistantProviderIdentity(metadata: Metadata): boolean {
  if (metadata.flavor === 'codex') return Boolean(metadata.codexThreadId);
  if (metadata.flavor === 'claude') return Boolean(metadata.claudeSessionId);
  return Boolean(metadata.acpSessionId);
}

export function defaultAssistantSettings(metadata: MachineMetadata, machineId: string, onlyProvider?: string): HappyHerdMachineSessionSettings | null {
  for (const provider of ['codex', 'claude', 'grok', 'dsh'] as const) {
    if (onlyProvider !== undefined && provider !== onlyProvider) continue;
    if (!metadata.cliAvailability?.[provider] || !metadata.agentCapabilities?.[provider]) continue;
    try {
      return resolveEffectiveSessionSettings(metadata, machineId, { provider });
    } catch {
      // A provider without a usable advertised catalog is not ready yet.
    }
  }
  return null;
}

type Dependencies = {
  machineId: string;
  api: Pick<DefaultAssistantApi, 'get' | 'prepare' | 'publish' | 'hydrate' | 'retire'>;
  sessions: () => Session[];
  persist: (session: Session) => void;
  readAuthoritative: (session: Session) => Promise<Session | null>;
  ensureCommander: () => Promise<HappyHerdCommanderSummary>;
  machineMetadata: () => MachineMetadata;
  createMetadata: (commander: HappyHerdCommanderSummary, settings: HappyHerdMachineSessionSettings) => Metadata;
  isRunning: (session: Session) => boolean;
  start: (session: Session) => Promise<void>;
  stop: (session: Session) => Promise<void>;
  archive: (session: Session) => Promise<Session>;
};

/** The server's reserved session tag owns identity; reconnect data owns local keys. */
export class DefaultAssistantBootstrap {
  private inFlight: Promise<DefaultAssistantReceipt> | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  ensure(fresh = false): Promise<DefaultAssistantReceipt> {
    if (this.inFlight) return fresh ? this.inFlight.then(() => this.ensure(true)) : this.inFlight;
    this.inFlight = (fresh ? this.ensureFresh() : this.ensureOnce()).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async ensureFresh(): Promise<DefaultAssistantReceipt> {
    const d = this.dependencies;
    const existing = await d.api.get();
    if (!existing) return { ...await this.ensureOnce(), retiredSessionId: null };
    const saved = d.sessions().find(session => session.id === existing.id && session.metadata.machineId === d.machineId);
    if (!saved) {
      throw new Error(`Assistant session ${existing.id} lives on another machine. Run --fresh on that machine.`);
    }
    await d.stop(saved);
    const result = await d.api.retire(saved.id);
    if (!result.retired) {
      throw new Error(`Assistant changed before retirement (current session: ${result.session?.id ?? 'none'}). Run ensure-assistant again.`);
    }
    // Until archive clears the marker, normal ensure can adopt this same
    // session again if retirement was interrupted.
    d.persist(await d.archive(saved));
    return { ...await this.ensureOnce(), retiredSessionId: saved.id };
  }

  private async ensureOnce(): Promise<DefaultAssistantReceipt> {
    const d = this.dependencies;
    const base = { schemaVersion: 1 as const, type: 'default-assistant' as const };
    const existing = await d.api.get();
    const local = d.sessions().filter(session => session.metadata.isSuperSession === true
      && session.metadata.machineId === d.machineId
      && !session.metadata.isSideChat && !session.metadata.automationId && !session.metadata.automationKind);
    let saved = existing ? local.find(session => session.id === existing.id) : local[0];
    if (existing && !saved) return { ...base, sessionId: existing.id, status: 'existing' };

    if (!existing && saved) {
      const authoritative = await d.readAuthoritative(saved);
      if (authoritative && authoritative.metadata.isSuperSession !== true) {
        d.persist(authoritative);
        saved = undefined;
      }
      // A missing row is a prepared, unpublished session; retain its ID/key.
    }

    let session = saved;
    let created = false;
    if (!existing) {
      if (!session) {
        const settings = defaultAssistantSettings(d.machineMetadata(), d.machineId);
        if (!settings) return { ...base, sessionId: null, status: 'waiting-for-provider' };
        const commander = await d.ensureCommander();
        session = d.api.prepare(d.createMetadata(commander, settings));
        // This is deliberately before the request. A lost acknowledgement must
        // retry the same ID and key, never allocate another conversation.
        d.persist(session);
      }
      const result = await d.api.publish(session);
      if (!result.isRequestedSession || result.session.id !== session.id) {
        return { ...base, sessionId: result.session.id, status: 'existing' };
      }
      created = !saved;
      session = d.api.hydrate(result.session, session);
    } else {
      session = d.api.hydrate(existing, saved!);
    }
    d.persist(session);
    const receipt = {
      ...base,
      sessionId: session.id,
      commanderId: session.metadata.commanderId,
      machineId: session.metadata.machineId,
    };
    if (d.isRunning(session)) return { ...receipt, status: created ? 'created' : 'existing' };
    if (hasAssistantProviderIdentity(session.metadata)) return { ...receipt, status: 'existing' };
    if (!defaultAssistantSettings(d.machineMetadata(), d.machineId, session.metadata.flavor ?? 'unknown')) {
      return { ...receipt, status: 'waiting-for-provider' };
    }
    await d.start(session);
    return { ...receipt, status: created ? 'created' : 'existing' };
  }
}
