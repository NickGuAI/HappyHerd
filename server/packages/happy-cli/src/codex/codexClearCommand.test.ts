import { describe, expect, it, vi } from 'vitest';

import { MessageQueue2 } from '@/utils/MessageQueue2';
import { enqueueCodexUserText } from './codexClearCommand';

describe('enqueueCodexUserText', () => {
    it('queues /clear in isolation instead of batching it into a model prompt', () => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
            pushIsolated: vi.fn(),
        };

        const result = enqueueCodexUserText({
            text: '  /clear  ',
            mode,
            queue,
        });

        expect(result).toBe('clear');
        expect(queue.pushIsolateAndClear).toHaveBeenCalledWith('  /clear  ', mode, undefined);
        expect(queue.push).not.toHaveBeenCalled();
        expect(queue.pushIsolated).not.toHaveBeenCalled();
    });

    it.each([
        '/goal verify the release',
        '/goal clear',
    ])('queues %s alone without discarding pending work', (text) => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
            pushIsolated: vi.fn(),
        };

        const result = enqueueCodexUserText({ text, mode, queue });

        expect(result).toBe('goal');
        expect(queue.pushIsolated).toHaveBeenCalledOnce();
        expect(queue.pushIsolated).toHaveBeenCalledWith(text, mode, undefined);
        expect(queue.push).not.toHaveBeenCalled();
        expect(queue.pushIsolateAndClear).not.toHaveBeenCalled();
    });

    it('preserves one goal item between already queued turns without batching or duplication', async () => {
        const mode = { permissionMode: 'default' as const };
        const queue = new MessageQueue2<typeof mode>(JSON.stringify);

        enqueueCodexUserText({ text: 'before goal', mode, queue });
        enqueueCodexUserText({ text: '/goal verify the release', mode, queue });
        enqueueCodexUserText({ text: 'after goal', mode, queue });

        expect((await queue.waitForMessagesAndGetAsString())?.message).toBe('before goal');
        expect((await queue.waitForMessagesAndGetAsString())?.message).toBe('/goal verify the release');
        expect((await queue.waitForMessagesAndGetAsString())?.message).toBe('after goal');
        expect(queue.size()).toBe(0);
    });

    it('passes attachments to normal queued messages', () => {
        const mode = { permissionMode: 'default' as const };
        const attachments = [{
            data: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            name: 'screen.png',
        }];
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
            pushIsolated: vi.fn(),
        };

        const result = enqueueCodexUserText({
            text: 'inspect this image',
            mode,
            queue,
            attachments,
        });

        expect(result).toBe('queued');
        expect(queue.push).toHaveBeenCalledWith('inspect this image', mode, attachments);
        expect(queue.pushIsolateAndClear).not.toHaveBeenCalled();
        expect(queue.pushIsolated).not.toHaveBeenCalled();
    });

    it('preserves the persisted queue message ID', () => {
        const mode = { permissionMode: 'default' as const };
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
            pushIsolated: vi.fn(),
        };

        enqueueCodexUserText({
            text: 'queued from the app',
            mode,
            queue,
            queueMessageId: 'persisted-message-1',
        });

        expect(queue.push).toHaveBeenCalledWith(
            'queued from the app',
            mode,
            undefined,
            'persisted-message-1',
        );
    });

    it('passes attachments to isolated clear messages', () => {
        const mode = { permissionMode: 'default' as const };
        const attachments = [{
            data: new Uint8Array([4, 5, 6]),
            mimeType: 'image/jpeg',
            name: 'photo.jpg',
        }];
        const queue = {
            push: vi.fn(),
            pushIsolateAndClear: vi.fn(),
            pushIsolated: vi.fn(),
        };

        const result = enqueueCodexUserText({
            text: '/clear',
            mode,
            queue,
            attachments,
        });

        expect(result).toBe('clear');
        expect(queue.pushIsolateAndClear).toHaveBeenCalledWith('/clear', mode, attachments);
        expect(queue.push).not.toHaveBeenCalled();
        expect(queue.pushIsolated).not.toHaveBeenCalled();
    });
});
