/**
 * Appends a chunk while keeping only the most recent `maximumBytes`.
 *
 * A streaming command can outrun any buffer, so the oldest bytes are dropped rather than growing
 * without bound. The caller tracks the retained byte count so it never has to re-measure the whole
 * buffer on every chunk.
 */
export function appendCappedChunk(
    chunks: Buffer[],
    currentBytes: number,
    chunk: Buffer,
    maximumBytes: number,
): number {
    if (maximumBytes <= 0) {
        chunks.length = 0;
        return 0;
    }
    chunks.push(chunk);
    let retainedBytes = currentBytes + chunk.length;
    let excessBytes = retainedBytes - maximumBytes;
    while (excessBytes > 0) {
        const first = chunks[0];
        if (first === undefined) return 0;
        if (first.length <= excessBytes) {
            chunks.shift();
            retainedBytes -= first.length;
            excessBytes -= first.length;
        } else {
            chunks[0] = first.subarray(excessBytes);
            retainedBytes -= excessBytes;
            excessBytes = 0;
        }
    }
    return retainedBytes;
}
