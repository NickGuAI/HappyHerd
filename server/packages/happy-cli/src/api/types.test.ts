import { describe, expect, it } from 'vitest';

import { MessageMetaSchema } from './types';

describe('CLI message metadata contract', () => {
  it('preserves the explicit provider queue delivery override', () => {
    expect(MessageMetaSchema.parse({
      deliveryMode: 'queue',
      queueMessageId: 'persisted-message-1',
    })).toMatchObject({
      deliveryMode: 'queue',
      queueMessageId: 'persisted-message-1',
    });
    expect(MessageMetaSchema.safeParse({ deliveryMode: 'steer' }).success).toBe(false);
    expect(MessageMetaSchema.safeParse({ queueMessageId: '  ' }).success).toBe(false);
  });
});
