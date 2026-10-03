import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import { computePermissionsForContext } from "./computePermissionsForContext.js";
import type { ComputeCommandOutcome } from "./startComputeCommand.js";

/**
 * Type into a running command and read what that produced.
 *
 * Input is new instruction reaching a process that may already hold credentials, so it carries
 * the current boundary rather than the one the command started under. Reading afterwards is the
 * same delta read every other command tool does: only what the input actually caused.
 */
export async function writeComputeCommandInput(
    compute: Compute,
    ctx: Context,
    options: {
        readonly commandId: number;
        readonly input: string;
        readonly waitMs: number;
    },
): Promise<ComputeCommandOutcome> {
    const startedAt = Date.now();
    const permissions = computePermissionsForContext(ctx);
    if (!compute.shell.supportsSessionInput) {
        throw new Error("This machine's shell cannot be typed into.");
    }
    const accepted = await compute.shell.writeSession(
        permissions,
        options.commandId,
        options.input,
    );
    if (!accepted) {
        throw new Error(
            `Command ${String(options.commandId)} is not running, so there is nothing to type into.`,
        );
    }
    const snapshot = await compute.shell.readSession(options.commandId, {
        ...(ctx.lifetime === undefined ? {} : { signal: ctx.lifetime }),
        waitMs: options.waitMs,
    });
    if (snapshot === undefined) {
        throw new Error(`There is no command ${String(options.commandId)} on this machine.`);
    }
    return { snapshot, wallTimeSeconds: (Date.now() - startedAt) / 1_000 };
}
