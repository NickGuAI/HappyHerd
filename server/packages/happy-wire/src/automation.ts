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

export const HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION = 2 as const;
export const HAPPYHERD_AUTOMATION_MAX_TAGS = 20;
export const HAPPYHERD_AUTOMATION_MAX_TAG_LENGTH = 80;
export const HAPPYHERD_AUTOMATION_DEFAULT_TIMEOUT_MINUTES = 60;
export const HAPPYHERD_AUTOMATION_MIN_TIMEOUT_MINUTES = 1;
export const HAPPYHERD_AUTOMATION_MAX_TIMEOUT_MINUTES = 24 * 60;

export const HappyHerdAutomationTimeoutMinutesSchema = z.number()
  .int()
  .min(HAPPYHERD_AUTOMATION_MIN_TIMEOUT_MINUTES)
  .max(HAPPYHERD_AUTOMATION_MAX_TIMEOUT_MINUTES);

/** Undefined retains the legacy default; null explicitly leaves completion to the provider. */
export const HappyHerdAutomationTimeoutSchema = HappyHerdAutomationTimeoutMinutesSchema.nullable();

export const HappyHerdAutomationTagSchema = z.string()
  .trim()
  .min(1)
  .max(HAPPYHERD_AUTOMATION_MAX_TAG_LENGTH);

export const HappyHerdAutomationTagsSchema = z.array(HappyHerdAutomationTagSchema)
  .max(HAPPYHERD_AUTOMATION_MAX_TAGS)
  .superRefine((tags, context) => {
    const seen = new Set<string>();
    for (const [index, tag] of tags.entries()) {
      if (seen.has(tag)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: `Duplicate automation tag: ${tag}`,
        });
      }
      seen.add(tag);
    }
  })
  .transform((tags) => [...tags].sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  )));

const HappyHerdAutomationDefinitionFieldsSchema = z.object({
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
  timeoutMinutes: HappyHerdAutomationTimeoutSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastScheduledAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
}).strict();

export const HappyHerdAutomationV1Schema = HappyHerdAutomationDefinitionFieldsSchema.extend({
  schemaVersion: z.literal(1),
}).strict();

export const HappyHerdAutomationV2Schema = HappyHerdAutomationDefinitionFieldsSchema.extend({
  schemaVersion: z.literal(HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION),
  tags: HappyHerdAutomationTagsSchema,
}).strict();

export const HappyHerdAutomationSchema = z.union([
  HappyHerdAutomationV2Schema,
  HappyHerdAutomationV1Schema,
]).transform((automation) => automation.schemaVersion === 1
  ? {
      ...automation,
      schemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
      tags: [],
    }
  : automation);

export type HappyHerdAutomation = z.output<typeof HappyHerdAutomationSchema>;

const HappyHerdAutomationMutableFieldsSchema = z.object({
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
  timeoutMinutes: HappyHerdAutomationTimeoutSchema.optional(),
  tags: HappyHerdAutomationTagsSchema,
}).strict();

export const HappyHerdAutomationCreateInputSchema = HappyHerdAutomationMutableFieldsSchema.extend({
  tags: HappyHerdAutomationTagsSchema.default([]),
}).strict();
export type HappyHerdAutomationCreateInput = z.input<typeof HappyHerdAutomationCreateInputSchema>;

export const HappyHerdAutomationUpdateInputSchema = HappyHerdAutomationMutableFieldsSchema.partial().strict();
export type HappyHerdAutomationUpdateInput = z.input<typeof HappyHerdAutomationUpdateInputSchema>;

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
  definitionSchemaVersion: z.union([z.literal(1), z.literal(2)]).default(1),
  automations: z.array(HappyHerdAutomationSchema),
}).strict();
export type HappyHerdAutomationListResponse = z.output<typeof HappyHerdAutomationListResponseSchema>;

export const HappyHerdAutomationHistoryResponseSchema = z.object({
  runs: z.array(HappyHerdAutomationRunSchema),
}).strict();
export type HappyHerdAutomationHistoryResponse = z.infer<typeof HappyHerdAutomationHistoryResponseSchema>;
