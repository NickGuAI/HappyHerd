import { open } from "node:fs/promises";

import type { Context } from "@steve.kite/stdlib";

/** Read one bounded global-instructions document, treating non-file paths as absent. */
export async function readGlobalInstructions(
    _ctx: Context,
    path: string,
    maxBytes: number,
): Promise<string | undefined> {
    try {
        const handle = await open(path, "r");
        try {
            // Four extra bytes are enough to finish the UTF-8 code point crossing the byte bound.
            // Returning that first complete code point gives the module its oversize sentinel
            // without ever decoding a partial character as U+FFFD.
            const buffer = Buffer.allocUnsafe(maxBytes + 4);
            const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
            if (bytesRead <= maxBytes) {
                return buffer.subarray(0, bytesRead).toString("utf8");
            }

            const decoder = new TextDecoder("utf-8");
            const prefix = decoder.decode(buffer.subarray(0, maxBytes), { stream: true });
            const boundary = decoder.decode(buffer.subarray(maxBytes, bytesRead), { stream: true });
            const nextCodePoint = boundary[Symbol.iterator]().next().value as string | undefined;
            if (nextCodePoint === undefined) return prefix;

            const candidate = `${prefix}${nextCodePoint}`;
            // The reader schema permits one extra JS character. A supplementary code point after
            // an all-ASCII prefix occupies two UTF-16 code units, so use an ASCII sentinel instead;
            // either sentinel is beyond maxBytes and is removed by the module's byte truncation.
            return candidate.length <= maxBytes + 1 ? candidate : `${prefix}x`;
        } finally {
            await handle.close();
        }
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
        throw error;
    }
}
