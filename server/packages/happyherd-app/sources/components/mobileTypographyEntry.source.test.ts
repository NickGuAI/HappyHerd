import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const componentsDir = dirname(fileURLToPath(import.meta.url));

function styleBlock(source: string, name: string): string {
    const startMatch = new RegExp(`\\n(\\s*)${name}: \\{`, 'u').exec(source);
    if (!startMatch || startMatch.index === undefined) throw new Error(`Missing ${name} style block`);
    const start = startMatch.index;
    const end = source.indexOf(`\n${startMatch[1]}},`, start);
    if (end < 0) throw new Error(`Missing ${name} style block terminator`);
    return source.slice(start, end);
}

describe('phone-Web auto-focus entry typography', () => {
    it('uses the synchronous phone-safe contract in both route-owned prompt inputs', () => {
        const agentQuestion = readFileSync(resolve(componentsDir, 'AgentQuestionModal.tsx'), 'utf8');
        const webPrompt = readFileSync(resolve(componentsDir, '../modal/components/WebPromptModal.tsx'), 'utf8');

        expect(styleBlock(agentQuestion, 'customInput')).toContain(
            'fontSize: resolvePhoneSafeTextEntryFontSize(Platform.OS, 15)',
        );
        expect(styleBlock(webPrompt, 'input')).toContain(
            'fontSize: resolvePhoneSafeTextEntryFontSize(Platform.OS, 14)',
        );
    });
});
