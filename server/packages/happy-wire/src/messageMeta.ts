import * as z from 'zod';

export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(),
  // Native clients may publish their own mode codes (for example Rig's
  // auto/workspace_write/read_only/full_access), so this stays open-ended.
  permissionMode: z.string().optional(),
  model: z.string().nullable().optional(),
  modelProviderId: z.string().optional(),
  fallbackModel: z.string().nullable().optional(),
  customSystemPrompt: z.string().nullable().optional(),
  appendSystemPrompt: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).nullable().optional(),
  disallowedTools: z.array(z.string()).nullable().optional(),
  effort: z.string().nullable().optional(),
  displayText: z.string().optional(),
  // Generated cross-provider handoffs remain visible but are excluded from
  // later provider-continuation context.
  providerContinuationHandoff: z.boolean().optional(),
  deliveryMode: z.enum(['queue']).optional(),
  // Associates immutable attachment records with their queued user message.
  queueMessageId: z.string().trim().min(1).optional(),
});
export type MessageMeta = z.infer<typeof MessageMetaSchema>;
