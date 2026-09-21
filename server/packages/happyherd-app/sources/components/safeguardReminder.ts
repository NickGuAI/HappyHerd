export type SafeguardReminder =
    | { status: 'ready'; summary: string }
    | { status: 'revise'; issues: Array<{ quote: string; suggestion: string }> };

const openingTag = '<happyherd-safeguard-reminder';
const closingTag = '</happyherd-safeguard-reminder>';
const openingPattern = /^<happyherd-safeguard-reminder\s+status\s*=\s*(["'])(ready|revise)\1\s*>/;
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Accept only prefixes that can still complete the finite opening-tag grammar.
function isPendingOpening(text: string): boolean {
    if (openingTag.startsWith(text)) return true;
    if (!text.startsWith(openingTag)) return false;

    const attributes = text.slice(openingTag.length);
    if (!/^\s/.test(attributes)) return false;
    const attribute = attributes.trimStart();
    if ('status'.startsWith(attribute)) return true;
    if (!attribute.startsWith('status')) return false;

    const assignment = attribute.slice('status'.length).trimStart();
    if (assignment === '') return true;
    if (!assignment.startsWith('=')) return false;
    const value = assignment.slice(1).trimStart();
    if (value === '') return true;
    const quote = value[0];
    if (quote !== '"' && quote !== "'") return false;

    const status = value.slice(1);
    return ['ready', 'revise'].some((candidate) => {
        const ending = candidate + quote;
        return ending.startsWith(status)
            || (status.startsWith(ending) && /^\s*$/.test(status.slice(ending.length)));
    });
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

    const opening = openingPattern.exec(leadingText);
    if (!opening) {
        return isPendingOpening(leadingText) ? { reminder: null, text: '' } : unchanged;
    }

    const closingIndex = leadingText.indexOf(closingTag, opening[0].length);
    // A recognized streaming block remains hidden until its closing tag arrives.
    if (closingIndex === -1) return { reminder: null, text: '' };

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
