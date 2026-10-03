import type { AgentMessageMetadata } from "@slopus/happy-agent-base";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * The provenance marker that decides whether a user-role message may ever be trusted as human
 * authorization by the automatic permission reviewer.
 *
 * The reviewer's entire trust model rests on one distinction: a message the human actually typed
 * versus a message an agent, a tool, or the environment produced that merely wears the user role.
 * Provider input shapes only have "user" and "assistant" roles, so goal continuations, collaboration
 * hand-offs, and surfaced shell commands all arrive as `role: "user"`. If trust were inferred from
 * the *absence* of a marker, any of those synthetic messages — including one an agent writes for
 * itself, such as its own goal objective — would be read as the user authorizing an action. That is
 * a forgery path, so trust must require an explicit, positive statement of human origin and never be
 * inferred from missing metadata.
 *
 * The rule is therefore: a host stamps a genuine end-user submission with `messageOrigin: "user"`;
 * everything the system generates on the agent's behalf stamps `messageOrigin: "agent"` (or leaves
 * the field off, which is treated the same way). Only `"user"` is trusted; anything else, including
 * an unstamped message, is untrusted context. This fails closed: a human path that forgets the
 * marker under-authorizes rather than an agent path over-authorizing.
 */

/** The metadata key carrying a message's provenance for the automatic permission reviewer. */
export const MESSAGE_ORIGIN_METADATA_KEY = "messageOrigin";

/** Stamp a message the end user actually submitted; only this provenance may be trusted evidence. */
export const USER_MESSAGE_ORIGIN_METADATA = Object.freeze({
    [MESSAGE_ORIGIN_METADATA_KEY]: "user",
} as const);

/** Stamp a message the system generated on the agent's behalf; never trusted user authorization. */
export const AGENT_MESSAGE_ORIGIN_METADATA = Object.freeze({
    [MESSAGE_ORIGIN_METADATA_KEY]: "agent",
} as const);

/**
 * Whether this message's metadata positively marks it as an end-user submission. A missing marker,
 * an `"agent"` marker, or any other value is not human origin.
 */
export function isUserOriginMetadata(metadata: AgentMessageMetadata | undefined): boolean {
    return ownMetadataValue(metadata, MESSAGE_ORIGIN_METADATA_KEY) === "user";
}

/**
 * One metadata field, read only when the metadata itself carries it.
 *
 * A value reached through the prototype chain was never stamped on this message, and treating one
 * as a stamp would let a shared or polluted prototype authorize every message that omits the
 * marker — the exact forgery this module exists to prevent.
 */
function ownMetadataValue(metadata: AgentMessageMetadata | undefined, key: string): unknown {
    if (metadata === undefined || metadata === null || typeof metadata !== "object") {
        return undefined;
    }
    return Object.hasOwn(metadata, key) ? (metadata as Record<string, unknown>)[key] : undefined;
}

/**
 * The metadata key naming the specific agent that sent a system-generated message: a goal
 * continuation names the agent driving itself, a collaboration delivery names the sending
 * collaborator. This is attribution, never authorization — a sender ID grants nothing, and the
 * permission reviewer must not read it as trust.
 */
export const SENDER_AGENT_ID_METADATA_KEY = "senderAgentId";

const senderAgentIdSchema = Type.String({
    minLength: 1,
    maxLength: 256,
    pattern: "^[^\\u0000\\r\\n]+$",
});

/** Stamp the specific sending agent on a system-generated message's metadata. */
export function senderAgentIdMetadata(agentId: string): {
    readonly [SENDER_AGENT_ID_METADATA_KEY]: string;
} {
    if (!Value.Check(senderAgentIdSchema, agentId)) {
        throw new Error("The sender agent ID is not a valid metadata value.");
    }
    return Object.freeze({ [SENDER_AGENT_ID_METADATA_KEY]: agentId });
}

/**
 * The specific sending agent this message's metadata names, or undefined when it names none or
 * carries something that is not a plausible agent identity.
 */
export function senderAgentIdOf(metadata: AgentMessageMetadata | undefined): string | undefined {
    const value = ownMetadataValue(metadata, SENDER_AGENT_ID_METADATA_KEY);
    return Value.Check(senderAgentIdSchema, value) ? value : undefined;
}
