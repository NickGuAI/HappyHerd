/** Converts a value returned from the Monty interpreter into a plain JSON-shaped value. */
export function fromMontyValue(value: unknown): unknown {
    if (value instanceof Map) {
        return Object.fromEntries(
            [...value.entries()].map(([key, item]) => [String(key), fromMontyValue(item)]),
        );
    }
    if (Array.isArray(value)) return value.map(fromMontyValue);
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, fromMontyValue(item)]),
        );
    }
    return value;
}
