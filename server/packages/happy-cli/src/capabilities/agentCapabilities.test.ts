import { describe, expect, it } from 'vitest';

import { buildClaudeCapabilityCatalog, detectAgentCapabilities, parseClaudeHelp } from './agentCapabilities';

describe('agent capability discovery', () => {
    it('parses only structured Claude CLI choices and never help-text model prose', () => {
        const help = `
  --effort <level> Effort level for the current session
                   (low, medium, high, xhigh, max)
  --model <model> Model for the current session. Provide
                   an alias for the latest model (e.g.
                   'fable', 'opus', or 'sonnet') or a
                   model's full name (e.g.
                   'claude-fable-5').
  --permission-mode <mode> Permission mode (choices: "acceptEdits", "auto",
                   "bypassPermissions", "manual", "dontAsk", "plan")
  --plugin-dir <path> Plugin path
        `;
        const parsed = parseClaudeHelp(help);
        const catalog = buildClaudeCapabilityCatalog(help, 1, '2.1.220 (Claude Code)');

        expect(parsed.effortLevels.map((effort) => effort.code)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        expect(parsed.permissionModes.map((mode) => mode.code)).toEqual([
            'acceptEdits',
            'auto',
            'bypassPermissions',
            'manual',
            'dontAsk',
            'plan',
        ]);
        expect(catalog.sources.models).toBe('happyherd-release-catalog');
        expect(catalog.models.map((model) => model.code)).toEqual([
            'default',
            'claude-fable-5',
            'claude-opus-5',
            'claude-opus-4-8',
            'claude-opus-4-6',
            'claude-sonnet-5',
            'claude-haiku-4-5',
        ]);
        expect(catalog.models.map((model) => model.value)).not.toContain(expect.stringContaining('full name'));
        expect(catalog.permissionModes.map((mode) => mode.code)).toEqual([
            'default',
            'acceptEdits',
            'auto',
            'bypassPermissions',
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

    it('uses only app-server-compatible effort fallbacks when live Codex discovery is unavailable', async () => {
        const capabilities = await detectAgentCapabilities({
            claude: false,
            codex: true,
            gemini: false,
            openclaw: false,
            agy: false,
            detectedAt: 1,
        }, {
            loadCodexModels: async () => {
                throw new Error('app-server unavailable');
            },
        });

        expect(capabilities.codex.effortLevels.map((effort) => effort.code)).toEqual([
            'none',
            'minimal',
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
        ]);
        expect(capabilities.codex.permissionModes.map((mode) => mode.code)).toEqual([
            'default',
            'auto',
            'read-only',
            'safe-yolo',
            'yolo',
        ]);
    });
});
