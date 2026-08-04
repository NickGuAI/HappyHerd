import { describe, expect, it } from 'vitest';

import { resolveAgentDefaultConfig } from './agentDefaults';

describe('agent defaults', () => {
    it('uses a canonical Claude model slug by default', () => {
        expect(resolveAgentDefaultConfig(undefined, 'claude').modelMode).toBe('claude-opus-5');
    });

    it('migrates a persisted Claude alias to its canonical slug', () => {
        expect(resolveAgentDefaultConfig({
            claude: { modelMode: 'opus' },
        }, 'claude').modelMode).toBe('claude-opus-5');
    });
});
