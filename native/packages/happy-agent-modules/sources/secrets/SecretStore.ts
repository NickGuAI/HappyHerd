import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
    secretAttachmentSchema,
    secretCommandEnvironmentSchema,
    secretHostEnvironmentSchema,
    secretIdSchema,
    secretPageSchema,
    secretReferenceSchema,
    type SecretAttachment,
    type SecretCommandEnvironment,
    type SecretHostEnvironment,
    type SecretReference,
    type SecretPage,
} from "./Secret.js";

export const secretStoreRegisterResultSchema = Type.Object(
    {
        operation: Type.Literal("register"),
        changed: Type.Boolean(),
        reference: secretReferenceSchema,
    },
    { additionalProperties: false },
);

export const secretStoreUpdateResultSchema = Type.Object(
    {
        operation: Type.Literal("update"),
        changed: Type.Boolean(),
        secretId: secretIdSchema,
        reference: Type.Optional(secretReferenceSchema),
    },
    { additionalProperties: false },
);

export const secretStoreRemoveResultSchema = Type.Object(
    {
        operation: Type.Literal("remove"),
        removed: Type.Boolean(),
        secretId: secretIdSchema,
        reference: Type.Optional(secretReferenceSchema),
    },
    { additionalProperties: false },
);

export const secretStoreAttachResultSchema = Type.Object(
    {
        operation: Type.Literal("attach"),
        changed: Type.Boolean(),
        attachment: secretAttachmentSchema,
        reference: Type.Optional(secretReferenceSchema),
    },
    { additionalProperties: false },
);

export const secretStoreDetachResultSchema = Type.Object(
    {
        operation: Type.Literal("detach"),
        detached: Type.Boolean(),
        attachment: Type.Optional(secretAttachmentSchema),
    },
    { additionalProperties: false },
);

/** Every host mutation result carries the exact operation it performed. */
export const secretStoreMutationResultSchema = Type.Union([
    secretStoreRegisterResultSchema,
    secretStoreUpdateResultSchema,
    secretStoreRemoveResultSchema,
    secretStoreAttachResultSchema,
    secretStoreDetachResultSchema,
]);

export type SecretStoreRegisterResult = Static<typeof secretStoreRegisterResultSchema>;
export type SecretStoreUpdateResult = Static<typeof secretStoreUpdateResultSchema>;
export type SecretStoreRemoveResult = Static<typeof secretStoreRemoveResultSchema>;
export type SecretStoreAttachResult = Static<typeof secretStoreAttachResultSchema>;
export type SecretStoreDetachResult = Static<typeof secretStoreDetachResultSchema>;
export type SecretStoreMutationResult = Static<typeof secretStoreMutationResultSchema>;

/**
 * Secret metadata and attachments are persisted by the module in its Agent Base database.
 *
 * There is no resolver, command resolver, or authorization policy to supply: the module resolves
 * values out of this catalog itself, and nothing outside it can observe or intercept a value.
 */
export const secretStoreSchema = Type.Unknown();

/** The module-owned database facade, retained under the historical public name. */
export type SecretStore = import("./SecretDatabase.js").SecretDatabase;

export function assertSecretPage(value: unknown): asserts value is SecretPage {
    if (!Value.Check(secretPageSchema, value)) {
        throw new Error("Secret store returned an invalid bounded page.");
    }
}

export function assertSecretReference(value: unknown): asserts value is SecretReference {
    if (!Value.Check(secretReferenceSchema, value)) {
        throw new Error("Secret store returned invalid safe metadata.");
    }
}

export function assertSecretAttachment(value: unknown): asserts value is SecretAttachment {
    if (!Value.Check(secretAttachmentSchema, value)) {
        throw new Error("Secret store returned an invalid attachment.");
    }
}

export function assertSecretHostEnvironment(
    value: unknown,
): asserts value is SecretHostEnvironment {
    if (!Value.Check(secretHostEnvironmentSchema, value)) {
        throw new Error("Secret resolver returned an invalid host environment.");
    }
    assertUniqueEnvironmentNames(value);
}

export function assertSecretCommandEnvironment(
    value: unknown,
): asserts value is SecretCommandEnvironment {
    if (!Value.Check(secretCommandEnvironmentSchema, value)) {
        throw new Error("Secret command resolver returned an invalid environment.");
    }
    assertUniqueEnvironmentNames(value.environment);
    const hidden = new Set<string>();
    for (const name of value.hiddenEnvironmentVariables) {
        const normalized = name.toUpperCase();
        if (hidden.has(normalized)) {
            throw new Error(
                "Secret command resolver returned duplicate hidden environment variable names.",
            );
        }
        hidden.add(normalized);
    }
    for (const name of Object.keys(value.environment)) {
        if (!hidden.has(name.toUpperCase())) {
            throw new Error(
                "Secret command resolver must hide every resolved environment variable name.",
            );
        }
    }
}

export function assertSecretStoreMutationResult(
    value: unknown,
): asserts value is SecretStoreMutationResult {
    if (!Value.Check(secretStoreMutationResultSchema, value)) {
        throw new Error("Secret store returned an invalid mutation result.");
    }
}

export function assertSecretStore(value: unknown): asserts value is SecretStore {
    if (value === null || typeof value !== "object") {
        throw new Error("Secrets module received an invalid database.");
    }
}

export type { SecretAttachment, SecretHostEnvironment, SecretReference };

function assertUniqueEnvironmentNames(value: Record<string, string>): void {
    const names = new Set<string>();
    for (const name of Object.keys(value)) {
        const normalized = name.toUpperCase();
        if (names.has(normalized)) {
            throw new Error("Secret resolver returned colliding environment variable names.");
        }
        names.add(normalized);
    }
}
