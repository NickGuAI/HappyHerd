import { describe, expect, it } from 'vitest';

import { rpcAckTimeoutMs } from './rpcTimeout';

describe('rpcAckTimeoutMs', () => {
    it('keeps the app acknowledgement open for side-chat creation', () => {
        expect(rpcAckTimeoutMs('machine:happyherd-side-chat-create')).toBe(260_000);
        expect(rpcAckTimeoutMs('machine:happyherd-list-commanders')).toBe(50_000);
    });
});
