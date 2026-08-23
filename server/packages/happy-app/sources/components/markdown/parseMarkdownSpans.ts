import type { MarkdownSpan } from "./parseMarkdown";

// Link destinations are completed from a single parenthesis pass below;
// JavaScript regular expressions cannot express arbitrary balanced nesting.
const pattern = /(\*\*(.*?)(?:\*\*|$))|(\*(.*?)(?:\*|$))|(\[([^\]]+)\])|(`(.*?)(?:`|$))|(~~(.*?)(?:~~|$))/g;

type MarkdownStructure = {
    parenthesisEnds: Map<number, number>;
    titleQuoteStarts: Map<number, number[]>;
    quoteEnds: Map<number, number>;
    angleEnds: Map<number, number>;
    nextAngleOpens: Map<number, number>;
    nextNonWhitespace: Int32Array;
};

function findLinkDestinationOpens(markdown: string): Set<number> {
    const opens = new Set<number>();
    let labelStart = -1;

    for (let index = 0; index < markdown.length; index += 1) {
        const character = markdown[index];
        if (character === '[') {
            labelStart = index;
            continue;
        }
        if (character !== ']') {
            continue;
        }
        if (labelStart >= 0 && index > labelStart + 1 && markdown[index + 1] === '(') {
            opens.add(index + 1);
        }
        labelStart = -1;
    }

    return opens;
}

function buildMarkdownStructure(
    markdown: string,
    linkDestinationOpens: Set<number>,
): MarkdownStructure {
    const escaped = new Uint8Array(markdown.length);
    let backslashRun = 0;
    for (let index = 0; index < markdown.length; index += 1) {
        if (markdown[index] === '\\') {
            backslashRun += 1;
            continue;
        }
        if (backslashRun % 2 === 1) {
            escaped[index] = 1;
        }
        backslashRun = 0;
    }

    const quoteEnds = new Map<number, number>();
    const angleEnds = new Map<number, number>();
    const nextAngleOpens = new Map<number, number>();
    let nextDoubleQuote: number | null = null;
    let nextSingleQuote: number | null = null;
    let nextAngleClose: number | null = null;
    let nextAngleOpen: number | null = null;

    for (let index = markdown.length - 1; index >= 0; index -= 1) {
        if (escaped[index]) {
            continue;
        }
        const character = markdown[index];
        if (character === '"') {
            if (nextDoubleQuote !== null) {
                quoteEnds.set(index, nextDoubleQuote);
            }
            nextDoubleQuote = index;
        } else if (character === "'") {
            if (nextSingleQuote !== null) {
                quoteEnds.set(index, nextSingleQuote);
            }
            nextSingleQuote = index;
        } else if (character === '>') {
            nextAngleClose = index;
        } else if (character === '<') {
            if (nextAngleClose !== null) {
                angleEnds.set(index, nextAngleClose);
            }
            if (nextAngleOpen !== null) {
                nextAngleOpens.set(index, nextAngleOpen);
            }
            nextAngleOpen = index;
        }
    }

    const parenthesisEnds = new Map<number, number>();
    const titleQuoteStarts = new Map<number, number[]>();
    const parenthesisStack: number[] = [];
    for (let index = 0; index < markdown.length; index += 1) {
        if (escaped[index]) {
            continue;
        }
        const character = markdown[index];
        if (character === '(') {
            parenthesisStack.push(index);
            continue;
        }
        if (character === ')') {
            const open = parenthesisStack.pop();
            if (open !== undefined) {
                parenthesisEnds.set(open, index);
            }
            continue;
        }
        if (
            (character === '"' || character === "'")
            && /\s/.test(markdown[index - 1] ?? '')
        ) {
            const container = parenthesisStack[parenthesisStack.length - 1];
            if (
                container !== undefined
                && linkDestinationOpens.has(container)
            ) {
                const starts = titleQuoteStarts.get(container) ?? [];
                starts.push(index);
                titleQuoteStarts.set(container, starts);
            }
        }
    }

    const nextNonWhitespace = new Int32Array(markdown.length + 1);
    nextNonWhitespace.fill(-1);
    let next = -1;
    for (let index = markdown.length - 1; index >= 0; index -= 1) {
        if (!/\s/.test(markdown[index])) {
            next = index;
        }
        nextNonWhitespace[index] = next;
    }

    return {
        parenthesisEnds,
        titleQuoteStarts,
        quoteEnds,
        angleEnds,
        nextAngleOpens,
        nextNonWhitespace,
    };
}

function resolveAngleDestinationEnd(
    markdown: string,
    angleStart: number,
    structure: MarkdownStructure,
): number | undefined {
    const angleEnd = structure.angleEnds.get(angleStart);
    const nestedAngleStart = structure.nextAngleOpens.get(angleStart);
    if (
        angleEnd === undefined
        || (nestedAngleStart !== undefined && nestedAngleStart < angleEnd)
    ) {
        return undefined;
    }

    const suffixStart = structure.nextNonWhitespace[angleEnd + 1];
    if (suffixStart < 0) {
        return undefined;
    }
    if (markdown[suffixStart] === ')') {
        return suffixStart;
    }
    if (suffixStart === angleEnd + 1) {
        return undefined;
    }

    if (markdown[suffixStart] === '"' || markdown[suffixStart] === "'") {
        const titleEnd = structure.quoteEnds.get(suffixStart);
        if (titleEnd === undefined) {
            return undefined;
        }
        const close = structure.nextNonWhitespace[titleEnd + 1];
        return close >= 0 && markdown[close] === ')' ? close : undefined;
    }

    if (markdown[suffixStart] === '(') {
        const titleEnd = structure.parenthesisEnds.get(suffixStart);
        if (titleEnd === undefined) {
            return undefined;
        }
        const close = structure.nextNonWhitespace[titleEnd + 1];
        return close >= 0 && markdown[close] === ')' ? close : undefined;
    }

    return undefined;
}

/**
 * Build candidate-aware ends in linear passes. A valid leftmost outer link
 * consumes nested link-shaped text, while an invalid outer candidate has no
 * end and therefore cannot hide a later independently valid link.
 */
function buildParenthesisEndMap(markdown: string): Map<number, number> {
    const linkDestinationOpens = findLinkDestinationOpens(markdown);
    const structure = buildMarkdownStructure(markdown, linkDestinationOpens);
    const ends = new Map<number, number>();

    for (const open of linkDestinationOpens) {
        const destinationStart = structure.nextNonWhitespace[open + 1];
        if (destinationStart < 0) {
            continue;
        }

        if (markdown[destinationStart] === '<') {
            const end = resolveAngleDestinationEnd(markdown, destinationStart, structure);
            if (end !== undefined) {
                ends.set(open, end);
            }
            continue;
        }

        const titleStarts = structure.titleQuoteStarts.get(open) ?? [];
        let terminalTitleEnd: number | undefined;
        for (const titleStart of titleStarts) {
            const titleEnd = structure.quoteEnds.get(titleStart);
            const close = titleEnd === undefined
                ? -1
                : structure.nextNonWhitespace[titleEnd + 1];
            if (
                destinationStart < titleStart
                && close >= 0
                && markdown[close] === ')'
            ) {
                terminalTitleEnd = close;
                break;
            }
        }
        if (terminalTitleEnd !== undefined) {
            ends.set(open, terminalTitleEnd);
            continue;
        }

        const end = structure.parenthesisEnds.get(open);
        if (end !== undefined) {
            ends.set(open, end);
        }
    }

    return ends;
}

function pushTextWithAutoLinks(spans: MarkdownSpan[], text: string, styles: MarkdownSpan['styles']) {
    const urlPattern = /https?:\/\/[^\s<]+/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = urlPattern.exec(text)) !== null) {
        const plainText = text.slice(lastIndex, match.index);
        if (plainText) {
            spans.push({ styles, text: plainText, url: null });
        }

        let url = match[0];
        let trailing = '';
        while (/[),.;:!?]$/.test(url)) {
            trailing = url.slice(-1) + trailing;
            url = url.slice(0, -1);
        }

        if (url) {
            spans.push({ styles, text: url, url });
        }
        if (trailing) {
            spans.push({ styles, text: trailing, url: null });
        }

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        spans.push({ styles, text: text.slice(lastIndex), url: null });
    }
}

export function parseMarkdownSpans(markdown: string, header: boolean) {
    const spans: MarkdownSpan[] = [];
    const parenthesisEnds = buildParenthesisEndMap(markdown);
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(markdown)) !== null) {
        // Capture the text between the end of the last match and the start of this match as plain text
        const plainText = markdown.slice(lastIndex, match.index);
        if (plainText) {
            pushTextWithAutoLinks(spans, plainText, []);
        }

        if (match[1]) {
            // Bold
            if (header) {
                pushTextWithAutoLinks(spans, match[2], []);
            } else {
                pushTextWithAutoLinks(spans, match[2], ['bold']);
            }
        } else if (match[3]) {
            // Italic
            if (header) {
                pushTextWithAutoLinks(spans, match[4], []);
            } else {
                pushTextWithAutoLinks(spans, match[4], ['italic']);
            }
        } else if (match[5]) {
            // Link - handle incomplete links (no URL part)
            const destinationOpen = pattern.lastIndex;
            const destinationEnd = markdown[destinationOpen] === '('
                ? parenthesisEnds.get(destinationOpen)
                : undefined;

            if (destinationEnd !== undefined && destinationEnd > destinationOpen + 1) {
                spans.push({
                    styles: [],
                    text: match[6],
                    url: markdown.slice(destinationOpen + 1, destinationEnd),
                });
                pattern.lastIndex = destinationEnd + 1;
            } else {
                // If no URL part, treat as plain text with brackets
                pushTextWithAutoLinks(spans, `[${match[6]}]`, []);
            }
        } else if (match[7]) {
            // Inline code
            spans.push({ styles: ['code'], text: match[8], url: null });
        } else if (match[9]) {
            // GFM strikethrough
            pushTextWithAutoLinks(spans, match[10], ['strikethrough']);
        }

        lastIndex = pattern.lastIndex;
    }

    // If there's any text remaining after the last match, treat it as plain
    if (lastIndex < markdown.length) {
        pushTextWithAutoLinks(spans, markdown.slice(lastIndex), []);
    }

    return spans;
}
