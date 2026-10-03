/**
 * Whether a redirect may be followed without asking again.
 *
 * Same site, same scheme, same port, no credentials. Anything else is a different place than the
 * one that was approved, so it comes back as a redirect for the model to follow deliberately.
 */
export function isPermittedWebFetchRedirect(originalUrl: string, redirectUrl: string): boolean {
    try {
        const original = new URL(originalUrl);
        const redirect = new URL(redirectUrl);
        if (redirect.protocol !== original.protocol || redirect.port !== original.port) {
            return false;
        }
        if (redirect.username || redirect.password) return false;
        return original.hostname.replace(/^www\./, "") === redirect.hostname.replace(/^www\./, "");
    } catch {
        return false;
    }
}
