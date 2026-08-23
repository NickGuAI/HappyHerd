import type { AttachmentPreview } from './attachmentTypes';
import type { SendMessageOptions, SendMessageReceipt } from './sync';

export type WorkspaceFeedbackReference = {
    machineId: string;
    machineLabel?: string | null;
    absolutePath: string;
};

export type WorkspaceFeedbackMessage = {
    promptText: string;
    displayText: string;
};

export type WorkspaceFeedbackSender = (
    sessionId: string,
    text: string,
    options: SendMessageOptions & { requireAllAttachments: true },
) => Promise<SendMessageReceipt>;

export function buildWorkspaceFeedbackMessage(
    reference: WorkspaceFeedbackReference,
    feedback: string,
): WorkspaceFeedbackMessage {
    const machineLabel = reference.machineLabel?.trim() || reference.machineId;
    const promptText = [
        'Workspace file feedback',
        '',
        `Machine: ${machineLabel}`,
        `Machine ID: ${reference.machineId}`,
        `Absolute path: ${reference.absolutePath}`,
        '',
        'Feedback:',
        feedback,
    ].join('\n');
    const displayText = [
        machineLabel,
        reference.absolutePath,
        '',
        feedback,
    ].join('\n');

    return {
        promptText,
        displayText,
    };
}

export async function submitWorkspaceFeedback(args: {
    originSessionId: string;
    reference: WorkspaceFeedbackReference;
    feedback: string;
    attachments: AttachmentPreview[];
    sendMessage: WorkspaceFeedbackSender;
}): Promise<SendMessageReceipt> {
    const message = buildWorkspaceFeedbackMessage(args.reference, args.feedback);
    return args.sendMessage(args.originSessionId, message.promptText, {
        displayText: message.displayText,
        attachments: args.attachments,
        requireAllAttachments: true,
    });
}
