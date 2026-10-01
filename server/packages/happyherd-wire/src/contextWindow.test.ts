import { describe, expect, it } from 'vitest';
import { ContextWindowRequestSchema, ContextWindowResponseSchema } from './contextWindow';

describe('context window wire contract', () => {
    it('carries native lookup metadata and keeps unsupported providers representable', () => {
        const request = { provider: 'future-provider', directory: '/fixture/project', codexHome: '/fixture/codex-home', homeDir: '/fixture/home' };
        expect(ContextWindowRequestSchema.parse(request)).toEqual(request);
        expect(ContextWindowResponseSchema.parse({ type: 'error', reason: 'unsupported' })).toEqual({ type: 'error', reason: 'unsupported' });
    });

    it('retains full arbitrary native content and explicit unrecorded limitations', () => {
        const response = {
            type: 'success', provider: 'claude',
            entries: [{ kind: 'attachment:future_native_kind', content: 'Line one\n\u0000原文\nLine three' }],
            limitations: ['claude_system_prompt_unrecorded', 'claude_tool_definitions_unrecorded', 'provider_input_not_fully_recorded'],
        };
        expect(ContextWindowResponseSchema.parse(response)).toEqual(response);
        expect(ContextWindowResponseSchema.safeParse({ type: 'success', provider: 'codex', entries: [{ kind: 'user' }], limitations: [] }).success).toBe(false);
    });
});
