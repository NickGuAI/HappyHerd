import { describe, expect, it } from 'vitest';

import type { Message, ToolCallMessage, UserTextMessage } from './typesMessage';
import { projectSessionQueue } from './queueProjection';

function queuedUser(id: string, text: string): UserTextMessage {
    return {
        kind: 'user-text',
        id: `server-${id}`,
        localId: id,
        createdAt: 2,
        text: `context:${text}`,
        displayText: text,
        meta: { deliveryMode: 'queue', queueMessageId: id },
    };
}

function queuedAttachment(id: string, name: string): ToolCallMessage {
    return {
        kind: 'tool-call',
        id: `attachment-${id}-${name}`,
        localId: `attachment-local-${id}-${name}`,
        createdAt: 1,
        tool: {
            name: 'file',
            state: 'completed',
            input: { name, ref: `ref-${name}` },
            createdAt: 1,
            startedAt: 1,
            completedAt: 1,
            description: null,
        },
        children: [],
        meta: { deliveryMode: 'queue', queueMessageId: id },
    };
}

describe('projectSessionQueue', () => {
    it('keeps distinct FIFO waiting messages and their attachments out of chat', () => {
        const first = queuedUser('queue-1', 'first');
        const second = queuedUser('queue-2', 'second');
        const image = queuedAttachment('queue-1', 'image.png');
        const agent: Message = {
            kind: 'agent-text',
            id: 'agent-1',
            localId: null,
            createdAt: 3,
            text: 'still working',
        };

        const projection = projectSessionQueue([agent, second, first, image], {
            pendingMessageIds: ['queue-1', 'queue-2'],
            currentMessageIds: [],
        });

        expect(projection.pendingItems.map((item) => item.id)).toEqual(['queue-1', 'queue-2']);
        expect(projection.pendingItems[0].message.displayText).toBe('first');
        expect(projection.pendingItems[0].attachments).toEqual([image]);
        expect(projection.transcriptMessages).toEqual([agent]);
    });

    it('reveals existing current records once without cloning them', () => {
        const current = queuedUser('queue-current', 'now running');
        const image = queuedAttachment('queue-current', 'current.png');
        const projection = projectSessionQueue([current, image], {
            pendingMessageIds: [],
            currentMessageIds: ['queue-current'],
        });

        expect(projection.currentItems[0].message).toBe(current);
        expect(projection.transcriptMessages).toEqual([current, image]);
    });

    it('renders all messages normally when the runtime has no queue state', () => {
        const legacy = queuedUser('legacy-queue', 'legacy');
        const messages: Message[] = [legacy];
        const projection = projectSessionQueue(messages);

        expect(projection.pendingCount).toBe(0);
        expect(projection.currentCount).toBe(0);
        expect(projection.transcriptMessages).toBe(messages);
    });

    it('keeps authoritative counts when content has not arrived yet', () => {
        const projection = projectSessionQueue([], {
            pendingMessageIds: ['not-fetched'],
            currentMessageIds: ['current-not-fetched'],
        });

        expect(projection.pendingItems).toEqual([]);
        expect(projection.currentItems).toEqual([]);
        expect(projection.pendingCount).toBe(1);
        expect(projection.currentCount).toBe(1);
    });
});
