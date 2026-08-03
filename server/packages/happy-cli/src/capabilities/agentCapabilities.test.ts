import { describe, expect, it } from 'vitest';

import { detectAgentCapabilities, parseClaudeHelp } from './agentCapabilities';

describe('agent capability discovery', () => {
    it('parses Claude CLI model aliases, effort, and permission choices', () => {
        const parsed = parseClaudeHelp(`
  --effort <level> Effort level for the current session
                   (low, medium, high, xhigh, max)
  --model <model> Model alias (e.g. 'fable', 'opus', or 'sonnet') or full name
  --permission-mode <mode> Permission mode (choices: "acceptEdits", "auto",
                   "bypassPermissions", "manual", "dontAsk", "plan")
  --plugin-dir <path> Plugin path
        `);

        expect(parsed.models.map((model) => model.code)).toEqual(['fable', 'opus', 'sonnet']);
        expect(parsed.effortLevels.map((effort) => effort.code)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        expect(parsed.permissionModes.map((mode) => mode.code)).toEqual([
            'acceptEdits',
            'auto',
            'bypassPermissions',
            'manual',
            'dontAsk',
            'plan',
        ]);
    });

    it('accepts a new Codex model without a Web release', async () => {
        const capabilities = await detectAgentCapabilities({
            claude: false,
            codex: true,
            gemini: false,
            openclaw: false,
            agy: false,
            detectedAt: 1,
        }, {
            loadCodexModels: async () => [{
                id: 'future-id',
                model: 'gpt-future-codex',
                displayName: 'GPT Future Codex',
                description: 'Advertised by the installed provider',
                hidden: false,
                supportedReasoningEfforts: [
                    { reasoningEffort: 'medium', description: 'Balanced' },
                    { reasoningEffort: 'ultra', description: 'Deepest reasoning' },
                ],
                defaultReasoningEffort: 'medium',
                isDefault: true,
            }],
        });

        expect(capabilities.codex.sources.models).toBe('codex-app-server:model/list');
        expect(capabilities.codex.models.map((model) => model.code)).toEqual([
            'default',
            'gpt-future-codex',
        ]);
        expect(capabilities.codex.models[1].effortLevels?.map((effort) => effort.code)).toEqual([
            'medium',
            'ultra',
        ]);
    });
});
