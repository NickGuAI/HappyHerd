import { z } from 'zod';

// Shared message metadata schema
export const MessageMetaSchema = z.object({
    sentFrom: z.string().optional(), // Source identifier
    permissionMode: z.string().optional(), // Permission mode key for this message
    model: z.string().nullable().optional(), // Model name for this message (null = reset)
    modelProviderId: z.string().optional(), // Provider qualifier for metadata-driven clients such as Rig
    fallbackModel: z.string().nullable().optional(), // Fallback model for this message (null = reset)
    customSystemPrompt: z.string().nullable().optional(), // Custom system prompt for this message (null = reset)
    appendSystemPrompt: z.string().nullable().optional(), // Append to system prompt for this message (null = reset)
    allowedTools: z.array(z.string()).nullable().optional(), // Allowed tools for this message (null = reset)
    disallowedTools: z.array(z.string()).nullable().optional(), // Disallowed tools for this message (null = reset)
    effort: z.string().nullable().optional(), // Reasoning / thinking effort for this message (null = reset)
    displayText: z.string().optional(), // Optional text to display in UI instead of actual message text
    // Marks the generated cross-provider handoff so it stays visible in the
    // source UI without being forwarded as Human conversation on a later hop.
    providerContinuationHandoff: z.boolean().optional(),
    deliveryMode: z.enum(['queue']).optional(), // Force provider-native queue semantics instead of steering an active turn
    // Parent persisted user-message local ID for queued attachment records.
    queueMessageId: z.string().trim().min(1).optional(),
});

export type MessageMeta = z.infer<typeof MessageMetaSchema>;
