import { createHash } from "node:crypto";

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { agentDatabaseRows, agentDatabaseRun } from "@slopus/happy-agent-base";
import { sql } from "drizzle-orm";
import type { Context } from "@steve.kite/stdlib";

import {
    MAX_PROJECT_AVATAR_BYTES,
    MAX_PROJECT_AVATAR_DIMENSION,
    MAX_PROJECT_AVATAR_THUMBHASH_LENGTH,
    projectAvatarAssetSchema,
    type ProjectAvatarAsset,
} from "../Project.js";
import { PROJECT_AVATARS_TABLE } from "../ProjectMigrations.js";
import { databaseFor } from "./projectRecords.js";

const storedProjectAvatarRowSchema = Type.Object(
    {
        content_hash: Type.String({ pattern: "^[a-f0-9]{64}$" }),
        content_type: Type.Literal("image/webp"),
        height: Type.Integer({ minimum: 1, maximum: MAX_PROJECT_AVATAR_DIMENSION }),
        image_bytes: Type.Uint8Array({
            minByteLength: 1,
            maxByteLength: MAX_PROJECT_AVATAR_BYTES,
        }),
        thumbhash: Type.String({ minLength: 4, maxLength: MAX_PROJECT_AVATAR_THUMBHASH_LENGTH }),
        width: Type.Integer({ minimum: 1, maximum: MAX_PROJECT_AVATAR_DIMENSION }),
    },
    { additionalProperties: false },
);
type StoredProjectAvatarRow = Static<typeof storedProjectAvatarRowSchema>;

export async function queryProjectAvatar(
    ctx: Context,
    projectId: string,
): Promise<ProjectAvatarAsset | undefined> {
    const row = (
        await agentDatabaseRows<unknown>(
            databaseFor(ctx),
            sql`SELECT image_bytes, content_type, content_hash, thumbhash, width, height
                FROM ${sql.raw(PROJECT_AVATARS_TABLE)}
                WHERE project_id = ${projectId}
                LIMIT 1`,
        )
    )[0];
    if (row === undefined) return undefined;
    const record = row as Record<string, unknown>;
    const normalized = {
        ...record,
        image_bytes:
            record["image_bytes"] instanceof ArrayBuffer
                ? new Uint8Array(record["image_bytes"])
                : record["image_bytes"],
    };
    if (!Value.Check(storedProjectAvatarRowSchema, normalized)) {
        throw new Error("Project avatar storage contains an invalid asset.");
    }
    const stored = normalized as StoredProjectAvatarRow;
    const bytes = new Uint8Array(stored.image_bytes);
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== stored.content_hash) {
        throw new Error("The stored project avatar does not match its content hash.");
    }
    const asset: ProjectAvatarAsset = {
        bytes,
        contentHash: stored.content_hash,
        contentType: stored.content_type,
        etag: `"${stored.content_hash}"`,
        height: stored.height,
        thumbhash: stored.thumbhash,
        width: stored.width,
    };
    if (!Value.Check(projectAvatarAssetSchema, asset)) {
        throw new Error("Project avatar storage contains invalid metadata.");
    }
    return asset;
}

export async function writeProjectAvatar(
    ctx: Context,
    projectId: string,
    asset: ProjectAvatarAsset,
): Promise<void> {
    if (!Value.Check(projectAvatarAssetSchema, asset)) {
        throw new Error("The project avatar asset is invalid.");
    }
    await agentDatabaseRun(
        databaseFor(ctx),
        sql`INSERT INTO ${sql.raw(PROJECT_AVATARS_TABLE)}
            (project_id, image_bytes, content_type, content_hash, thumbhash, width, height)
            VALUES (
                ${projectId},
                ${asset.bytes},
                ${asset.contentType},
                ${asset.contentHash},
                ${asset.thumbhash},
                ${asset.width},
                ${asset.height}
            )
            ON CONFLICT (project_id) DO UPDATE SET
                image_bytes = EXCLUDED.image_bytes,
                content_type = EXCLUDED.content_type,
                content_hash = EXCLUDED.content_hash,
                thumbhash = EXCLUDED.thumbhash,
                width = EXCLUDED.width,
                height = EXCLUDED.height`,
    );
}

export async function deleteProjectAvatar(ctx: Context, projectId: string): Promise<void> {
    await agentDatabaseRun(
        databaseFor(ctx),
        sql`DELETE FROM ${sql.raw(PROJECT_AVATARS_TABLE)} WHERE project_id = ${projectId}`,
    );
}
