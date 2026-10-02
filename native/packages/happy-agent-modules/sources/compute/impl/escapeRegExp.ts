/** Escape text before placing it inside a regular-expression pattern. */
export function escapeRegExp(value: string): string {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
