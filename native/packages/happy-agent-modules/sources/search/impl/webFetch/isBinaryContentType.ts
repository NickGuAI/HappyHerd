/** Whether a response body is bytes rather than something worth handing a model as text. */
export function isBinaryContentType(contentType: string): boolean {
    const mediaType = (contentType.split(";")[0] ?? "").trim().toLowerCase();
    if (mediaType.length === 0 || mediaType.startsWith("text/")) return false;
    if (
        mediaType.endsWith("+json") ||
        mediaType === "application/json" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/xml" ||
        mediaType.startsWith("application/javascript") ||
        mediaType === "application/x-www-form-urlencoded"
    ) {
        return false;
    }
    return true;
}
