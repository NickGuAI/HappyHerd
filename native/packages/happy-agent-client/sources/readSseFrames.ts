/** One frame read off a Server-Sent Events stream. */
export interface SseFrame {
    /** The `event:` field, when the frame carried one. */
    name: string | undefined;
    /** The `id:` field, which on this API is the event's cursor. */
    id: string | undefined;
    /** The joined `data:` lines, still unparsed. */
    data: string;
}

/**
 * Reads Server-Sent Events out of a byte stream.
 *
 * Framing lives here rather than at the call site because the details are easy
 * to get subtly wrong: a line may end with a carriage return, a newline, or
 * both; a chunk may split a line ending in half; and comment frames — the
 * heartbeats that keep the connection alive through proxies — carry no data and
 * are dropped.
 */
export async function* readSseFrames(
    body: ReadableStream<Uint8Array<ArrayBuffer>>,
): AsyncGenerator<SseFrame> {
    // The bytes are decoded here rather than piped through a TextDecoderStream
    // so that a caller only ever has to hand over the response body it already
    // holds, with no stream plumbing of its own.
    const decoder = new TextDecoder();
    const reader = body.getReader();
    let buffer = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                // A stream that ends without a trailing blank line still
                // delivered a whole final frame.
                const last = parseFrame(normalizeLineEndings(buffer));
                if (last !== undefined) yield last;
                return;
            }
            buffer = holdBackSplitLineEnding(buffer + decoder.decode(value, { stream: true }));
            for (;;) {
                const boundary = buffer.indexOf("\n\n");
                if (boundary < 0) break;
                const frame = parseFrame(buffer.slice(0, boundary));
                buffer = buffer.slice(boundary + 2);
                if (frame !== undefined) yield frame;
            }
        }
    } finally {
        void reader.cancel().catch(() => undefined);
    }
}

/**
 * Normalizes line endings, keeping a trailing carriage return unresolved.
 *
 * The next chunk may begin with the newline that completes it, and deciding
 * early would turn one line ending into two.
 */
function holdBackSplitLineEnding(buffer: string): string {
    if (!buffer.endsWith("\r")) return normalizeLineEndings(buffer);
    return `${normalizeLineEndings(buffer.slice(0, -1))}\r`;
}

function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n?/gu, "\n");
}

function parseFrame(raw: string): SseFrame | undefined {
    if (raw.length === 0 || raw.startsWith(":")) return undefined;
    const lines = raw.split("\n");
    const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).replace(/^ /u, ""));
    if (data.length === 0) return undefined;
    return {
        data: data.join("\n"),
        id: readField(lines, "id"),
        name: readField(lines, "event"),
    };
}

function readField(lines: string[], field: string): string | undefined {
    const line = lines.find((candidate) => candidate.startsWith(`${field}:`));
    return line?.slice(field.length + 1).replace(/^ /u, "");
}
