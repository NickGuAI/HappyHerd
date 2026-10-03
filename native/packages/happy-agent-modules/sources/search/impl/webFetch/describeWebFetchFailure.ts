/**
 * What to tell someone when a page could not be fetched.
 *
 * Node reports every network failure as `fetch failed` and puts the reason in the error's cause,
 * so surfacing the error as-is tells a reader nothing: a site that does not exist, a machine that
 * refused the connection, and an expired certificate all read identically. Each of those is a
 * different thing to do next, so each is said differently here.
 */
export function describeWebFetchFailure(url: string, error: unknown): string {
    const host = hostOf(url);
    const code = causeCode(error);

    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return `${host} could not be found. Check the address, or the site may not exist.`;
    }
    if (code === "ECONNREFUSED") return `${host} refused the connection.`;
    if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
        return `${host} closed the connection before answering.`;
    }
    if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
        return `${host} did not answer in time.`;
    }
    if (code !== undefined && code.startsWith("UNABLE_TO_VERIFY")) {
        return `${host} presented a certificate that could not be verified.`;
    }
    if (code !== undefined && (code.startsWith("CERT_") || code.startsWith("DEPTH_ZERO"))) {
        return `${host} presented a certificate that is not valid.`;
    }

    const detail = causeMessage(error);
    return detail === undefined
        ? `${host} could not be reached.`
        : `${host} could not be reached: ${detail}`;
}

function hostOf(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

/** The operating system or client error code behind a fetch rejection, when there is one. */
function causeCode(error: unknown): string | undefined {
    const cause = error instanceof Error ? error.cause : undefined;
    const code = cause instanceof Error ? (cause as { code?: unknown }).code : undefined;
    return typeof code === "string" ? code : undefined;
}

/**
 * The most specific human-readable text available, never the bare `fetch failed` that prompted
 * this: repeating it would leave the reader exactly where they started.
 */
function causeMessage(error: unknown): string | undefined {
    const cause = error instanceof Error ? error.cause : undefined;
    const causeText = cause instanceof Error ? cause.message.trim() : undefined;
    if (causeText !== undefined && causeText.length > 0) return causeText;
    const text = error instanceof Error ? error.message.trim() : undefined;
    if (text === undefined || text.length === 0 || text === "fetch failed") return undefined;
    return text;
}
