import * as z from 'zod';

export const HappyHerdAutomationAgentRailSchema = z.enum(['claude', 'codex']);
export const HappyHerdAutomationRailSchema = z.enum(['claude', 'codex', 'exec']);
export const HappyHerdAutomationKindSchema = z.enum(['scheduled', 'heartbeat', 'memory-maintenance']);
export const HappyHerdScheduledAutomationKindSchema = z.enum(['scheduled', 'memory-maintenance']);
export const HappyHerdAutomationStatusSchema = z.enum(['active', 'paused']);
export const HappyHerdAutomationTerminalRunStatusSchema = z.enum([
  'completed', 'failed',
]);
export const HappyHerdAutomationRunStatusSchema = z.enum([
  'running', 'started', 'completed', 'failed', 'skipped', 'missed',
]);

export const HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION = 4 as const;
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

const HappyHerdAutomationIdentityFieldsSchema = z.object({
  runtimeOwner: z.literal('happyherd'),
  id: z.string().uuid(),
  machineId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(128),
  workspace: z.string().trim().min(1),
  status: HappyHerdAutomationStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastScheduledAt: z.string().datetime().nullable(),
  lastRunAt: z.string().datetime().nullable(),
}).strict();

const HappyHerdAgentExecutionFieldsSchema = z.object({
  instruction: z.string().trim().min(1).max(100_000),
  rail: HappyHerdAutomationAgentRailSchema,
  commanderId: z.string().trim().min(1).nullable(),
  maxRetries: z.number().int().min(0).max(5),
}).strict();

const HappyHerdExecExecutableSchema = z.string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => value.startsWith('/'), 'Executable must be an absolute path')
  .refine((value) => !value.includes('\0'), 'Executable must not contain a null byte');

const HappyHerdExecWorkspaceSchema = HappyHerdAutomationIdentityFieldsSchema.shape.workspace
  .refine((value) => value.startsWith('/'), 'Exec workspace must be an absolute path');

const HappyHerdExecArgumentSchema = z.string()
  .max(4_096)
  .refine((value) => !value.includes('\0'), 'Command arguments must not contain a null byte');

export const HappyHerdExecArgumentsSchema = z.array(HappyHerdExecArgumentSchema).max(100);

const HappyHerdLegacyAutomationDefinitionFieldsSchema = HappyHerdAutomationIdentityFieldsSchema.extend({
  instruction: HappyHerdAgentExecutionFieldsSchema.shape.instruction,
  rail: HappyHerdAutomationAgentRailSchema,
  commanderId: HappyHerdAgentExecutionFieldsSchema.shape.commanderId,
  maxRetries: HappyHerdAgentExecutionFieldsSchema.shape.maxRetries,
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

const HappyHerdAutomationV3BaseSchema = HappyHerdLegacyAutomationDefinitionFieldsSchema.omit({
  kind: true,
  schedule: true,
}).extend({
  schemaVersion: z.literal(3),
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

const HappyHerdAutomationV4BaseSchema = HappyHerdAutomationIdentityFieldsSchema.extend({
  schemaVersion: z.literal(HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION),
  tags: HappyHerdAutomationTagsSchema,
}).strict();

export const HappyHerdAgentScheduledAutomationV4Schema = HappyHerdAutomationV4BaseSchema.extend({
  kind: HappyHerdScheduledAutomationKindSchema,
  schedule: z.string().trim().min(1).max(512),
  instruction: HappyHerdAgentExecutionFieldsSchema.shape.instruction,
  rail: HappyHerdAutomationAgentRailSchema,
  commanderId: HappyHerdAgentExecutionFieldsSchema.shape.commanderId,
  maxRetries: HappyHerdAgentExecutionFieldsSchema.shape.maxRetries,
}).strict();

export const HappyHerdExecAutomationV4Schema = HappyHerdAutomationV4BaseSchema.extend({
  kind: z.literal('scheduled'),
  schedule: z.string().trim().min(1).max(512),
  rail: z.literal('exec'),
  workspace: HappyHerdExecWorkspaceSchema,
  executable: HappyHerdExecExecutableSchema,
  arguments: HappyHerdExecArgumentsSchema,
}).strict();

export const HappyHerdHeartbeatAutomationV4Schema = HappyHerdAutomationV4BaseSchema.extend({
  kind: z.literal('heartbeat'),
  schedule: z.null(),
  instruction: HappyHerdAgentExecutionFieldsSchema.shape.instruction,
  rail: HappyHerdAutomationAgentRailSchema,
  commanderId: HappyHerdAgentExecutionFieldsSchema.shape.commanderId,
  targetSessionId: z.string().trim().min(1),
  intervalSeconds: z.number().int().min(HAPPYHERD_HEARTBEAT_MIN_INTERVAL_SECONDS),
  nextDueAt: z.string().datetime().nullable(),
  maxRetries: z.literal(0),
}).strict();

const HappyHerdAutomationV4Schema = z.union([
  HappyHerdAgentScheduledAutomationV4Schema,
  HappyHerdExecAutomationV4Schema,
  HappyHerdHeartbeatAutomationV4Schema,
]);

export const HappyHerdAutomationSchema = z.union([
  HappyHerdAutomationV4Schema,
  HappyHerdAutomationV3Schema,
  HappyHerdAutomationV2Schema,
  HappyHerdAutomationV1Schema,
]).transform((automation) => {
  if (automation.schemaVersion === HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION) return automation;
  const tags = automation.schemaVersion === 1 ? [] : automation.tags;
  const normalized = {
    ...automation,
    schemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
    // Historical `heartbeat` was only a label on an ordinary cron automation.
    // Preserve that exact fresh-session behavior while reserving V3 heartbeat
    // for the session-scoped interval contract.
    kind: automation.kind === 'heartbeat' ? 'scheduled' : automation.kind,
    tags,
  };
  return automation.schemaVersion === 3 && automation.kind === 'heartbeat'
    ? HappyHerdHeartbeatAutomationV4Schema.parse({
      ...automation,
      schemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
      tags,
    })
    : HappyHerdAgentScheduledAutomationV4Schema.parse(normalized);
});

export type HappyHerdAutomation = z.output<typeof HappyHerdAutomationSchema>;
export type HappyHerdHeartbeatAutomation = z.infer<typeof HappyHerdHeartbeatAutomationV4Schema>;
export type HappyHerdExecAutomation = z.infer<typeof HappyHerdExecAutomationV4Schema>;
export type HappyHerdScheduledAutomation = z.infer<typeof HappyHerdAgentScheduledAutomationV4Schema>
  | HappyHerdExecAutomation;

const HappyHerdAutomationMutableBaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  schedule: z.string().trim().min(1).max(512),
  timezone: z.string().trim().min(1).max(128),
  workspace: z.string().trim().min(1),
  status: HappyHerdAutomationStatusSchema,
  tags: HappyHerdAutomationTagsSchema,
}).strict();

const HappyHerdAgentAutomationCreateInputSchema = HappyHerdAutomationMutableBaseSchema.extend({
  kind: HappyHerdScheduledAutomationKindSchema,
  instruction: HappyHerdAgentExecutionFieldsSchema.shape.instruction,
  rail: HappyHerdAutomationAgentRailSchema,
  commanderId: HappyHerdAgentExecutionFieldsSchema.shape.commanderId,
  maxRetries: HappyHerdAgentExecutionFieldsSchema.shape.maxRetries,
  tags: HappyHerdAutomationTagsSchema.default([]),
}).strict();

const HappyHerdExecAutomationCreateInputSchema = HappyHerdAutomationMutableBaseSchema.extend({
  kind: z.literal('scheduled'),
  rail: z.literal('exec'),
  workspace: HappyHerdExecWorkspaceSchema,
  executable: HappyHerdExecExecutableSchema,
  arguments: HappyHerdExecArgumentsSchema.default([]),
  tags: HappyHerdAutomationTagsSchema.default([]),
}).strict();

export const HappyHerdAutomationCreateInputSchema = z.union([
  HappyHerdAgentAutomationCreateInputSchema,
  HappyHerdExecAutomationCreateInputSchema,
]);
export type HappyHerdAutomationCreateInput = z.input<typeof HappyHerdAutomationCreateInputSchema>;

export const HappyHerdAutomationUpdateInputSchema = z.object({
  name: HappyHerdAutomationMutableBaseSchema.shape.name.optional(),
  kind: HappyHerdScheduledAutomationKindSchema.optional(),
  instruction: HappyHerdAgentExecutionFieldsSchema.shape.instruction.optional(),
  schedule: HappyHerdAutomationMutableBaseSchema.shape.schedule.optional(),
  timezone: HappyHerdAutomationMutableBaseSchema.shape.timezone.optional(),
  workspace: HappyHerdAutomationMutableBaseSchema.shape.workspace.optional(),
  rail: HappyHerdAutomationRailSchema.optional(),
  commanderId: HappyHerdAgentExecutionFieldsSchema.shape.commanderId.optional(),
  status: HappyHerdAutomationMutableBaseSchema.shape.status.optional(),
  maxRetries: HappyHerdAgentExecutionFieldsSchema.shape.maxRetries.optional(),
  tags: HappyHerdAutomationTagsSchema.optional(),
  executable: HappyHerdExecExecutableSchema.optional(),
  arguments: HappyHerdExecArgumentsSchema.optional(),
}).strict();
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

const HappyHerdCompatibleHeartbeatAutomationSchema = z.union([
  HappyHerdHeartbeatAutomationV4Schema,
  HappyHerdHeartbeatAutomationV3Schema,
]).transform((heartbeat) => heartbeat.schemaVersion === HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION
  ? heartbeat
  : HappyHerdHeartbeatAutomationV4Schema.parse({
    ...heartbeat,
    schemaVersion: HAPPYHERD_AUTOMATION_DEFINITION_SCHEMA_VERSION,
  }));

export const HappyHerdAutomationRunSchema = z.object({
  id: z.string().uuid(),
  automationId: z.string().uuid(),
  source: z.enum(['schedule', 'manual']),
  scheduledFor: z.string().datetime(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  status: HappyHerdAutomationRunStatusSchema,
  // Historical rows omit this field and are provider-agent runs.
  execution: z.enum(['agent', 'exec']).optional(),
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
  if (run.execution === 'exec' && run.sessionId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['sessionId'],
      message: 'exec runs cannot have a linked session',
    });
  }
  if (run.execution === 'exec' && run.status === 'started') {
    context.addIssue({
      code: 'custom',
      path: ['status'],
      message: 'exec runs complete directly without a started session state',
    });
  }
  if (
    (run.status === 'started' || run.status === 'completed')
    && run.execution !== 'exec'
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
  heartbeat: HappyHerdCompatibleHeartbeatAutomationSchema.nullable(),
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
  definitionSchemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  automations: z.array(HappyHerdAutomationSchema),
}).strict();
export type HappyHerdAutomationListResponse = z.output<typeof HappyHerdAutomationListResponseSchema>;

export const HappyHerdAutomationHistoryResponseSchema = z.object({
  runs: z.array(HappyHerdAutomationRunSchema),
}).strict();
export type HappyHerdAutomationHistoryResponse = z.infer<typeof HappyHerdAutomationHistoryResponseSchema>;
