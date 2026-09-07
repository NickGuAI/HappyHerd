import { normalizeMarkdownLinkDestination } from '@/utils/markdownLinkDestination';
import { normalizeWorkspaceLocalhostUrl } from '../desktopFileWorkspaceModel';

const HTTP_URL_PATTERN = /^https?:\/\//i;
const SCHEME_RELATIVE_HTTP_URL_PATTERN = /^\/\/[^/\s]/;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export type WorkspaceLocalhostLink = Readonly<{
    kind: 'localhost';
    originSessionId: string;
    machineId: string;
    url: string;
}>;

/** A live URL selects a resource, never the originating chat or machine. */
export function resolveWorkspaceLocalhostLink(input: {
    url: string;
    originSessionId?: string | null;
    machineId?: string | null;
}): WorkspaceLocalhostLink | null {
    if (!input.originSessionId?.trim() || !input.machineId?.trim()) return null;
    // react-markdown encodes IPv6 host brackets. Restore only this loopback
    // authority; decoding the whole destination would change paths and queries.
    const destination = normalizeMarkdownLinkDestination(input.url)
        .replace(/^(https?:\/\/)%5B::1%5D(?=[:/?#]|$)/i, '$1[::1]');
    const url = normalizeWorkspaceLocalhostUrl(destination);
    return url ? {
        kind: 'localhost',
        originSessionId: input.originSessionId,
        machineId: input.machineId,
        url,
    } : null;
}

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
