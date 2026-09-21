import type { AttachmentPreview } from './attachmentTypes';
import type { SendMessageOptions, SendMessageReceipt } from './sync';

export type WorkspaceFeedbackReference = {
    machineId: string;
    machineLabel?: string | null;
    absolutePath?: string;
    liveUrl?: string;
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
    elementSelector?: string;
    elementHtml?: string;
    elementCss?: string;
    elementBounds?: Readonly<{ x: number; y: number; width: number; height: number }>;
    screenshot?: AttachmentPreview;
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
    if (!reference.absolutePath && !reference.liveUrl) {
        throw new Error('Workspace feedback requires a file path or live URL');
    }
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
                ...(comment.elementSelector === undefined ? [] : [`Element selector: ${serializeStructuredFieldValue(comment.elementSelector)}`]),
                ...(comment.elementHtml === undefined ? [] : [`Element HTML: ${serializeStructuredFieldValue(comment.elementHtml)}`]),
                ...(comment.elementCss === undefined ? [] : [`Element CSS: ${serializeStructuredFieldValue(comment.elementCss)}`]),
                ...(comment.elementBounds === undefined ? [] : [
                    `Element bounds: ${comment.elementBounds.x}, ${comment.elementBounds.y}, ${comment.elementBounds.width}, ${comment.elementBounds.height}`,
                ]),
                ...(comment.screenshot === undefined ? [] : [`Element screenshot: ${serializeStructuredFieldValue(comment.screenshot.name)}`]),
                'Feedback:',
                comment.feedback,
            ]),
        ];
    const promptText = [
        reference.liveUrl ? 'Workspace live page feedback' : 'Workspace file feedback',
        '',
        `Machine: ${machineLabel}`,
        `Machine ID: ${reference.machineId}`,
        ...(reference.absolutePath ? [`Absolute path: ${reference.absolutePath}`] : []),
        ...(reference.liveUrl ? [`Live URL: ${reference.liveUrl}`] : []),
        ...(reference.line === undefined ? [] : [`Line: ${reference.line}`]),
        ...(reference.column === undefined ? [] : [`Column: ${reference.column}`]),
        '',
        ...feedbackLines,
    ].join('\n');
    const displayFeedback = comments === null
        ? feedback
        : comments.map((comment, index) => {
            const anchor = comment.elementSelector
                ? `element ${serializeStructuredFieldValue(comment.elementSelector)}`
                : comment.nodeId
                ? `node ${serializeStructuredFieldValue(comment.nodeId)}`
                : `line ${comment.line ?? '?'}`;
            return `${index + 1}. ${anchor}: ${comment.feedback}`;
        }).join('\n');
    const displayText = [
        machineLabel,
        reference.liveUrl ?? `${reference.absolutePath}${reference.line === undefined ? '' : `:${reference.line}${reference.column === undefined ? '' : `:${reference.column}`}`}`,
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
