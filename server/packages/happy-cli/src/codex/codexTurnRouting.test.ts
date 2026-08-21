import { describe, expect, it, vi } from 'vitest';

import { MessageQueue2, type PendingAttachment } from '@/utils/MessageQueue2';
import type { CodexEnhancedMode } from './codexPrompt';
import { deliverCodexActiveTurnInput, shouldSteerCodexUserInput } from './codexTurnRouting';

describe('Codex turn routing', () => {
    it('starts a new turn when Codex is idle', () => {
        expect(shouldSteerCodexUserInput('follow up', null)).toBe(false);
    });

    it('steers ordinary input into the active provider turn', () => {
        expect(shouldSteerCodexUserInput('follow up', 'turn-1')).toBe(true);
        expect(shouldSteerCodexUserInput('', 'turn-1')).toBe(true);
    });

    it('keeps local control commands out of turn steering', () => {
        expect(shouldSteerCodexUserInput('/clear', 'turn-1')).toBe(false);
        expect(shouldSteerCodexUserInput('/goal verify the release', 'turn-1')).toBe(false);
        expect(shouldSteerCodexUserInput('/goal clear', 'turn-1')).toBe(false);
    });

    it('keeps an explicitly queued follow-up on the existing provider queue rail', () => {
        expect(shouldSteerCodexUserInput('run this after the current turn', 'turn-1', 'queue')).toBe(false);
    });

    it('leaves a successfully steered follow-up out of the local queue', async () => {
        const mode: CodexEnhancedMode = { permissionMode: 'default' };
        const queue = new MessageQueue2<CodexEnhancedMode>(() => 'same-mode');
        const push = vi.spyOn(queue, 'push');

        await expect(deliverCodexActiveTurnInput({
            steer: async () => 'steered',
            text: 'follow up',
            mode,
            queue,
            attachments: [],
        })).resolves.toBe('steered');

        expect(push).not.toHaveBeenCalled();
        expect(queue.queue).toHaveLength(0);
    });

    it('queues the untouched follow-up exactly once when the provider turn is inactive', async () => {
        const mode: CodexEnhancedMode = {
            permissionMode: 'yolo',
            model: 'gpt-test',
            effort: 'max',
            appendSystemPrompt: 'preserve this instruction',
        };
        const attachments: PendingAttachment[] = [{
            data: new Uint8Array([1, 2, 3]),
            mimeType: 'image/png',
            name: 'follow-up.png',
        }];
        const queue = new MessageQueue2<CodexEnhancedMode>(() => 'same-mode');

        await expect(deliverCodexActiveTurnInput({
            steer: async () => 'turn-not-active',
            text: 'follow up',
            mode,
            queue,
            attachments,
        })).resolves.toBe('queued');

        expect(queue.queue).toHaveLength(1);
        expect(queue.queue[0]).toMatchObject({
            message: 'follow up',
            mode,
            attachments,
        });
        expect(queue.queue[0]?.mode).toBe(mode);
        expect(queue.queue[0]?.attachments).toBe(attachments);
    });

    it('does not queue after an ambiguous steering error', async () => {
        const mode: CodexEnhancedMode = { permissionMode: 'default' };
        const queue = new MessageQueue2<CodexEnhancedMode>(() => 'same-mode');
        const push = vi.spyOn(queue, 'push');
        const error = new Error('transport disconnected');

        await expect(deliverCodexActiveTurnInput({
            steer: async () => { throw error; },
            text: 'follow up',
            mode,
            queue,
            attachments: [],
        })).rejects.toBe(error);

        expect(push).not.toHaveBeenCalled();
        expect(queue.queue).toHaveLength(0);
    });
});
