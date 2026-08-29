import { z } from 'zod';

export const GrokPermissionModeTransitionRequestSchema = z.object({
    sessionId: z.string().min(1),
    permissionMode: z.string().min(1),
});

export type GrokPermissionModeTransitionRequest = z.infer<typeof GrokPermissionModeTransitionRequestSchema>;

export const GrokPermissionModeTransitionReceiptSchema = z.object({
    type: z.literal('success'),
    sessionId: z.string().min(1),
    permissionMode: z.string().min(1),
});

export type GrokPermissionModeTransitionReceipt = z.infer<typeof GrokPermissionModeTransitionReceiptSchema>;
