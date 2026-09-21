export type SafeguardReminder =
    | { status: 'ready'; summary: string }
    | { status: 'revise'; issues: Array<{ quote: string; suggestion: string }> };

const closingTag = '</happyherd-safeguard-reminder>';
const openingPattern = /^<happyherd-safeguard-reminder\s+status\s*=\s*(["'])(ready|revise)\1\s*>/;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

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

    const opening = openingPattern.exec(leadingText);
    if (!opening) return unchanged;

    const closingIndex = leadingText.indexOf(closingTag, opening[0].length);
    // Text has no completion signal. Preserve incomplete/malformed replies so
    // an interrupted stream or a closing-tag typo cannot hide the plan/options.
    if (closingIndex === -1) return unchanged;

    const body = leadingText.slice(opening[0].length, closingIndex);
    let reminder: SafeguardReminder;
    if (opening[2] === 'ready') {
        const summary = plainText(body);
        if (!summary) return unchanged;
        reminder = { status: 'ready', summary };
    } else {
        const issues: Array<{ quote: string; suggestion: string }> = [];
        let remaining = body.trim();
        while (remaining) {
            const pair = /^<quote>([^<]*)<\/quote>\s*<suggestion>([^<]*)<\/suggestion>/.exec(remaining);
            if (!pair) return unchanged;
            const quote = plainText(pair[1]);
            const suggestion = plainText(pair[2]);
            if (!quote || !suggestion) return unchanged;
            issues.push({ quote, suggestion });
            remaining = remaining.slice(pair[0].length).trimStart();
        }
        if (issues.length === 0) return unchanged;
        reminder = { status: 'revise', issues };
    }

    return { reminder, text: leadingText.slice(closingIndex + closingTag.length) };
}
