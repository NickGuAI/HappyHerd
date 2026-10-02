import { Type, type Static } from "@sinclair/typebox";
import type { Context } from "@steve.kite/stdlib";

import type { Compute } from "../Compute.js";
import type { FileReadLog } from "../../impl/FileReadLog.js";
import { basenameComputePath } from "./resolveComputePath.js";

/** One bounded image read, ready to become a provider-neutral image block. */
export const computeImageSchema = Type.Object(
    {
        data: Type.String(),
        mime_type: Type.String(),
        bytes: Type.Integer(),
    },
    { additionalProperties: false },
);

export type ComputeImage = Static<typeof computeImageSchema>;

/** Keep base64 image blocks within the providers' input limits without downscaling. */
export const MAX_COMPUTE_IMAGE_BYTES = 3 * 1024 * 1024;

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
};

/** Return the supported image media type for a path, or undefined for ordinary text. */
export function imageMediaTypeForPath(path: string): string | undefined {
    const name = basenameComputePath(path).toLowerCase();
    const dot = name.lastIndexOf(".");
    return dot < 0 ? undefined : IMAGE_MEDIA_TYPES[name.slice(dot)];
}

/** Read a bounded image and remember it as a file the agent has seen. */
export async function readImageForModel(
    compute: Compute,
    reads: FileReadLog,
    ctx: Context,
    permissions: Parameters<Compute["fs"]["readFileBuffer"]>[0],
    path: string,
): Promise<ComputeImage> {
    const mediaType = imageMediaTypeForPath(path);
    if (mediaType === undefined) {
        throw new Error(`This is not a supported image file: ${path}`);
    }
    const stat = await compute.fs.stat(permissions, path);
    if (!stat.isFile) throw new Error(`Image path is not a file: ${path}`);
    if (stat.size > MAX_COMPUTE_IMAGE_BYTES) {
        throw new Error(
            `Image ${path} is too large to show (${String(stat.size)} bytes; the limit is ${String(MAX_COMPUTE_IMAGE_BYTES)}).`,
        );
    }
    const bytes = await compute.fs.readFileBuffer(permissions, path, {
        maxBytes: MAX_COMPUTE_IMAGE_BYTES,
    });
    if (bytes.byteLength > MAX_COMPUTE_IMAGE_BYTES) {
        throw new Error(
            `Image ${path} is too large to show (${String(bytes.byteLength)} bytes; the limit is ${String(MAX_COMPUTE_IMAGE_BYTES)}).`,
        );
    }
    await reads.record(ctx, path, stat.mtimeMs);
    return {
        data: Buffer.from(bytes).toString("base64"),
        mime_type: mediaType,
        bytes: bytes.byteLength,
    };
}
