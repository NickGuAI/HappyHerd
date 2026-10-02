import { createContextNamespace, type Context } from "@steve.kite/stdlib";

import type { AgentDatabase } from "./AgentDatabase.js";
import type { AgentSystemRef } from "./AgentSystemRef.js";

/** The context slot that carries the collection owning the current agent or module operation. */
const agentSystemNamespace = createContextNamespace<AgentSystemRef | undefined>(
    "happyAgent.agentSystem",
    undefined,
);

/**
 * Carry the collection that owns an agent and its modules, as a reference.
 *
 * Only the reference travels on a context. Everything that reads one — a module hook, a tool —
 * is code some run loop is waiting for, while the owner's surface holds the operations that wait
 * for a loop to reach a particular point. A collection therefore puts an `AgentSystemRef` on
 * every context it derives, and agents come back from it as `AgentRef`, so nothing reached
 * through a context can wait for the loop that is waiting for it.
 */
export function withAgentSystem<Database extends AgentDatabase>(
    ctx: Context,
    value: AgentSystemRef<Database>,
): Context {
    return agentSystemNamespace.set(ctx, value as unknown as AgentSystemRef);
}

/** The collection owning the current module or agent operation. */
export function agentSystem(ctx: Context): AgentSystemRef | undefined {
    return agentSystemNamespace.get(ctx);
}
