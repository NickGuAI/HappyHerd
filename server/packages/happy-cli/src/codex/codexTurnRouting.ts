import type { MessageQueue2, PendingAttachment } from '@/utils/MessageQueue2';
import type { PermissionMode } from '@/api/types';
import { enqueueCodexUserText, isCodexClearText } from './codexClearCommand';
import type { CodexSteerTurnResult } from './codexAppServerClient';
import { parseCodexGoalCommand } from './codexGoalStatus';

const CODEX_REMOTE_PERMISSION_MODES: readonly PermissionMode[] = [
    'default',
    'auto',
    'read-only',
    'safe-yolo',
    'yolo',
];

export function parseCodexRemotePermissionMode(value: string): PermissionMode | null {
    return CODEX_REMOTE_PERMISSION_MODES.includes(value as PermissionMode)
        ? value as PermissionMode
        : null;
}

/**
 * Native steering is only for ordinary input while Codex owns an active turn.
 * HappyHerd control commands stay on the local control path so they cannot be
 * accidentally injected into the model as conversational text.
 */
export function shouldSteerCodexUserInput(
    text: string,
    activeTurnId: string | null,
    deliveryMode?: 'queue',
    activePermissionMode?: PermissionMode,
    incomingPermissionMode?: PermissionMode,
    hasQueuedInput = false,
): boolean {
    if (deliveryMode === 'queue') return false;
    if (!activeTurnId) return false;
    // Once any follow-up has been queued, later input must stay FIFO instead
    // of overtaking it through turn/steer under another permission policy.
    if (hasQueuedInput) return false;
    // turn/steer carries input only; it cannot update approvalPolicy or
    // sandboxPolicy. Queue a mode-changing follow-up so the next turn starts
    // under the permission mode shown in the composer.
    if (activePermissionMode && incomingPermissionMode && activePermissionMode !== incomingPermissionMode) {
        return false;
    }
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
