import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** A cuid2 identity: two to thirty-two lowercase alphanumeric characters, opening with a letter. */
export const cuid2Schema = Type.String({
    minLength: 2,
    maxLength: 32,
    pattern: "^[a-z][a-z0-9]*$",
});

/** JSON values metadata may contain, so every metadata object is safe to persist and clone. */
export const agentMetadataValueSchema = Type.Recursive((value) =>
    Type.Union([
        Type.String(),
        Type.Number(),
        Type.Boolean(),
        Type.Null(),
        Type.Array(value),
        Type.Record(Type.String(), value),
    ]),
);

/** The TypeScript type inferred from {@link agentMetadataValueSchema}. */
export type AgentMetadataValue = Static<typeof agentMetadataValueSchema>;

/**
 * Metadata attached to one queued message. Modules own additional fields; `hideFromUser` is the
 * common hint that a presentation module should keep this message out of the user-visible view.
 */
export const agentMessageMetadataSchema = Type.Intersect([
    Type.Object({
        hideFromUser: Type.Optional(Type.Boolean()),
    }),
    Type.Record(Type.String(), agentMetadataValueSchema),
]);

/** The TypeScript type inferred from {@link agentMessageMetadataSchema}. */
export type AgentMessageMetadata = Static<typeof agentMessageMetadataSchema>;

/**
 * Mutable-by-replacement metadata describing one agent. Modules own additional fields; `title`
 * is the common human-readable label.
 */
export const agentMetadataSchema = Type.Intersect([
    Type.Object({
        title: Type.Optional(Type.String()),
    }),
    Type.Record(Type.String(), agentMetadataValueSchema),
]);

/** The TypeScript type inferred from {@link agentMetadataSchema}. */
export type AgentMetadata = Static<typeof agentMetadataSchema>;

/** What metadata-change hooks see after an update has been merged with the previous object. */
export interface AgentMetadataChange {
    /** The agent whose metadata changed. */
    readonly agentId: string;
    /** The complete immutable metadata before the update. */
    readonly previousMetadata: AgentMetadata;
    /** The immutable fields supplied by this update. */
    readonly update: AgentMetadata;
    /** The complete immutable result after the shallow merge. */
    readonly metadata: AgentMetadata;
}

/** @internal Validate, clone, and deeply freeze message metadata at its ownership boundary. */
export function ownAgentMessageMetadata(
    metadata: AgentMessageMetadata | undefined,
): AgentMessageMetadata | undefined {
    if (metadata === undefined) return undefined;
    if (!Value.Check(agentMessageMetadataSchema, metadata)) {
        throw new Error("The message metadata is not valid.");
    }
    return immutableClone(metadata);
}

/** @internal Validate, clone, and deeply freeze agent metadata at its ownership boundary. */
export function ownAgentMetadata(metadata: AgentMetadata | undefined): AgentMetadata | undefined {
    if (metadata === undefined) return undefined;
    if (!Value.Check(agentMetadataSchema, metadata)) {
        throw new Error("The agent metadata is not valid.");
    }
    return immutableClone(metadata);
}

/** Clone one persisted value and freeze every object reachable through ordinary properties. */
function immutableClone<Value>(value: Value): Value {
    return deepFreeze(structuredClone(value), new WeakSet<object>());
}

function deepFreeze<Value>(value: Value, seen: WeakSet<object>): Value {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return value;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor !== undefined && "value" in descriptor) {
            deepFreeze(descriptor.value, seen);
        }
    }
    return Object.freeze(value);
}
