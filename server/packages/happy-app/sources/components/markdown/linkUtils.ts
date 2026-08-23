import { normalizeMarkdownLinkDestination } from '@/utils/markdownLinkDestination';

const HTTP_URL_PATTERN = /^https?:\/\//i;
const SCHEME_RELATIVE_HTTP_URL_PATTERN = /^\/\/[^/\s]/;

export function isHttpMarkdownLink(url: string): boolean {
    return HTTP_URL_PATTERN.test(url.trim());
}

export function normalizeExternalMarkdownLink(url: string): string | null {
    const destination = normalizeMarkdownLinkDestination(url);
    if (HTTP_URL_PATTERN.test(destination)) return destination;
    if (SCHEME_RELATIVE_HTTP_URL_PATTERN.test(destination)) return `https:${destination}`;
    return null;
}
