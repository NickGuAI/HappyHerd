import * as z from 'zod';

export const HappyHerdAutomationRailSchema = z.enum(['claude', 'codex']);
export const HappyHerdAutomationKindSchema = z.enum(['scheduled', 'heartbeat', 'memory-maintenance']);
export const HappyHerdAutomationStatusSchema = z.enum(['active', 'paused']);
export const HappyHerdAutomationTerminalRunStatusSchema = z.enum([
  'completed', 'failed', 'timed-out',
]);
export const HappyHerdAutomationRunStatusSchema = z.enum([
  'running', 'started', 'completed', 'failed', 'timed-out', 'skipped', 'missed',
]);

export const HappyHerdAutomationSchema = z.object({
  schemaVersion: z.literal(1),
  runtimeOwner: z.literal('happyherd'),
  id: z.string().uuid(),
  machineId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(160),
  kind: HappyHerdAutomationKindSchema,
  instruction: z.string().trim().min(1).max(100_000),
  schedule: z.string().trim().min(1).max(512),
  timezone: z.string().trim().min(1).max(128),
  workspace: z.string().trim().min(1),
  rail: HappyHerdAutomationRailSchema,
  commanderId: z.string().trim().min(1).nullable(),
  status: HappyHerdAutomationStatusSchema,
  maxRetries: z.number().int().min(0).max(5),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastScheduledAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
}).strict();

export type HappyHerdAutomation = z.infer<typeof HappyHerdAutomationSchema>;

export const HappyHerdAutomationCreateInputSchema = HappyHerdAutomationSchema.pick({
  name: true,
  kind: true,
  instruction: true,
  schedule: true,
  timezone: true,
  workspace: true,
  rail: true,
  commanderId: true,
  status: true,
  maxRetries: true,
});
export type HappyHerdAutomationCreateInput = z.infer<typeof HappyHerdAutomationCreateInputSchema>;

export const HappyHerdAutomationUpdateInputSchema = HappyHerdAutomationCreateInputSchema.partial().strict();
export type HappyHerdAutomationUpdateInput = z.infer<typeof HappyHerdAutomationUpdateInputSchema>;

export const HappyHerdAutomationRunSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  source: z.enum(['schedule', 'manual']),
  scheduledFor: z.string().datetime(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  status: HappyHerdAutomationRunStatusSchema,
  attempt: z.number().int().min(1),
  sessionId: z.string().trim().min(1).nullable(),
  message: z.string().max(10_000).nullable(),
}).strict().superRefine((run, context) => {
  const isActive = run.status === 'running' || run.status === 'started';
  if (isActive && run.finishedAt !== null) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: `${run.status} runs must not have a finishedAt timestamp`,
    });
  }
  if (!isActive && run.finishedAt === null) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: `${run.status} runs require a finishedAt timestamp`,
    });
  }
  if (run.status === 'running' && run.sessionId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['sessionId'],
      message: 'running runs cannot have a linked session yet',
    });
  }
  if (
    (run.status === 'started' || run.status === 'completed' || run.status === 'timed-out')
    && run.sessionId === null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['sessionId'],
      message: `${run.status} runs require a linked session`,
    });
  }
});
export type HappyHerdAutomationRun = z.infer<typeof HappyHerdAutomationRunSchema>;
export type HappyHerdAutomationTerminalRunStatus = z.infer<typeof HappyHerdAutomationTerminalRunStatusSchema>;

export const HappyHerdAutomationProviderOutcomeSchema = z.object({
  schemaVersion: z.literal(1),
  automationId: z.string().uuid(),
  runId: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
  finishedAt: z.string().datetime(),
  message: z.string().max(10_000).nullable(),
}).strict();
export type HappyHerdAutomationProviderOutcome = z.infer<typeof HappyHerdAutomationProviderOutcomeSchema>;

export const HappyHerdAutomationListResponseSchema = z.object({
  automations: z.array(HappyHerdAutomationSchema),
}).strict();
export type HappyHerdAutomationListResponse = z.infer<typeof HappyHerdAutomationListResponseSchema>;

export const HappyHerdAutomationHistoryResponseSchema = z.object({
  runs: z.array(HappyHerdAutomationRunSchema),
}).strict();
export type HappyHerdAutomationHistoryResponse = z.infer<typeof HappyHerdAutomationHistoryResponseSchema>;
