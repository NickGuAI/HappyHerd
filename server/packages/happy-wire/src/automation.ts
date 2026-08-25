import * as z from 'zod';

export const HappyHerdAutomationRailSchema = z.enum(['claude', 'codex']);
export const HappyHerdAutomationKindSchema = z.enum(['scheduled', 'heartbeat', 'memory-maintenance']);
export const HappyHerdScheduledAutomationKindSchema = z.enum(['scheduled', 'memory-maintenance']);
export const HappyHerdAutomationStatusSchema = z.enum(['active', 'paused']);
export const HappyHerdAutomationTerminalRunStatusSchema = z.enum([
  'completed', 'failed',
]);
export const HappyHerdAutomationRunStatusSchema = z.enum([
  'running', 'started', 'completed', 'failed', 'skipped', 'missed',
]);

export const HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION = 3 as const;
export const HAPPYHERD_HEARTBEAT_DEFAULT_INTERVAL_SECONDS = 30 * 60;
export const HAPPYHERD_HEARTBEAT_MIN_INTERVAL_SECONDS = 60;
export const HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION = 'Continue the current task if it remains unfinished and actionable.';
export const HAPPYHERD_AUTOMATION_MAX_TAGS = 20;
export const HAPPYHERD_AUTOMATION_MAX_TAG_LENGTH = 80;
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
  instruction: z.string().trim().min(1).max(100_000),
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

const HappyHerdLegacyAutomationDefinitionFieldsSchema = HappyHerdAutomationDefinitionFieldsSchema.extend({
  kind: HappyHerdAutomationKindSchema,
  schedule: z.string().trim().min(1).max(512),
}).strict();

export const HappyHerdAutomationV1Schema = HappyHerdLegacyAutomationDefinitionFieldsSchema.extend({
  schemaVersion: z.literal(1),
}).strict();

export const HappyHerdAutomationV2Schema = HappyHerdLegacyAutomationDefinitionFieldsSchema.extend({
  schemaVersion: z.literal(2),
  tags: HappyHerdAutomationTagsSchema,
}).strict();

const HappyHerdAutomationV3BaseSchema = HappyHerdAutomationDefinitionFieldsSchema.extend({
  schemaVersion: z.literal(HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION),
  tags: HappyHerdAutomationTagsSchema,
}).strict();

export const HappyHerdScheduledAutomationV3Schema = HappyHerdAutomationV3BaseSchema.extend({
  kind: HappyHerdScheduledAutomationKindSchema,
  schedule: z.string().trim().min(1).max(512),
}).strict();

export const HappyHerdHeartbeatAutomationV3Schema = HappyHerdAutomationV3BaseSchema.extend({
  kind: z.literal('heartbeat'),
  schedule: z.null(),
  targetSessionId: z.string().trim().min(1),
  intervalSeconds: z.number().int().min(HAPPYHERD_HEARTBEAT_MIN_INTERVAL_SECONDS),
  nextDueAt: z.string().datetime().nullable(),
  maxRetries: z.literal(0),
}).strict();

const HappyHerdAutomationV3Schema = z.discriminatedUnion('kind', [
  HappyHerdScheduledAutomationV3Schema,
  HappyHerdHeartbeatAutomationV3Schema,
]);

export const HappyHerdAutomationSchema = z.union([
  HappyHerdAutomationV3Schema,
  HappyHerdAutomationV2Schema,
  HappyHerdAutomationV1Schema,
]).transform((automation) => {
  if (automation.schemaVersion === HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION) return automation;
  const tags = automation.schemaVersion === 1 ? [] : automation.tags;
  return HappyHerdScheduledAutomationV3Schema.parse({
    ...automation,
    schemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
    // Historical `heartbeat` was only a label on an ordinary cron automation.
    // Preserve that exact fresh-session behavior while reserving V3 heartbeat
    // for the session-scoped interval contract.
    kind: automation.kind === 'heartbeat' ? 'scheduled' : automation.kind,
    tags,
  });
});

export type HappyHerdAutomation = z.output<typeof HappyHerdAutomationSchema>;
export type HappyHerdHeartbeatAutomation = z.infer<typeof HappyHerdHeartbeatAutomationV3Schema>;
export type HappyHerdScheduledAutomation = z.infer<typeof HappyHerdScheduledAutomationV3Schema>;

const HappyHerdAutomationMutableFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  kind: HappyHerdScheduledAutomationKindSchema,
  instruction: z.string().trim().min(1).max(100_000),
  schedule: z.string().trim().min(1).max(512),
  timezone: z.string().trim().min(1).max(128),
  workspace: z.string().trim().min(1),
  rail: HappyHerdAutomationRailSchema,
  commanderId: z.string().trim().min(1).nullable(),
  status: HappyHerdAutomationStatusSchema,
  maxRetries: z.number().int().min(0).max(5),
  tags: HappyHerdAutomationTagsSchema,
}).strict();

export const HappyHerdAutomationCreateInputSchema = HappyHerdAutomationMutableFieldsSchema.extend({
  tags: HappyHerdAutomationTagsSchema.default([]),
}).strict();
export type HappyHerdAutomationCreateInput = z.input<typeof HappyHerdAutomationCreateInputSchema>;

export const HappyHerdAutomationUpdateInputSchema = HappyHerdAutomationMutableFieldsSchema.partial().strict();
export type HappyHerdAutomationUpdateInput = z.input<typeof HappyHerdAutomationUpdateInputSchema>;

export const HappyHerdHeartbeatMessageMarkerSchema = z.object({
  schemaVersion: z.literal(1),
  automationId: z.string().uuid(),
  occurrenceId: z.string().uuid(),
}).strict();
export type HappyHerdHeartbeatMessageMarker = z.infer<typeof HappyHerdHeartbeatMessageMarkerSchema>;

export const HappyHerdHeartbeatDeliveryReceiptSchema = HappyHerdHeartbeatMessageMarkerSchema.extend({
  status: z.enum(['started', 'completed', 'failed']),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  message: z.string().max(10_000).nullable(),
}).strict().superRefine((receipt, context) => {
  if (receipt.status === 'started' && receipt.finishedAt !== null) {
    context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'started heartbeat delivery cannot be finished' });
  }
  if (receipt.status !== 'started' && receipt.finishedAt === null) {
    context.addIssue({ code: 'custom', path: ['finishedAt'], message: 'terminal heartbeat delivery requires finishedAt' });
  }
});
export type HappyHerdHeartbeatDeliveryReceipt = z.infer<typeof HappyHerdHeartbeatDeliveryReceiptSchema>;

const HappyHerdHeartbeatTargetInputSchema = z.object({
  targetSessionId: z.string().trim().min(1),
}).strict();

export const HappyHerdHeartbeatControlInputSchema = z.discriminatedUnion('action', [
  HappyHerdHeartbeatTargetInputSchema.extend({ action: z.literal('status') }).strict(),
  HappyHerdHeartbeatTargetInputSchema.extend({
    action: z.literal('set'),
    intervalSeconds: z.number().int().min(HAPPYHERD_HEARTBEAT_MIN_INTERVAL_SECONDS),
    instruction: z.string().trim().max(100_000).nullable(),
  }).strict(),
  HappyHerdHeartbeatTargetInputSchema.extend({ action: z.literal('pause') }).strict(),
  HappyHerdHeartbeatTargetInputSchema.extend({ action: z.literal('resume') }).strict(),
  HappyHerdHeartbeatTargetInputSchema.extend({ action: z.literal('clear') }).strict(),
]);
export type HappyHerdHeartbeatControlInput = z.infer<typeof HappyHerdHeartbeatControlInputSchema>;

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
    (run.status === 'started' || run.status === 'completed')
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

export const HappyHerdHeartbeatDeliveryStateSchema = z.enum([
  'idle',
  'due',
  'waiting-daemon',
  'persisted',
  'queued',
  'running',
  'failed',
]);
export type HappyHerdHeartbeatDeliveryState = z.infer<typeof HappyHerdHeartbeatDeliveryStateSchema>;

export const HappyHerdHeartbeatControlResponseSchema = z.object({
  heartbeat: HappyHerdHeartbeatAutomationV3Schema.nullable(),
  currentRun: HappyHerdAutomationRunSchema.nullable(),
  lastRun: HappyHerdAutomationRunSchema.nullable(),
  deliveryState: HappyHerdHeartbeatDeliveryStateSchema.nullable(),
  queuedAhead: z.number().int().min(0).nullable(),
  observedAt: z.string().datetime(),
}).strict();
export type HappyHerdHeartbeatControlResponse = z.infer<typeof HappyHerdHeartbeatControlResponseSchema>;

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
  definitionSchemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  automations: z.array(HappyHerdAutomationSchema),
}).strict();
export type HappyHerdAutomationListResponse = z.output<typeof HappyHerdAutomationListResponseSchema>;

export const HappyHerdAutomationHistoryResponseSchema = z.object({
  runs: z.array(HappyHerdAutomationRunSchema),
}).strict();
export type HappyHerdAutomationHistoryResponse = z.infer<typeof HappyHerdAutomationHistoryResponseSchema>;
