/** A query value the client knows how to write into a URL. */
export type QueryValue = string | number | boolean | undefined;

/** The query parameters of one request; entries left `undefined` are omitted. */
export type QueryParameters = Record<string, QueryValue>;

/**
 * Builds the URL of one request against the endpoint the client was given.
 *
 * The endpoint may carry a path prefix and query parameters of its own — a
 * tunnel or a proxy in front of the daemon often does — so a path is resolved
 * beneath the endpoint's path rather than replacing it, and the endpoint's own
 * query is preserved alongside the request's.
 */
export function endpointUrl(endpoint: string, path: string, query?: QueryParameters): string {
    const base = new URL(endpoint);
    const inherited = new URLSearchParams(base.search);
    base.search = "";
    base.hash = "";
    if (!base.pathname.endsWith("/")) base.pathname += "/";

    const url = new URL(path.replace(/^\/+/u, ""), base);
    if (query !== undefined) {
        for (const [name, value] of Object.entries(query)) {
            if (value !== undefined) url.searchParams.set(name, String(value));
        }
    }
    for (const [name, value] of inherited) url.searchParams.append(name, value);
    return url.toString();
}
