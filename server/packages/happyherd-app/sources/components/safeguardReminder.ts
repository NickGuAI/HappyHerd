export type SafeguardReminder =
    | { status: 'ready'; summary: string }
    | { status: 'revise'; issues: Array<{ quote: string; suggestion: string }> };

const closingTag = '</happyherd-safeguard-reminder>';
const openingPattern = /^<happyherd-safeguard-reminder\s+status\s*=\s*(["'])(ready|revise)\1\s*>/;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function escapeReminderHtmlBlocks(text: string): string {
    let fence: string | undefined;
    return text.split('\n').map((line) => {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
                fence = undefined;
            }
            return line;
        }
        if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
            fence = marker[1];
            return line;
        }
        // Only protocol tags that could start an HTML block need escaping.
        // Keep code examples, inline mentions, options and other Markdown intact.
        return line.replace(/^( {0,3})<(?=\/?(?:happyherd-safeguard-reminder[\w-]*|quote|suggestion)(?:[\s/>]|$))/, '$1&lt;');
    }).join('\n');
}

function plainText(text: string): string | null {
    // Decode once. Escaped markup remains text and must never become UI elements.
    if (text.includes('<') || /&(?!(?:amp|lt|gt|quot|apos);)/.test(text)) return null;
    const decoded = text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => entities[entity]).trim();
    return decoded || null;
}

export function parseSafeguardReminder(text: string): { reminder: SafeguardReminder | null; text: string } {
    const unchanged = { reminder: null, text };
    const indentation = /^(?:[ \t]*\r?\n)*([ \t]*)/.exec(text)?.[1] ?? '';
    if (indentation.includes('\t') || indentation.length >= 4) return unchanged;
    const leadingText = text.trimStart();
    if (leadingText === '') return unchanged;
    if (!/^<happyherd-safeguard-reminder(?:[\s/>]|$)/.test(leadingText)) return unchanged;
    const literal = () => ({ reminder: null, text: escapeReminderHtmlBlocks(text) });

    const opening = openingPattern.exec(leadingText);
    if (!opening) return literal();

    const closingIndex = leadingText.indexOf(closingTag, opening[0].length);
    // Native Markdown drops HTML blocks, including any following plan/options
    // without a blank separator. Render incomplete/malformed protocol tags literally.
    if (closingIndex === -1) return literal();

    const body = leadingText.slice(opening[0].length, closingIndex);
    let reminder: SafeguardReminder;
    if (opening[2] === 'ready') {
        const summary = plainText(body);
        if (!summary) return literal();
        reminder = { status: 'ready', summary };
    } else {
        const issues: Array<{ quote: string; suggestion: string }> = [];
        let remaining = body.trim();
        while (remaining) {
            const pair = /^<quote>([^<]*)<\/quote>\s*<suggestion>([^<]*)<\/suggestion>/.exec(remaining);
            if (!pair) return literal();
            const quote = plainText(pair[1]);
            const suggestion = plainText(pair[2]);
            if (!quote || !suggestion) return literal();
            issues.push({ quote, suggestion });
            remaining = remaining.slice(pair[0].length).trimStart();
        }
        if (issues.length === 0) return literal();
        reminder = { status: 'revise', issues };
    }

    return { reminder, text: leadingText.slice(closingIndex + closingTag.length) };
}
