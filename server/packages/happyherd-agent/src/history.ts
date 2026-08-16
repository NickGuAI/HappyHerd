import type { DecryptedMessage, TurnResult } from 'happy-agent/control';

type SessionEnvelope = {
  role?: unknown;
  turn?: unknown;
  subagent?: unknown;
  ev?: {
    t?: unknown;
    text?: unknown;
    thinking?: unknown;
    status?: unknown;
  };
};

function sessionEnvelope(content: unknown): SessionEnvelope | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return null;
  }
  const outer = content as { role?: unknown; content?: unknown };
  if (outer.role !== 'session' || !outer.content || typeof outer.content !== 'object' || Array.isArray(outer.content)) {
    return null;
  }
  return outer.content as SessionEnvelope;
}

export function findHistoricalTurnResult(
  messages: DecryptedMessage[],
  options: { localId: string; afterSeq: number },
): TurnResult | null {
  const ordered = [...messages].sort((left, right) => left.seq - right.seq);
  const userMessage = ordered.find((message) => (
    message.localId === options.localId && message.seq > options.afterSeq
  ));
  if (!userMessage) {
    return null;
  }

  let turnId: string | null = null;
  const textParts: string[] = [];
  const messageIds: string[] = [];
  for (const message of ordered) {
    if (message.seq <= userMessage.seq) {
      continue;
    }
    const envelope = sessionEnvelope(message.content);
    if (!envelope || envelope.role !== 'agent' || envelope.subagent !== undefined) {
      continue;
    }
    const envelopeTurnId = typeof envelope.turn === 'string' ? envelope.turn : null;
    if (envelope.ev?.t === 'turn-start' && turnId === null && envelopeTurnId) {
      turnId = envelopeTurnId;
      continue;
    }
    if (turnId === null || envelopeTurnId !== turnId) {
      continue;
    }
    if (
      envelope.ev?.t === 'text'
      && envelope.ev.thinking !== true
      && typeof envelope.ev.text === 'string'
    ) {
      const text = envelope.ev.text.trim();
      if (text && textParts.at(-1) !== text) {
        textParts.push(text);
        messageIds.push(message.id);
      }
      continue;
    }
    if (
      envelope.ev?.t === 'turn-end'
      && (
        envelope.ev.status === 'completed'
        || envelope.ev.status === 'failed'
        || envelope.ev.status === 'cancelled'
      )
    ) {
      return {
        turnId,
        status: envelope.ev.status,
        text: textParts.join('\n\n'),
        messageIds,
      };
    }
  }
  return null;
}

export function hasInboundUserMessage(
  messages: DecryptedMessage[],
  localId: string,
  afterSeq: number,
): boolean {
  return messages.some((message) => message.localId === localId && message.seq > afterSeq);
}
