import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const homeDockSource = readFileSync(new URL('./HomeDock.tsx', import.meta.url), 'utf8');

describe('HomeDock focused prompt placeholder', () => {
    it('renders the localized selected-provider name while preserving Codex copy', () => {
        expect(homeDockSource).toContain(`const focusedPromptPlaceholder = agentType === 'codex'
        ? t('uiCopy.askCodex')
        : t('uiCopy.askValue', { value1: currentAgent.name });`);
        expect(homeDockSource).toContain('placeholder={focusedPromptPlaceholder}');
    });
});
