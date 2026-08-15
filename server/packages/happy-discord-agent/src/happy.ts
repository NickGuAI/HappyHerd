import {
  HappyControlClient,
  type DecryptedMessage,
  type DecryptedSession,
  type TurnResult,
} from 'happy-agent/control';
import type { BridgeConfig } from './config';
import { findHistoricalTurnResult, hasInboundUserMessage } from './history';
import type { InboundRecord, SurfaceBinding } from './types';

export interface HappySessionRuntime {
  ensureSession(binding: SurfaceBinding): Promise<{ sessionId: string; sequence: number }>;
  history(sessionId: string): Promise<DecryptedMessage[]>;
  sendTurn(input: {
    sessionId: string;
    localId: string;
    text: string;
    sourceMessageId: string;
  }): Promise<TurnResult>;
  recoverTurn(record: InboundRecord): Promise<{
    result: TurnResult | null;
    userMessageExists: boolean;
  }>;
}

type ControlClient = Pick<
  HappyControlClient,
  'listSessions' | 'resolveSession' | 'spawnCodexSession' | 'resumeSession' | 'sendTurn' | 'getSessionMessages'
>;

function metadataSurface(session: DecryptedSession): string | null {
  const metadata = session.metadata as { pmaiDiscordSurfaceId?: unknown } | null;
  return typeof metadata?.pmaiDiscordSurfaceId === 'string'
    ? metadata.pmaiDiscordSurfaceId
    : null;
}

export class HappyHerdRuntime implements HappySessionRuntime {
  private readonly config: BridgeConfig;
  private readonly control: ControlClient;

  constructor(config: BridgeConfig, control: ControlClient = HappyControlClient.fromEnvironment()) {
    this.config = config;
    this.control = control;
  }

  private async existingSurfaceSession(surfaceKey: string): Promise<DecryptedSession | null> {
    const matches = (await this.control.listSessions())
      .filter((session) => metadataSurface(session) === surfaceKey)
      .sort((left, right) => right.createdAt - left.createdAt);
    if (matches.length > 1 && matches[0].active && matches[1].active) {
      throw new Error(`Multiple active HappyHerd sessions are bound to ${surfaceKey}`);
    }
    return matches[0] ?? null;
  }

  async ensureSession(binding: SurfaceBinding): Promise<{ sessionId: string; sequence: number }> {
    let session: DecryptedSession | null = null;
    if (binding.happySessionId) {
      try {
        session = await this.control.resolveSession(binding.happySessionId);
      } catch {
        session = null;
      }
    }
    session ??= await this.existingSurfaceSession(binding.surfaceKey);
    if (session && !session.active) {
      session = await this.control.resumeSession(session.id, {
        discordSurfaceId: binding.surfaceKey,
        pmaiCapabilityId: binding.capabilityId,
        pmaiBrokerUrl: this.config.brokerUrl,
      });
    }
    if (!session) {
      session = await this.control.spawnCodexSession({
        machineId: this.config.happyMachineId,
        directory: this.config.agentWorkspace,
        commanderId: this.config.commanderId,
        approvedNewDirectoryCreation: false,
        permissionMode: this.config.permissionMode,
        modelMode: this.config.modelMode,
        effortLevel: this.config.effortLevel,
        runtimeContext: {
          discordSurfaceId: binding.surfaceKey,
          pmaiCapabilityId: binding.capabilityId,
          pmaiBrokerUrl: this.config.brokerUrl,
        },
      });
    }
    return { sessionId: session.id, sequence: session.seq };
  }

  history(sessionId: string): Promise<DecryptedMessage[]> {
    return this.control.getSessionMessages(sessionId);
  }

  sendTurn(input: {
    sessionId: string;
    localId: string;
    text: string;
    sourceMessageId: string;
  }): Promise<TurnResult> {
    return this.control.sendTurn({
      sessionId: input.sessionId,
      localId: input.localId,
      text: input.text,
      timeoutMs: this.config.turnTimeoutMs,
      meta: {
        source: 'pmai-discord',
        discordSourceMessageId: input.sourceMessageId,
      },
    });
  }

  async recoverTurn(record: InboundRecord): Promise<{
    result: TurnResult | null;
    userMessageExists: boolean;
  }> {
    if (!record.happySessionId || record.baselineSequence === null) {
      return { result: null, userMessageExists: false };
    }
    const messages = await this.history(record.happySessionId);
    return {
      result: findHistoricalTurnResult(messages, {
        localId: record.happyLocalId,
        afterSeq: record.baselineSequence,
      }),
      userMessageExists: hasInboundUserMessage(
        messages,
        record.happyLocalId,
        record.baselineSequence,
      ),
    };
  }
}
