import { isCodexClearText } from './codexClearCommand';
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
