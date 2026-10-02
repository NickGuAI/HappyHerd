/**
 * Read a Gemini response as text without letting it grow past what was asked for.
 *
 * Generated media arrives base64-encoded inside JSON, so a response is large by nature and a
 * runaway one would be read straight into memory. The declared length is checked first, and the
 * body is then measured chunk by chunk because that header may be absent or wrong.
 */
export async function readBoundedResponseText(
    response: Response,
    maximumBytes: number,
): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        throw new Error(`Gemini response exceeded the ${String(maximumBytes)} byte size limit.`);
    }

    if (response.body === null) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > maximumBytes) {
                await reader.cancel();
                throw new Error(
                    `Gemini response exceeded the ${String(maximumBytes)} byte size limit.`,
                );
            }
            chunks.push(next.value);
        }
    } finally {
        reader.releaseLock();
    }

    const combined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(combined);
}
