const MARKDOWN_LINK_TITLE_PATTERN =
    /^(.*\S)\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))$/s;

/**
 * Return the destination portion of a parsed Markdown link.
 *
 * The app's lightweight Markdown parser passes the optional title through in
 * the URL field. Angle-delimited destinations are also still wrapped. Keep
 * that parser detail out of both external-link and workspace-link routing.
 */
export function normalizeMarkdownLinkDestination(value: string): string {
    const trimmed = value.trim();
    const destination = (trimmed.match(MARKDOWN_LINK_TITLE_PATTERN)?.[1] ?? trimmed).trim();
    return destination.startsWith('<') && destination.endsWith('>')
        ? destination.slice(1, -1)
        : destination;
}
