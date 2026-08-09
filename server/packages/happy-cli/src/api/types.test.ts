import { describe, expect, it } from 'vitest';

import { MessageMetaSchema } from './types';

describe('CLI message metadata contract', () => {
  it('preserves the explicit provider queue delivery override', () => {
    expect(MessageMetaSchema.parse({ deliveryMode: 'queue' }).deliveryMode).toBe('queue');
    expect(MessageMetaSchema.safeParse({ deliveryMode: 'steer' }).success).toBe(false);
  });
});
