import type { HappyHerdCommanderSummary, HappyHerdMachineSessionSettings } from '@slopus/happy-wire';
import type { DefaultAssistantApi } from '@/api/defaultAssistant';
import type { MachineMetadata, Metadata, Session } from '@/api/types';
import { resolveEffectiveSessionSettings } from '@/capabilities/sessionLaunchSettings';

export type DefaultAssistantReceipt = {
  schemaVersion: 1;
  type: 'default-assistant';
  sessionId: string | null;
  commanderId?: string;
  machineId?: string;
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
  api: Pick<DefaultAssistantApi, 'get' | 'prepare' | 'publish' | 'hydrate'>;
  sessions: () => Session[];
  persist: (session: Session) => void;
  ensureCommander: () => Promise<HappyHerdCommanderSummary>;
  machineMetadata: () => MachineMetadata;
  createMetadata: (commander: HappyHerdCommanderSummary, settings: HappyHerdMachineSessionSettings) => Metadata;
  isRunning: (session: Session) => boolean;
  start: (session: Session) => Promise<void>;
};

/** The server's reserved session tag owns identity; reconnect data owns local keys. */
export class DefaultAssistantBootstrap {
  private inFlight: Promise<DefaultAssistantReceipt> | null = null;

  constructor(private readonly dependencies: Dependencies) {}

  ensure(): Promise<DefaultAssistantReceipt> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.ensureOnce().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async ensureOnce(): Promise<DefaultAssistantReceipt> {
    const d = this.dependencies;
    const base = { schemaVersion: 1 as const, type: 'default-assistant' as const };
    const existing = await d.api.get();
    const local = d.sessions().filter(session => session.metadata.isSuperSession === true
      && session.metadata.machineId === d.machineId
      && !session.metadata.isSideChat && !session.metadata.automationId && !session.metadata.automationKind);
    const saved = existing ? local.find(session => session.id === existing.id) : local[0];
    if (existing && !saved) return { ...base, sessionId: existing.id, status: 'existing' };

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
