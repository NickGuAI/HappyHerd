import {
  HappyControlClient,
  type DecryptedMessage,
  type DecryptedSession,
  type TurnResult,
} from 'happy-agent/control';
import type { BridgeConfig } from './config';
import { findHistoricalTurnResult, hasInboundUserMessage } from './history';
import { sessionToolManifest } from './manifest';
import type { HappyHerdAgentManifest, InboundRecord, SurfaceBinding } from './types';

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
  'listSessions' | 'resolveMachine' | 'resolveSession' | 'spawnCodexSession' | 'resumeSession' | 'sendTurn' | 'getSessionMessages'
>;

function metadataSurface(session: DecryptedSession): string | null {
  const metadata = session.metadata as { happyHerdAgentSurfaceId?: unknown } | null;
  return typeof metadata?.happyHerdAgentSurfaceId === 'string'
    ? metadata.happyHerdAgentSurfaceId
    : null;
}

export class HappyHerdRuntime implements HappySessionRuntime {
  private readonly config: BridgeConfig;
  private readonly control: ControlClient;
  private readonly tools: ReturnType<typeof sessionToolManifest>;

  constructor(
    config: BridgeConfig,
    manifest: HappyHerdAgentManifest,
    control: ControlClient = HappyControlClient.fromEnvironment(),
  ) {
    this.config = config;
    this.tools = sessionToolManifest(manifest);
    this.control = control;
  }

  async isMachineReady(): Promise<boolean> {
    try {
      const machine = await this.control.resolveMachine(this.config.happyMachineId);
      return machine.active;
    } catch {
      return false;
    }
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
        surfaceId: binding.surfaceKey,
        capabilityId: binding.capabilityId,
        brokerUrl: this.config.brokerUrl,
        tools: this.tools,
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
          surfaceId: binding.surfaceKey,
          capabilityId: binding.capabilityId,
          brokerUrl: this.config.brokerUrl,
          tools: this.tools,
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
        source: 'happyherd-agent-discord',
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
