import { describe, expect, it, vi } from 'vitest';
import type { AttachmentPreview } from './attachmentTypes';
import { buildWorkspaceFeedbackMessage, submitWorkspaceFeedback } from './workspaceFeedback';

const reference = {
    machineId: 'machine-123',
    machineLabel: 'Studio Mac',
    absolutePath: '/Users/nick/project/docs/plan.md',
};

const image: AttachmentPreview = {
    id: 'image-1',
    uri: 'file:///feedback.png',
    width: 1200,
    height: 800,
    mimeType: 'image/png',
    size: 4096,
    name: 'feedback.png',
};

describe('workspace feedback messages', () => {
    it('keeps agent instructions explicit while presenting language-neutral provenance to the user', () => {
        const feedback = 'The heading wraps too early.\nKeep `code` unchanged.';
        const result = buildWorkspaceFeedbackMessage(reference, feedback);

        expect(result.promptText).toContain('Machine: Studio Mac');
        expect(result.promptText).toContain('Machine ID: machine-123');
        expect(result.promptText).toContain('Absolute path: /Users/nick/project/docs/plan.md');
        expect(result.promptText).toContain(feedback);
        expect(result.displayText).toBe([
            'Studio Mac',
            '/Users/nick/project/docs/plan.md',
            '',
            feedback,
        ].join('\n'));
        expect(result.displayText).not.toContain('Machine:');
        expect(result.displayText).not.toContain('Absolute path:');

        expect(buildWorkspaceFeedbackMessage({
            ...reference,
            machineLabel: '  ',
        }, feedback).displayText).toContain('machine-123\n/Users/nick/project/docs/plan.md');
    });

    it('does not accept or include file contents', () => {
        const input = {
            ...reference,
            fileContents: 'PRIVATE FILE CONTENTS',
        };

        const result = buildWorkspaceFeedbackMessage(input, 'Please revise the title.');

        expect(result.promptText).not.toContain('PRIVATE FILE CONTENTS');
        expect(result.displayText).not.toContain('PRIVATE FILE CONTENTS');
    });

    it('includes the active file position without including file contents', () => {
        const result = buildWorkspaceFeedbackMessage({ ...reference, line: 19, column: 6 }, 'Rename this symbol.');

        expect(result.promptText).toContain('Line: 19');
        expect(result.promptText).toContain('Column: 6');
        expect(result.displayText).toContain('/Users/nick/project/docs/plan.md:19:6');
    });

    it('submits to the immutable origin session with strict attachment semantics', async () => {
        const sendMessage = vi.fn().mockResolvedValue({ localId: 'text-local-id' });

        await expect(submitWorkspaceFeedback({
            originSessionId: 'origin-session',
            reference,
            feedback: '',
            attachments: [image],
            sendMessage,
        })).resolves.toEqual({ localId: 'text-local-id' });

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith(
            'origin-session',
            expect.stringContaining('Absolute path: /Users/nick/project/docs/plan.md'),
            expect.objectContaining({
                attachments: [image],
                requireAllAttachments: true,
                displayText: expect.stringContaining('Studio Mac\n/Users/nick/project/docs/plan.md'),
            }),
        );
    });

    it('propagates failure without mutating the caller-owned draft or images', async () => {
        const attachments = [image];
        const feedback = 'Keep this draft';
        const sendMessage = vi.fn().mockRejectedValue(new Error('upload failed'));

        await expect(submitWorkspaceFeedback({
            originSessionId: 'origin-session',
            reference,
            feedback,
            attachments,
            sendMessage,
        })).rejects.toThrow('upload failed');

        expect(feedback).toBe('Keep this draft');
        expect(attachments).toEqual([image]);
    });
});
