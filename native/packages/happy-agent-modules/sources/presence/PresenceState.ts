import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** The largest timestamp and wait duration accepted by the presence module. */
export const MAX_PRESENCE_TIMESTAMP = 8_640_000_000_000_000;
export const MAX_PRESENCE_ID_LENGTH = 128;
export const MAX_PRESENCE_TITLE_LENGTH = 128;
export const MAX_PRESENCE_EMOJI_LENGTH = 32;
export const MAX_PRESENCE_PROMPT_LENGTH = 2_000;
export const MAX_PRESENCE_MESSAGE_LENGTH = 240;

export const presenceIdSchema = Type.String({
    minLength: 1,
    maxLength: MAX_PRESENCE_ID_LENGTH,
});
export const presenceTitleSchema = Type.String({
    minLength: 1,
    maxLength: MAX_PRESENCE_TITLE_LENGTH,
});
export const presenceEmojiSchema = Type.String({
    minLength: 1,
    maxLength: MAX_PRESENCE_EMOJI_LENGTH,
});
export const presencePromptSchema = Type.String({ maxLength: MAX_PRESENCE_PROMPT_LENGTH });
export const presenceMessageSchema = Type.String({
    minLength: 1,
    maxLength: MAX_PRESENCE_MESSAGE_LENGTH,
});
export const presenceWaitDurationSchema = Type.Union([
    Type.Null(),
    Type.Integer({ minimum: 0, maximum: MAX_PRESENCE_TIMESTAMP }),
]);
export const presenceTimestampSchema = Type.Integer({
    minimum: 0,
    maximum: MAX_PRESENCE_TIMESTAMP,
});

const nonCustomStatusSchema = Type.Union([
    Type.Literal("online"),
    Type.Literal("away"),
    Type.Literal("offline"),
    Type.Literal("dnd"),
]);
const customStatusSchema = Type.Literal("custom");

/** The provider-neutral states a person can publish. */
export const presenceStatusSchema = Type.Union([nonCustomStatusSchema, customStatusSchema]);
export const presenceBuiltInStatusSchema = nonCustomStatusSchema;

/**
 * A reference to a configured state. IDs are the canonical form; the status forms remain useful
 * for the four built-in states and keep direct host calls concise.
 */
export const presenceReferenceSchema = Type.Union([
    Type.Object(
        {
            presenceId: presenceIdSchema,
            message: Type.Optional(presenceMessageSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: nonCustomStatusSchema,
            message: Type.Optional(presenceMessageSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: customStatusSchema,
            presenceId: presenceIdSchema,
            message: Type.Optional(presenceMessageSchema),
        },
        { additionalProperties: false },
    ),
]);

/** Alias retained for schedule and fallback contracts; both are catalog references. */
export const presenceFallbackSchema = presenceReferenceSchema;

/**
 * A configured state in the catalog. `answerWaitMs` is null for an unlimited wait, zero for an
 * immediate autonomous outcome, and finite for a state that allows a bounded answer window.
 */
export const presenceDefinitionSchema = Type.Object(
    {
        id: presenceIdSchema,
        status: presenceStatusSchema,
        title: presenceTitleSchema,
        emoji: presenceEmojiSchema,
        prompt: presencePromptSchema,
        answerWaitMs: presenceWaitDurationSchema,
    },
    { additionalProperties: false },
);

export const presenceCatalogSchema = Type.Array(presenceDefinitionSchema, {
    minItems: 1,
    maxItems: 256,
});
export const presenceCatalogInputSchema = Type.Array(presenceDefinitionSchema, {
    maxItems: 256,
});

const timingProperties = {
    effectiveFrom: Type.Optional(presenceTimestampSchema),
    expiresAt: Type.Optional(presenceTimestampSchema),
    fallbackPresenceId: Type.Optional(presenceIdSchema),
    fallback: Type.Optional(presenceReferenceSchema),
} as const;

/**
 * The effective state returned by the module. It carries the complete catalog identity and
 * guidance needed by a model and by the user-input wait policy.
 */
export const presenceStateSchema = Type.Object(
    {
        presenceId: presenceIdSchema,
        status: presenceStatusSchema,
        title: presenceTitleSchema,
        emoji: presenceEmojiSchema,
        prompt: presencePromptSchema,
        answerWaitMs: presenceWaitDurationSchema,
        message: Type.Optional(presenceMessageSchema),
        ...timingProperties,
        changesAt: Type.Optional(presenceTimestampSchema),
    },
    { additionalProperties: false },
);

/**
 * The database stores a selection, not a copied catalog entry. This prevents a changed title,
 * prompt, or wait policy from leaving stale metadata in the current-state row.
 */
export const presenceStoredStateSchema = Type.Object(
    {
        presenceId: presenceIdSchema,
        message: Type.Optional(presenceMessageSchema),
        effectiveFrom: Type.Optional(presenceTimestampSchema),
        expiresAt: Type.Optional(presenceTimestampSchema),
        fallbackPresenceId: Type.Optional(presenceIdSchema),
    },
    { additionalProperties: false },
);

const mutationTimingProperties = {
    effectiveFrom: Type.Optional(presenceTimestampSchema),
    expiresAt: Type.Optional(presenceTimestampSchema),
    fallbackPresenceId: Type.Optional(presenceIdSchema),
    fallback: Type.Optional(presenceReferenceSchema),
} as const;

const mutationByIdSchema = Type.Object(
    {
        presenceId: presenceIdSchema,
        message: Type.Optional(presenceMessageSchema),
        ...mutationTimingProperties,
    },
    { additionalProperties: false },
);
const mutationByBuiltInStatusSchema = Type.Object(
    {
        status: nonCustomStatusSchema,
        message: Type.Optional(presenceMessageSchema),
        ...mutationTimingProperties,
    },
    { additionalProperties: false },
);
const mutationByCustomStatusSchema = Type.Object(
    {
        status: customStatusSchema,
        presenceId: presenceIdSchema,
        message: Type.Optional(presenceMessageSchema),
        ...mutationTimingProperties,
    },
    { additionalProperties: false },
);

/** Input for a host-facing permanent or temporary state mutation. */
export const presenceMutationInputSchema = Type.Union([
    mutationByIdSchema,
    mutationByBuiltInStatusSchema,
    mutationByCustomStatusSchema,
]);

/** Input for a temporary state; the expiry is required and effectiveFrom defaults to the clock. */
export const temporaryPresenceInputSchema = Type.Union([
    Type.Object(
        {
            presenceId: presenceIdSchema,
            message: Type.Optional(presenceMessageSchema),
            effectiveFrom: Type.Optional(presenceTimestampSchema),
            expiresAt: presenceTimestampSchema,
            fallbackPresenceId: Type.Optional(presenceIdSchema),
            fallback: Type.Optional(presenceReferenceSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: nonCustomStatusSchema,
            message: Type.Optional(presenceMessageSchema),
            effectiveFrom: Type.Optional(presenceTimestampSchema),
            expiresAt: presenceTimestampSchema,
            fallbackPresenceId: Type.Optional(presenceIdSchema),
            fallback: Type.Optional(presenceReferenceSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: customStatusSchema,
            presenceId: presenceIdSchema,
            message: Type.Optional(presenceMessageSchema),
            effectiveFrom: Type.Optional(presenceTimestampSchema),
            expiresAt: presenceTimestampSchema,
            fallbackPresenceId: Type.Optional(presenceIdSchema),
            fallback: Type.Optional(presenceReferenceSchema),
        },
        { additionalProperties: false },
    ),
]);

/**
 * The model-facing mutation surface. `until` is an absolute expiry timestamp and
 * `fallbackPresenceId` is the catalog ID to use after it expires.
 */
export const presenceToolInputSchema = Type.Union([
    Type.Object(
        {
            presenceId: presenceIdSchema,
            message: Type.Optional(presenceMessageSchema),
            until: Type.Optional(presenceTimestampSchema),
            fallbackPresenceId: Type.Optional(presenceIdSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: nonCustomStatusSchema,
            message: Type.Optional(presenceMessageSchema),
            until: Type.Optional(presenceTimestampSchema),
            fallbackPresenceId: Type.Optional(presenceIdSchema),
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            status: customStatusSchema,
            presenceId: presenceIdSchema,
            message: Type.Optional(presenceMessageSchema),
            until: Type.Optional(presenceTimestampSchema),
            fallbackPresenceId: Type.Optional(presenceIdSchema),
        },
        { additionalProperties: false },
    ),
]);

/** The narrow state projection consumed by UserInput through an injected structural seam. */
export const presenceUserInputStateSchema = Type.Object(
    {
        answerWaitMs: presenceWaitDurationSchema,
        title: presenceTitleSchema,
        emoji: presenceEmojiSchema,
        prompt: presencePromptSchema,
        changesAt: Type.Optional(presenceTimestampSchema),
    },
    { additionalProperties: false },
);

export type PresenceStatus = Static<typeof presenceStatusSchema>;
export type PresenceReference = Static<typeof presenceReferenceSchema>;
export type PresenceFallback = PresenceReference;
export type PresenceDefinition = Static<typeof presenceDefinitionSchema>;
export type PresenceState = Static<typeof presenceStateSchema>;
export type PresenceStoredState = Static<typeof presenceStoredStateSchema>;
export type PresenceMutationInput = Static<typeof presenceMutationInputSchema>;
export type TemporaryPresenceInput = Static<typeof temporaryPresenceInputSchema>;
export type PresenceToolInput = Static<typeof presenceToolInputSchema>;
export type PresenceUserInputState = Static<typeof presenceUserInputStateSchema>;

/** Validate a configured catalog entry. */
export function assertPresenceDefinition(value: unknown): asserts value is PresenceDefinition {
    if (!Value.Check(presenceDefinitionSchema, value)) {
        throw new Error("Presence definition is invalid.");
    }
}

/** Validate a stored selection after it crosses the database boundary. */
export function assertPresenceStoredState(value: unknown): asserts value is PresenceStoredState {
    if (!Value.Check(presenceStoredStateSchema, value)) {
        throw new Error("Stored presence state is invalid.");
    }
    assertTimeOrder(value.effectiveFrom, value.expiresAt);
}

/** Validate an effective state after catalog metadata has been attached. */
export function assertPresenceState(value: unknown): asserts value is PresenceState {
    if (!Value.Check(presenceStateSchema, value)) {
        throw new Error("Presence state is invalid.");
    }
    assertTimeOrder(value.effectiveFrom, value.expiresAt);
    if (
        value.changesAt !== undefined &&
        (value.expiresAt === undefined || value.changesAt !== value.expiresAt)
    ) {
        throw new Error("Presence state changesAt must match expiresAt.");
    }
    if ((value.fallbackPresenceId === undefined) !== (value.fallback === undefined)) {
        throw new Error("Presence state fallback fields must be configured together.");
    }
    if (value.fallback !== undefined) {
        const identity =
            "presenceId" in value.fallback ? value.fallback.presenceId : value.fallback.status;
        if (identity !== value.fallbackPresenceId) {
            throw new Error("Presence state fallback identity does not match.");
        }
    }
}

/** Validate a temporary mutation after the TypeBox shape has been checked. */
export function assertTemporaryPresenceInput(
    value: unknown,
): asserts value is TemporaryPresenceInput {
    if (!Value.Check(temporaryPresenceInputSchema, value)) {
        throw new Error("Temporary presence input is invalid.");
    }
    assertTimeOrder(value.effectiveFrom, value.expiresAt);
}

/** Validate a host-facing mutation. */
export function assertPresenceMutationInput(
    value: unknown,
): asserts value is PresenceMutationInput {
    if (!Value.Check(presenceMutationInputSchema, value)) {
        throw new Error("Presence mutation input is invalid.");
    }
    assertTimeOrder(value.effectiveFrom, value.expiresAt);
}

/** Validate the smaller model-facing input. */
export function assertPresenceToolInput(value: unknown): asserts value is PresenceToolInput {
    if (!Value.Check(presenceToolInputSchema, value)) {
        throw new Error("Presence mutation input is invalid.");
    }
}

export function assertPresenceUserInputState(
    value: unknown,
): asserts value is PresenceUserInputState {
    if (!Value.Check(presenceUserInputStateSchema, value)) {
        throw new Error("Presence user-input state is invalid.");
    }
}

function assertTimeOrder(effectiveFrom: number | undefined, expiresAt: number | undefined): void {
    if (effectiveFrom !== undefined && expiresAt !== undefined && expiresAt <= effectiveFrom) {
        throw new Error("Presence expiry must be after its effective time.");
    }
}
