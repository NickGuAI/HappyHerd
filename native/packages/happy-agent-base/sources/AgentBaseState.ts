import type { AnyAgentTool } from "./AgentTool.js";

/**
 * The mutable configuration of a running agent. The constructor copies the provided initial
 * state into the agent's own `state`, which may then be mutated directly; every inference reads
 * the current values.
 */
export interface AgentBaseState {
    /** The base system instructions for the session; hooks may extend this before inference. */
    instructions: string;
    /** The base tools offered to the model; hooks may extend this before inference or a call. */
    tools: AnyAgentTool[];
}
