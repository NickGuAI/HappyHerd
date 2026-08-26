import { normalizeMarkdownLinkDestination } from '@/utils/markdownLinkDestination';

const HTTP_URL_PATTERN = /^https?:\/\//i;
const SCHEME_RELATIVE_HTTP_URL_PATTERN = /^\/\/[^/\s]/;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function isHttpMarkdownLink(url: string): boolean {
    return HTTP_URL_PATTERN.test(url.trim());
}

export function isWorkspaceRelativeMarkdownLink(url: string): boolean {
    const destination = normalizeMarkdownLinkDestination(url);
    return Boolean(
        destination
        && !destination.startsWith('/')
        && !destination.startsWith('\\')
        && !destination.startsWith('~')
        && !destination.startsWith('#')
        && !destination.startsWith('?')
        && !URL_SCHEME_PATTERN.test(destination),
    );
}

export function normalizeExternalMarkdownLink(url: string): string | null {
    const destination = normalizeMarkdownLinkDestination(url);
    if (HTTP_URL_PATTERN.test(destination)) return destination;
    if (SCHEME_RELATIVE_HTTP_URL_PATTERN.test(destination)) return `https:${destination}`;
    return null;
}
