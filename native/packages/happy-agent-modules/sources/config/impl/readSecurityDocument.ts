import { open } from "node:fs/promises";

/**
 * Read one bounded security document.
 *
 * A security policy is prompt text, so it is read whole up to `maxBytes` and decoded as UTF-8 at
 * exactly that byte bound — the caller's budget is a budget on the prompt, not on the file. A file
 * that is not there, or a path that is not a readable file at all, is an absent document rather
 * than a failure; every other read error propagates, so a caller can refuse to act on a policy it
 * could not read instead of acting on half of one. A document with nothing but whitespace in it is
 * the same as no document.
 */
export async function readSecurityDocument(
    path: string,
    maxBytes: number,
): Promise<string | undefined> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
        handle = await open(path, "r");
        const buffer = Buffer.allocUnsafe(maxBytes);
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
        const text = buffer.subarray(0, bytesRead).toString("utf8");
        return text.trim().length > 0 ? text : undefined;
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return undefined;
        throw error;
    } finally {
        await handle?.close().catch(() => undefined);
    }
}
