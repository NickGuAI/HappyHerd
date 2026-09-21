import { createId } from '@paralleldrive/cuid2';
import { createEnvelope, type CreateEnvelopeOptions, type SessionEnvelope } from '@happyherd/wire';
import type { AgentMessage } from '@/agent/core';
import { readPlanEntries } from '@/sessionProtocol/planEntries';

function turnOptions(turnId: string | null, time: number): CreateEnvelopeOptions {
  return turnId ? { turn: turnId, time } : { time };
}

function buildToolTitle(toolName: string, providerTitle?: string): string {
  return providerTitle?.trim() || toolName;
}

function buildToolDescription(toolName: string): string {
  return `Running ${toolName}`;
}

function parseThinkingPayload(payload: unknown): { text: string; streaming: boolean } {
  if (typeof payload === 'string') {
    return { text: payload, streaming: false };
  }
  if (!payload || typeof payload !== 'object') {
    return { text: '', streaming: false };
  }
  const text = typeof (payload as { text?: unknown }).text === 'string'
    ? (payload as { text: string }).text
    : '';
  const streaming = (payload as { streaming?: unknown }).streaming === true;
  return { text, streaming };
}

export class AcpSessionManager {
  private currentTurnId: string | null = null;
  private replayingPlans = false;

  /** ACP load/resume can replay snapshots before any prompt turn exists. */
  setPlanReplay(active: boolean): void {
    this.replayingPlans = active;
  }

  /** Monotonic clock: max(lastTime + 1, Date.now()) */
  private lastTime = 0;

  /** Pending text waiting to be flushed when the stream type changes */
  private pendingText = '';
  private pendingType: 'thinking' | 'output' | null = null;

  private nextTime(): number {
    this.lastTime = Math.max(this.lastTime + 1, Date.now());
    return this.lastTime;
  }

  private flush(): SessionEnvelope[] {
    if (!this.pendingText || !this.pendingType) {
      return [];
    }
    const text = this.pendingText.replace(/^\n+|\n+$/g, '');
    const type = this.pendingType;
    this.pendingText = '';
    this.pendingType = null;

    if (!text) {
      return [];
    }
    if (type === 'thinking') {
      return [createEnvelope('agent', { t: 'text', text, thinking: true }, turnOptions(this.currentTurnId, this.nextTime()))];
    }
    return [createEnvelope('agent', { t: 'text', text }, turnOptions(this.currentTurnId, this.nextTime()))];
  }

  startTurn(): SessionEnvelope[] {
    if (this.currentTurnId) {
      return [];
    }

    this.currentTurnId = createId();
    return [
      createEnvelope('agent', { t: 'turn-start' }, { turn: this.currentTurnId, time: this.nextTime() }),
    ];
  }

  endTurn(status: 'completed' | 'failed' | 'cancelled'): SessionEnvelope[] {
    const flushed = this.flush();
    if (!this.currentTurnId) {
      return flushed;
    }

    const turnId = this.currentTurnId;
    this.currentTurnId = null;
    return [
      ...flushed,
      createEnvelope('agent', { t: 'turn-end', status }, { turn: turnId, time: this.nextTime() }),
    ];
  }

  nextAttachmentEnvelopeOptions(): Pick<CreateEnvelopeOptions, 'turn' | 'time'> {
    return turnOptions(this.currentTurnId, this.nextTime());
  }

  mapMessage(msg: AgentMessage): SessionEnvelope[] {
    if (msg.type === 'event' && msg.name === 'plan') {
      const todos = readPlanEntries(msg.payload);
      if (todos === null || (!this.currentTurnId && !this.replayingPlans)) return [];
      const replay = !this.currentTurnId;
      const turnId = this.currentTurnId ?? createId();
      // ACP plans are full replacements, including an empty plan. Reuse the
      // existing TodoWrite transcript and latest-todos reducer, not a new store.
      const flushed = this.flush();
      const call = createId();
      return [
        ...flushed,
        ...(replay ? [createEnvelope('agent', { t: 'turn-start' }, { turn: turnId, time: this.nextTime() })] : []),
        createEnvelope('agent', {
          t: 'tool-call-start', call, name: 'TodoWrite',
          title: 'Plan', description: 'Plan', args: { todos },
        }, turnOptions(turnId, this.nextTime())),
        createEnvelope('agent', {
          t: 'tool-call-end', call, result: { newTodos: todos },
        }, turnOptions(turnId, this.nextTime())),
        ...(replay ? [createEnvelope('agent', { t: 'turn-end', status: 'completed' }, { turn: turnId, time: this.nextTime() })] : []),
      ];
    }

    if (msg.type === 'event' && msg.name === 'thinking') {
      const { text, streaming } = parseThinkingPayload(msg.payload);
      if (!text) {
        return [];
      }

      if (streaming) {
        // Streaming thinking: accumulate, flush if switching from a different type
        const flushed = this.pendingType !== 'thinking' ? this.flush() : [];
        this.pendingType = 'thinking';
        this.pendingText += text;
        return flushed;
      }

      // Non-streaming thinking: flush pending, emit immediately
      const trimmed = text.replace(/^\n+|\n+$/g, '');
      if (!trimmed) {
        return this.flush();
      }
      return [
        ...this.flush(),
        createEnvelope('agent', { t: 'text', text: trimmed, thinking: true }, turnOptions(this.currentTurnId, this.nextTime())),
      ];
    }

    if (msg.type === 'status') {
      if (msg.status === 'error' && this.currentTurnId) {
        const detail = (msg.detail?.trim() || 'The agent stopped because of an unknown error.').slice(-2_000);
        return [
          ...this.flush(),
          createEnvelope(
            'agent',
            { t: 'service', text: `Error: ${detail}` },
            { turn: this.currentTurnId, time: this.nextTime() },
          ),
        ];
      }
      return [];
    }

    if (msg.type === 'model-output') {
      const text = msg.textDelta ?? '';
      if (!text) {
        return [];
      }
      // Accumulate output, flush if switching from a different type
      const flushed = this.pendingType !== 'output' ? this.flush() : [];
      this.pendingType = 'output';
      this.pendingText += text;
      return flushed;
    }

    if (msg.type === 'model-output-image') {
      return this.flush();
    }

    if (msg.type === 'tool-call') {
      const flushed = this.flush();
      return [
        ...flushed,
        createEnvelope('agent', {
          t: 'tool-call-start',
          call: msg.callId,
          name: msg.toolName,
          title: buildToolTitle(msg.toolName, msg.title),
          description: buildToolDescription(msg.toolName),
          args: msg.args,
        }, turnOptions(this.currentTurnId, this.nextTime())),
      ];
    }

    if (msg.type === 'tool-result') {
      const flushed = this.flush();
      return [
        ...flushed,
        createEnvelope('agent', {
          t: 'tool-call-end',
          call: msg.callId,
          ...(msg.result !== undefined ? { result: msg.result } : {}),
          ...(msg.error !== undefined ? { error: msg.error } : {}),
        }, turnOptions(this.currentTurnId, this.nextTime())),
      ];
    }

    return [];
  }
}
