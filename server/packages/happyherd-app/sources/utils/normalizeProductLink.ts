/** Normalize only the historical scheme; keys and all payload bytes stay intact. */
export function normalizeProductLink(url: string): string {
    return url.replace(/* rename:preserve */ /^happy:/ /* /rename:preserve */, 'happyherd:');
}
