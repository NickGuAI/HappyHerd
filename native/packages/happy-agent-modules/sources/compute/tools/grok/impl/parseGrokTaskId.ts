/**
 * Turn one of Grok's task IDs into the command ID this machine actually uses.
 *
 * Grok's surface talks about tasks as strings, while a command on this machine is numbered, so
 * something has to sit between the two. Anything that is not a whole number above zero is
 * refused here in words the model can act on, rather than becoming a lookup for command NaN.
 */
export function parseGrokTaskId(taskId: string): number {
    const trimmed = taskId.trim();
    if (!/^\d+$/u.test(trimmed)) {
        throw new Error(
            `${JSON.stringify(taskId)} is not a background command task ID. A task ID is the whole number run_terminal_command handed back.`,
        );
    }
    const commandId = Number(trimmed);
    if (!Number.isSafeInteger(commandId) || commandId <= 0) {
        throw new Error(
            `${JSON.stringify(taskId)} is not a background command task ID. A task ID is the whole number run_terminal_command handed back.`,
        );
    }
    return commandId;
}
