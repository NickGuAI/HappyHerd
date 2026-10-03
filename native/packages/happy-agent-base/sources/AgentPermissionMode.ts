import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * How much of the machine an agent is allowed to touch, as one of four modes.
 *
 * The mode is part of what an agent is running on, exactly like its model: it is carried on every
 * context the agent derives, it is durable, and a message may change it. What the runtime does not
 * do is enforce it — the loop has no idea what any particular tool touches. Enforcement belongs to
 * the modules and tools that know, and they read the mode in force from the context they are
 * given.
 */
export const agentPermissionModeSchema = Type.Union(
    [
        /** Inspection only: nothing may be changed and the shell reaches no network. */
        Type.Literal("read_only"),
        /** Changes inside the workspace, with shell network and outside writes still blocked. */
        Type.Literal("workspace_write"),
        /** The workspace sandbox, plus a review that may allow one action to cross it. */
        Type.Literal("auto"),
        /** No filesystem, shell, or network restriction of Rig's own. */
        Type.Literal("full_access"),
    ],
    { description: "How much of the machine the agent may touch." },
);

/** The TypeScript type inferred from {@link agentPermissionModeSchema}. */
export type AgentPermissionMode = Static<typeof agentPermissionModeSchema>;

/**
 * The mode an agent runs in when nobody has said otherwise. Auto is the product's default: work
 * happens in the sandbox, and the one action that has to leave it is reviewed rather than refused.
 */
export const DEFAULT_AGENT_PERMISSION_MODE: AgentPermissionMode = "auto";

/**
 * Whether a value is one of the four modes. Durable state is read back through this rather than
 * trusted, so a store holding something else falls back to the mode the agent was built with
 * instead of running under a mode nothing can interpret.
 */
export function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
    return Value.Check(agentPermissionModeSchema, value);
}

/** The mode's name in the words a person reads, for anything shown to a person or a model. */
export function agentPermissionModeLabel(mode: AgentPermissionMode): string {
    switch (mode) {
        case "read_only":
            return "Read only";
        case "workspace_write":
            return "Workspace write";
        case "auto":
            return "Auto";
        case "full_access":
            return "Full access";
    }
}
