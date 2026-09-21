import * as z from 'zod';

/**
 * Runtime-owned queue lifecycle for persisted user messages.
 *
 * Message content remains in the immutable session message log. The queue
 * state carries only ordered local IDs so clients can project those records
 * into a dedicated queue surface without duplicating user content.
 */
export const AgentMessageQueueStateSchema = z.object({
  pendingMessageIds: z.array(z.string().trim().min(1)),
  currentMessageIds: z.array(z.string().trim().min(1)),
}).strict();

export type AgentMessageQueueState = z.infer<typeof AgentMessageQueueStateSchema>;
