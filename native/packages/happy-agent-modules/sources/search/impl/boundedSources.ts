import type { SearchSource } from "../Search.js";

const MAX_SOURCES = 100;
const MAX_TITLE_LENGTH = 2_000;
const MAX_URL_LENGTH = 200;

/**
 * The cited sources a vendor answer may carry.
 *
 * Vendors cite in prose and in their own search payloads, so what arrives here is scraped text
 * rather than a checked record. Anything that is not a canonical, followable web address is
 * dropped instead of repaired: a half-written URL is worse than one fewer citation.
 */
export function boundedSources(sources: readonly SearchSource[]): SearchSource[] {
    const bounded = new Map<string, SearchSource>();
    for (const source of sources) {
        const url = canonicalUrl(source.url);
        if (url === undefined || bounded.has(url)) continue;
        const title = source.title.trim().slice(0, MAX_TITLE_LENGTH);
        bounded.set(url, { title: title.length === 0 ? url : title, url });
        if (bounded.size === MAX_SOURCES) break;
    }
    return [...bounded.values()];
}

function canonicalUrl(value: string): string | undefined {
    let parsed: URL;
    try {
        parsed = new URL(value.trim());
    } catch {
        return undefined;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.href.length > MAX_URL_LENGTH ? undefined : parsed.href;
}
