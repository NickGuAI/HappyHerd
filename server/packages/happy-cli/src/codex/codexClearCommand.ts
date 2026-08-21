import { parseSpecialCommand } from '@/parsers/specialCommands';
import type { PendingAttachment } from '@/utils/MessageQueue2';
import { parseCodexGoalCommand } from './codexGoalStatus';

type CodexUserTextQueue<T> = {
    push: (message: string, mode: T, attachments?: PendingAttachment[], queueMessageId?: string) => void;
    pushIsolateAndClear: (message: string, mode: T, attachments?: PendingAttachment[], queueMessageId?: string) => void;
    pushIsolated: (message: string, mode: T, attachments?: PendingAttachment[], queueMessageId?: string) => void;
};

export function isCodexClearText(text: string): boolean {
    return parseSpecialCommand(text).type === 'clear';
}

export function enqueueCodexUserText<T>(opts: {
    text: string;
    mode: T;
    queue: CodexUserTextQueue<T>;
    attachments?: PendingAttachment[];
    queueMessageId?: string;
}): 'clear' | 'goal' | 'queued' {
    if (isCodexClearText(opts.text)) {
        if (opts.queueMessageId) {
            opts.queue.pushIsolateAndClear(opts.text, opts.mode, opts.attachments, opts.queueMessageId);
        } else {
            opts.queue.pushIsolateAndClear(opts.text, opts.mode, opts.attachments);
        }
        return 'clear';
    }

    if (parseCodexGoalCommand(opts.text)) {
        // Goal commands must retain their own queue boundary. Otherwise an
        // active turn can leave them adjacent to ordinary input, which makes
        // MessageQueue2 batch both strings and prevents command recognition.
        if (opts.queueMessageId) {
            opts.queue.pushIsolated(opts.text, opts.mode, opts.attachments, opts.queueMessageId);
        } else {
            opts.queue.pushIsolated(opts.text, opts.mode, opts.attachments);
        }
        return 'goal';
    }

    if (opts.queueMessageId) {
        opts.queue.push(opts.text, opts.mode, opts.attachments, opts.queueMessageId);
    } else {
        opts.queue.push(opts.text, opts.mode, opts.attachments);
    }
    return 'queued';
}
