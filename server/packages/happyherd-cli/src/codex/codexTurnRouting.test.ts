import { describe, expect, it, vi } from 'vitest';

import { MessageQueue2, type PendingAttachment } from '@/utils/MessageQueue2';
import type { CodexEnhancedMode } from './codexPrompt';
import {
    deliverCodexActiveTurnInput,
    parseCodexRemotePermissionMode,
    shouldSteerCodexUserInput,
} from './codexTurnRouting';

describe('Codex turn routing', () => {
    it('rejects an explicit unknown permission instead of retaining the previous turn policy', () => {
        expect(parseCodexRemotePermissionMode('yolo')).toBe('yolo');
        expect(parseCodexRemotePermissionMode('mode-from-the-future')).toBeNull();
    });
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

    it('queues a permission-mode change because turn/steer cannot carry execution policy', () => {
        expect(shouldSteerCodexUserInput(
            'continue with read-only access',
            'turn-1',
            undefined,
            'yolo',
            'read-only',
        )).toBe(false);
        expect(shouldSteerCodexUserInput(
            'continue under the same policy',
            'turn-1',
            undefined,
            'safe-yolo',
            'safe-yolo',
        )).toBe(true);
    });

    it('keeps later input behind an already queued mode-changing follow-up', () => {
        expect(shouldSteerCodexUserInput(
            'do not overtake the queued read-only turn',
            'turn-1',
            undefined,
            'yolo',
            'yolo',
            true,
        )).toBe(false);
    });

    it('queues a developer-instruction change because turn/steer carries user input only', () => {
        expect(shouldSteerCodexUserInput(
            'automation follow-up',
            'turn-1',
            undefined,
            'safe-yolo',
            'safe-yolo',
            false,
            'Human safeguard enabled',
            'Automation safeguard suppressed',
        )).toBe(false);
        expect(shouldSteerCodexUserInput(
            'same Human mode',
            'turn-1',
            undefined,
            'safe-yolo',
            'safe-yolo',
            false,
            'Human safeguard enabled',
            'Human safeguard enabled',
        )).toBe(true);
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
            developerInstructions: 'preserve this instruction',
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
