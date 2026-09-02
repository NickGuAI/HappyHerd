import type { AttachmentPreview } from './attachmentTypes';
import type { SendMessageOptions, SendMessageReceipt } from './sync';

export type WorkspaceFeedbackReference = {
    machineId: string;
    machineLabel?: string | null;
    absolutePath: string;
    line?: number;
    column?: number;
};

export type WorkspaceFeedbackMessage = {
    promptText: string;
    displayText: string;
};

export type WorkspaceFeedbackComment = Readonly<{
    id: string;
    feedback: string;
    line?: number;
    column?: number;
    nodeId?: string;
    position?: Readonly<{ x: number; y: number }>;
}>;

export type WorkspaceFeedbackSender = (
    sessionId: string,
    text: string,
    options: SendMessageOptions & { requireAllAttachments: true },
) => Promise<SendMessageReceipt>;

function serializeStructuredFieldValue(value: string): string {
    return JSON.stringify(value)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

export function buildWorkspaceFeedbackMessage(
    reference: WorkspaceFeedbackReference,
    feedback: string | readonly WorkspaceFeedbackComment[],
): WorkspaceFeedbackMessage {
    const machineLabel = reference.machineLabel?.trim() || reference.machineId;
    const comments = typeof feedback === 'string' ? null : feedback;
    const feedbackLines = comments === null
        ? ['Feedback:', feedback]
        : [
            'Comments:',
            ...comments.flatMap((comment, index) => [
                '',
                `${index + 1}.`,
                ...(comment.line === undefined ? [] : [`Line: ${comment.line}`]),
                ...(comment.column === undefined ? [] : [`Column: ${comment.column}`]),
                ...(comment.nodeId === undefined ? [] : [`Canvas node ID: ${serializeStructuredFieldValue(comment.nodeId)}`]),
                ...(comment.position === undefined ? [] : [`Canvas node position: ${comment.position.x}, ${comment.position.y}`]),
                'Feedback:',
                comment.feedback,
            ]),
        ];
    const promptText = [
        'Workspace file feedback',
        '',
        `Machine: ${machineLabel}`,
        `Machine ID: ${reference.machineId}`,
        `Absolute path: ${reference.absolutePath}`,
        ...(reference.line === undefined ? [] : [`Line: ${reference.line}`]),
        ...(reference.column === undefined ? [] : [`Column: ${reference.column}`]),
        '',
        ...feedbackLines,
    ].join('\n');
    const displayFeedback = comments === null
        ? feedback
        : comments.map((comment, index) => {
            const anchor = comment.nodeId
                ? `node ${serializeStructuredFieldValue(comment.nodeId)}`
                : `line ${comment.line ?? '?'}`;
            return `${index + 1}. ${anchor}: ${comment.feedback}`;
        }).join('\n');
    const displayText = [
        machineLabel,
        `${reference.absolutePath}${reference.line === undefined ? '' : `:${reference.line}${reference.column === undefined ? '' : `:${reference.column}`}`}`,
        '',
        displayFeedback,
    ].join('\n');

    return {
        promptText,
        displayText,
    };
}

export async function submitWorkspaceFeedback(args: {
    originSessionId: string;
    reference: WorkspaceFeedbackReference;
    feedback: string | readonly WorkspaceFeedbackComment[];
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
