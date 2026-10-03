/** The human-readable message for any thrown value, so error text never becomes `[object Object]`. */
export function errorToMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
