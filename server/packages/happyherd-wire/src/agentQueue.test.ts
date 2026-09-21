import { describe, expect, it } from 'vitest';

import { AgentMessageQueueStateSchema } from './agentQueue';

describe('AgentMessageQueueStateSchema', () => {
  it('preserves ordered pending and current persisted message IDs', () => {
    expect(AgentMessageQueueStateSchema.parse({
      pendingMessageIds: ['message-2', 'message-3'],
      currentMessageIds: ['message-1'],
    })).toEqual({
      pendingMessageIds: ['message-2', 'message-3'],
      currentMessageIds: ['message-1'],
    });
  });

  it('rejects empty IDs and content duplicated into queue state', () => {
    expect(AgentMessageQueueStateSchema.safeParse({
      pendingMessageIds: [''],
      currentMessageIds: [],
    }).success).toBe(false);
    expect(AgentMessageQueueStateSchema.safeParse({
      pendingMessageIds: [],
      currentMessageIds: [],
      messages: [{ id: 'message-1', text: 'duplicated content' }],
    }).success).toBe(false);
  });
});
