import * as z from 'zod';

export const HappyHerdCommanderSummarySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  workspace: z.string().trim().min(1),
  commanderPath: z.string().trim().min(1),
  agentContextPath: z.string().trim().min(1),
}).strict();

export type HappyHerdCommanderSummary = z.infer<typeof HappyHerdCommanderSummarySchema>;

export const HappyHerdCommanderListResponseSchema = z.object({
  commanders: z.array(HappyHerdCommanderSummarySchema),
  globalAgentsPath: z.string().trim().min(1).nullable(),
}).strict();

export type HappyHerdCommanderListResponse = z.infer<typeof HappyHerdCommanderListResponseSchema>;
