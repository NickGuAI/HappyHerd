import { describe, expect, it } from 'vitest';
import { MessageMetaSchema } from './typesMessageMeta';

describe('MessageMetaSchema', () => {
    it('accepts arbitrary permission mode keys', () => {
        const parsed = MessageMetaSchema.parse({
            permissionMode: 'team-custom-mode',
            model: 'custom-model',
        });

        expect(parsed.permissionMode).toBe('team-custom-mode');
        expect(parsed.model).toBe('custom-model');
    });

    it('accepts only the explicit queue delivery override', () => {
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
