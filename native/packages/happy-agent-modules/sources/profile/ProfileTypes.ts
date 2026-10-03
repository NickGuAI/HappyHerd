import { Type, type Static } from "@sinclair/typebox";
import type { Context } from "@steve.kite/stdlib";

const exact = { additionalProperties: false } as const;
/** A lifetime this module is handed. Its shape is its own, so the schema only stands for it. */
export const profileContextSchema = Type.Unsafe<Context>(
    Type.Object({}, { additionalProperties: true }),
);
const timestampSchema = Type.Integer({ maximum: Number.MAX_SAFE_INTEGER, minimum: 0 });

export const profileIdSchema = Type.String({
    maxLength: 32,
    minLength: 2,
    pattern: "^[a-z][a-z0-9]+$",
});
export type ProfileId = Static<typeof profileIdSchema>;

/** The installation that permanently owns this human identity. */
export const instanceIdSchema = Type.String({
    maxLength: 64,
    minLength: 2,
    pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$",
});

export const profileNameValueSchema = Type.String({
    maxLength: 128,
    minLength: 1,
    // Names travel to other machines. Refuse characters that can rewrite or conceal surrounding
    // text so a display cannot lie about which identity performed an action.
    pattern:
        "^[^\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200b\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f]+$",
});
export const profileNameSchema = Type.Union([profileNameValueSchema, Type.Null()]);

export const profileEmailValueSchema = Type.String({
    maxLength: 254,
    minLength: 3,
    pattern: "^[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+$",
});
export const profileEmailSchema = Type.Union([profileEmailValueSchema, Type.Null()]);

export const profileVersionSchema = Type.String({
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});
export type ProfileVersion = Static<typeof profileVersionSchema>;

export const profilePhotoMetadataSchema = Type.Object(
    {
        contentHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        height: Type.Integer({ maximum: 512, minimum: 1 }),
        thumbhash: Type.String({ maxLength: 128, minLength: 4 }),
        width: Type.Integer({ maximum: 512, minimum: 1 }),
    },
    exact,
);
export type ProfilePhotoMetadata = Static<typeof profilePhotoMetadataSchema>;

/**
 * The one person behind this installation.
 *
 * Identity and ownership fields are module-internal facts used by P2P. The HTTP projection
 * intentionally exposes only name, email, photo, version, and updatedAt.
 */
export const profileSchema = Type.Object(
    {
        createdAt: timestampSchema,
        email: profileEmailSchema,
        id: profileIdSchema,
        name: profileNameSchema,
        parentInstanceId: instanceIdSchema,
        photo: Type.Union([profilePhotoMetadataSchema, Type.Null()]),
        updatedAt: timestampSchema,
        version: profileVersionSchema,
    },
    exact,
);
export type Profile = Static<typeof profileSchema>;

export const createProfileInputSchema = Type.Object(
    { email: profileEmailValueSchema, name: profileNameValueSchema },
    exact,
);
export type CreateProfileInput = Static<typeof createProfileInputSchema>;

export const updateProfileInputSchema = Type.Object(
    { email: Type.Optional(profileEmailSchema), name: Type.Optional(profileNameSchema) },
    { ...exact, minProperties: 1 },
);
export type UpdateProfileInput = Static<typeof updateProfileInputSchema>;

export const profileMutationOptionsSchema = Type.Object(
    { expectedVersion: Type.Optional(profileVersionSchema) },
    exact,
);
export type ProfileMutationOptions = Static<typeof profileMutationOptionsSchema>;

export const profilePhotoContentTypeSchema = Type.Union([
    Type.Literal("image/jpeg"),
    Type.Literal("image/png"),
    Type.Literal("image/webp"),
]);
export type ProfilePhotoContentType = Static<typeof profilePhotoContentTypeSchema>;

export const profilePhotoAssetSchema = Type.Object(
    {
        bytes: Type.Uint8Array({ maxByteLength: 8 * 1024 * 1024, minByteLength: 1 }),
        contentHash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        contentType: Type.Literal("image/webp"),
        etag: Type.String({ maxLength: 80, minLength: 66 }),
        height: Type.Integer({ maximum: 512, minimum: 1 }),
        thumbhash: Type.String({ maxLength: 128, minLength: 4 }),
        width: Type.Integer({ maximum: 512, minimum: 1 }),
    },
    exact,
);
export type ProfilePhotoAsset = Static<typeof profilePhotoAssetSchema>;

export const profileChangedEventSchema = Type.Object(
    {
        createdAt: timestampSchema,
        data: Type.Object(
            {
                previousVersion: Type.Union([profileVersionSchema, Type.Null()]),
                profileId: profileIdSchema,
                version: profileVersionSchema,
            },
            exact,
        ),
        id: profileVersionSchema,
        type: Type.Literal("profile_changed"),
    },
    exact,
);
export type ProfileChangedEvent = Static<typeof profileChangedEventSchema>;

/** What `onEvent` registers: told after a change is saved, never inside its transaction. */
export const profileEventListenerSchema = Type.Function(
    [profileContextSchema, profileChangedEventSchema],
    Type.Union([Type.Void(), Type.Promise(Type.Void())]),
);
export type ProfileEventListener = Static<typeof profileEventListenerSchema>;

/** Undoing a registration; calling it twice is harmless. */
export type ProfileUnsubscribe = () => void;
