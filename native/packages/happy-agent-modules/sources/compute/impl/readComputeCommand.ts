import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import type { ComputeCommandOutcome } from "./startComputeCommand.js";

/**
 * Collect what a command has produced since it was last read.
 *
 * Only new output comes back. The model already has everything it was told before, and repeating
 * the whole log on every read spends the context on repetition. A command that has ended keeps
 * answering for a while, so its last words are never lost to a read that arrived late.
 */
export async function readComputeCommand(
    compute: Compute,
    ctx: Context,
    options: { readonly commandId: number; readonly waitMs: number },
): Promise<ComputeCommandOutcome> {
    const startedAt = Date.now();
    const snapshot = await compute.shell.readSession(options.commandId, {
        ...(ctx.lifetime === undefined ? {} : { signal: ctx.lifetime }),
        waitMs: options.waitMs,
    });
    if (snapshot === undefined) {
        throw new Error(`There is no command ${String(options.commandId)} on this machine.`);
    }
    return { snapshot, wallTimeSeconds: (Date.now() - startedAt) / 1_000 };
}
