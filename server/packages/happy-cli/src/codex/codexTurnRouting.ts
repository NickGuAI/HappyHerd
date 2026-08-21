import type { MessageQueue2, PendingAttachment } from '@/utils/MessageQueue2';
import { enqueueCodexUserText, isCodexClearText } from './codexClearCommand';
import type { CodexSteerTurnResult } from './codexAppServerClient';
import { parseCodexGoalCommand } from './codexGoalStatus';

/**
 * Native steering is only for ordinary input while Codex owns an active turn.
 * HappyHerd control commands stay on the local control path so they cannot be
 * accidentally injected into the model as conversational text.
 */
export function shouldSteerCodexUserInput(
    text: string,
    activeTurnId: string | null,
    deliveryMode?: 'queue',
): boolean {
    if (deliveryMode === 'queue') return false;
    if (!activeTurnId) return false;
    if (isCodexClearText(text)) return false;
    if (parseCodexGoalCommand(text)) return false;
    return true;
}

/**
 * Deliver input aimed at an active provider turn. Only a definitive inactive
 * result is safe to enqueue: every thrown transport or provider error is
 * ambiguous and must not replay input that Codex may already have accepted.
 */
export async function deliverCodexActiveTurnInput<T>(opts: {
    steer: () => Promise<CodexSteerTurnResult>;
    text: string;
    mode: T;
    queue: MessageQueue2<T>;
    attachments?: PendingAttachment[];
}): Promise<'steered' | 'queued'> {
    const result = await opts.steer();
    if (result === 'steered') {
        return 'steered';
    }

    enqueueCodexUserText({
        text: opts.text,
        mode: opts.mode,
        queue: opts.queue,
        attachments: opts.attachments,
    });
    return 'queued';
}
