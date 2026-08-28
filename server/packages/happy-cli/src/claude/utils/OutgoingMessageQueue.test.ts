import { describe, expect, it } from 'vitest';

import { OutgoingMessageQueue } from './OutgoingMessageQueue';

describe('OutgoingMessageQueue', () => {
    it('awaits asynchronous sends so later provider output cannot overtake an image upload', async () => {
        const order: string[] = [];
        let releaseImage!: () => void;
        const imageUploaded = new Promise<void>((resolve) => { releaseImage = resolve; });
        const queue = new OutgoingMessageQueue(async (message) => {
            if (message.id === 'image') {
                order.push('image-start');
                await imageUploaded;
                order.push('image-end');
                return;
            }
            order.push(message.id);
        });

        queue.enqueue({ type: 'assistant', id: 'image' });
        queue.enqueue({ type: 'assistant', id: 'later-text' });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(order).toEqual(['image-start']);

        releaseImage();
        await queue.flush();
        expect(order).toEqual(['image-start', 'image-end', 'later-text']);
        queue.destroy();
    });
});
