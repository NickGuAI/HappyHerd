import { z } from 'zod';

/** Provider trace lookup carried by the existing encrypted machine RPC. */
export const ContextWindowRequestSchema = z.object({
    provider: z.string().min(1),
    directory: z.string().min(1),
    claudeSessionId: z.string().optional(),
    codexThreadId: z.string().optional(),
    codexHome: z.string().optional(),
    homeDir: z.string().optional(),
});

export const ContextWindowEntrySchema = z.object({
    kind: z.string(),
    // Native content is deliberately not shortened or interpreted as UI copy.
    content: z.string(),
});

export const ContextWindowLimitationSchema = z.enum([
    'claude_system_prompt_unrecorded',
    'claude_tool_definitions_unrecorded',
    'codex_base_instructions_unrecorded',
    'codex_compacted_history_unrecorded',
    'provider_input_not_fully_recorded',
]);

export const ContextWindowResponseSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('success'),
        provider: z.enum(['claude', 'codex']),
        entries: z.array(ContextWindowEntrySchema),
        limitations: z.array(ContextWindowLimitationSchema),
    }),
    z.object({
        type: z.literal('error'),
        reason: z.enum(['unsupported', 'missing', 'unreadable']),
    }),
]);

export type ContextWindowRequest = z.infer<typeof ContextWindowRequestSchema>;
export type ContextWindowEntry = z.infer<typeof ContextWindowEntrySchema>;
export type ContextWindowLimitation = z.infer<typeof ContextWindowLimitationSchema>;
export type ContextWindowResponse = z.infer<typeof ContextWindowResponseSchema>;
