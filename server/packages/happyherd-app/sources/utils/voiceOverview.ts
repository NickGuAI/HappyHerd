export type VoiceOverviewParse = {
    summary: string | null;
    body: string;
    pending: boolean;
};

const TAG_PREFIX = '<voice_overview';
const TAG_OPEN = '<voice_overview>';
const TAG_CLOSE = '</voice_overview>';

function isIndentedCode(text: string): boolean {
    const indentation = /^(?:[ \t]*\r?\n)*([ \t]*)/.exec(text)?.[1] ?? '';
    return indentation.includes('\t') || indentation.length >= 4;
}

function isPartialOverviewOpenTag(remainder: string): boolean {
    if (TAG_PREFIX.startsWith(remainder) && remainder.length > 0) return true;
    return remainder.startsWith(TAG_PREFIX)
        && !remainder.includes('>')
        && (remainder === TAG_PREFIX || /^[ \t\r\n]/.test(remainder.slice(TAG_PREFIX.length)));
}

export function parseVoiceOverview(text: string): VoiceOverviewParse {
    // Match the safeguard parser's Markdown literal rule so an indented code
    // example can never be mistaken for the leading voice protocol block.
    if (isIndentedCode(text)) return { summary: null, body: text, pending: false };
    const leading = text.match(/^\s*/)?.[0] ?? '';
    const remainder = text.slice(leading.length);
    if (remainder.startsWith(TAG_OPEN)) {
        const close = remainder.indexOf(TAG_CLOSE, TAG_OPEN.length);
        if (close < 0) return { summary: null, body: '', pending: true };
        const summary = remainder.slice(TAG_OPEN.length, close).trim();
        return {
            summary: summary || null,
            body: remainder.slice(close + TAG_CLOSE.length).replace(/^\s+/, ''),
            pending: false,
        };
    }
    if (isPartialOverviewOpenTag(remainder)) {
        return { summary: null, body: '', pending: true };
    }
    return { summary: null, body: text, pending: false };
}

function removeMarkdownCodeBlocks(markdown: string): string {
    const lines = markdown.split(/\r?\n/);
    const spoken: string[] = [];
    let fence: { marker: '`' | '~'; length: number } | null = null;
    let inIndentedCode = false;

    for (const line of lines) {
        if (fence) {
            const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
            if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = null;
            continue;
        }

        const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
            fence = { marker: opening[1][0] as '`' | '~', length: opening[1].length };
            inIndentedCode = false;
            continue;
        }

        if (line.trim() === '') {
            if (!inIndentedCode) spoken.push(line);
            continue;
        }

        if (/^(?: {4}|\t)/.test(line)) {
            inIndentedCode = true;
            continue;
        }

        inIndentedCode = false;
        spoken.push(line);
    }
    return spoken.join('\n');
}

export function toSpeechText(markdown: string): string {
    const source = removeMarkdownCodeBlocks(markdown)
        .replace(/<options(?:\s[^>]*)?>[\s\S]*?(?:<\/options>|$)/g, '')
        .replace(/<voice_overview(?:\s[^>]*)?>[\s\S]*?(?:<\/voice_overview>|$)/g, '')
        .replace(/<happyherd-safeguard-reminder\b[\s\S]*?(?:<\/happyherd-safeguard-reminder>|$)/g, '')
        .replace(/<tool(?:_call|_result|_output)?\b[\s\S]*?(?:<\/tool(?:_call|_result|_output)?>|$)/gi, '')
        .replace(/(?<!\\)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, '');
    const lines = source.split(/\r?\n/);
    const spoken: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const separator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '');
        if (line.includes('|') && separator) {
            index += 1;
            while (index + 1 < lines.length && lines[index + 1].includes('|')) index += 1;
            continue;
        }
        if (/^\s*\|.+\|\s*$/.test(line)) continue;
        spoken.push(line);
    }
    return spoken.join('\n')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[`*_~>#]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
