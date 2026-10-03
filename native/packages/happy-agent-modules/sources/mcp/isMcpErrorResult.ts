export function isMcpErrorResult(result: unknown): boolean {
    try {
        return (
            typeof result === "object" &&
            result !== null &&
            "isError" in result &&
            result.isError === true
        );
    } catch {
        return false;
    }
}
