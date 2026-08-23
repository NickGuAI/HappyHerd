const HTTP_URL_PATTERN = /^https?:\/\//i;
const SCHEME_RELATIVE_HTTP_URL_PATTERN = /^\/\/[^/\s]/;

export function isHttpMarkdownLink(url: string): boolean {
    return HTTP_URL_PATTERN.test(url.trim());
}

export function normalizeExternalMarkdownLink(url: string): string | null {
    const trimmed = url.trim();
    if (HTTP_URL_PATTERN.test(trimmed)) return trimmed;
    if (SCHEME_RELATIVE_HTTP_URL_PATTERN.test(trimmed)) return `https:${trimmed}`;
    return null;
}
