import type { Compute } from "../Compute.js";

/** What stopping one command found. */
export interface ComputeCommandStop {
    readonly command: string;
    readonly commandId: number;
    /** False when the command had already ended by itself. */
    readonly stopped: boolean;
}

/**
 * End a command and everything it started.
 *
 * The command is asked to stop first and forced a moment later. Stopping one that had already
 * ended is not a failure — the outcome the caller wanted is the outcome it has — so it comes back
 * as a plain statement of what was found.
 */
export async function stopComputeCommand(
    compute: Compute,
    options: { readonly commandId: number },
): Promise<ComputeCommandStop> {
    const current = await compute.shell.readSession(options.commandId, { peek: true });
    if (current === undefined) {
        throw new Error(`There is no command ${String(options.commandId)} on this machine.`);
    }
    if (current.status !== "running") {
        return { command: current.command, commandId: options.commandId, stopped: false };
    }
    const stopped = await compute.shell.killSession(options.commandId);
    return {
        command: stopped?.command ?? current.command,
        commandId: options.commandId,
        stopped: true,
    };
}
