import { Type, type Static } from "@sinclair/typebox";

export const MAX_SCHEDULING_TIMESTAMP = 8_640_000_000_000_000;
export const MAX_SCHEDULING_MESSAGE_LENGTH = 50_000;
export const MAX_SCHEDULING_FAILURE_LENGTH = 2_000;
export const MAX_SCHEDULING_DURATION_TEXT_LENGTH = 256;
export const MAX_SCHEDULING_PAGE_SIZE = 100;
export const MAX_SCHEDULING_CURSOR_LENGTH = 512;

/**
 * Scheduling identities are cuid2s because a scheduled message is delivered into the recipient's
 * inbox under its own ID. Agent Base accepts a message once per identity, so the delivery of a
 * given scheduled message is idempotent by construction: a redelivery after a crash is recognised
 * as the same message rather than queued a second time.
 */
export const schedulingIdSchema = Type.String({
    minLength: 2,
    maxLength: 32,
    pattern: "^[a-z][a-z0-9]*$",
});
export const schedulingAgentIdSchema = schedulingIdSchema;
export const schedulingWaitIdSchema = schedulingIdSchema;
export const schedulingMessageIdSchema = schedulingIdSchema;
export const schedulingEventIdSchema = schedulingIdSchema;

export const schedulingTimestampSchema = Type.Integer({
    minimum: 0,
    maximum: MAX_SCHEDULING_TIMESTAMP,
});

const durationValueSchema = Type.Number({ minimum: 0, maximum: MAX_SCHEDULING_TIMESTAMP });
const durationTextSchema = Type.String({
    minLength: 1,
    maxLength: MAX_SCHEDULING_DURATION_TEXT_LENGTH,
});

/**
 * A duration is either human text the model can write directly — `90 seconds`, `1h 30m` — or the
 * discrete unit fields, of which at least one must be present.
 */
export const schedulingDurationSchema = Type.Union([
    durationTextSchema,
    Type.Object(
        {
            seconds: Type.Optional(durationValueSchema),
            minutes: Type.Optional(durationValueSchema),
            hours: Type.Optional(durationValueSchema),
            days: Type.Optional(durationValueSchema),
        },
        { additionalProperties: false, minProperties: 1 },
    ),
]);

/**
 * An instant is an ISO 8601 or RFC 2822 date, or a Unix timestamp in seconds or milliseconds.
 * Every accepted form normalizes to a bounded millisecond timestamp.
 */
export const schedulingInstantSchema = Type.Union([
    Type.String({ minLength: 1, maxLength: 128 }),
    Type.Number({ minimum: -MAX_SCHEDULING_TIMESTAMP, maximum: MAX_SCHEDULING_TIMESTAMP }),
]);

export const schedulingWaitKindSchema = Type.Union([
    Type.Literal("wait"),
    Type.Literal("wait_until"),
]);
export const schedulingWaitStatusSchema = Type.Union([
    Type.Literal("waiting"),
    Type.Literal("elapsed"),
    Type.Literal("interrupted"),
]);
export const schedulingWaitOutcomeSchema = Type.Union([
    Type.Literal("elapsed"),
    Type.Literal("interrupted"),
]);

export const schedulingWaitInputSchema = Type.Object(
    {
        id: Type.Optional(schedulingWaitIdSchema),
        duration: schedulingDurationSchema,
    },
    { additionalProperties: false },
);

export const schedulingWaitUntilInputSchema = Type.Object(
    {
        id: Type.Optional(schedulingWaitIdSchema),
        at: schedulingInstantSchema,
    },
    { additionalProperties: false },
);

/** Model schemas omit the record identity, which comes from the durable tool call. */
export const schedulingWaitToolInputSchema = Type.Omit(schedulingWaitInputSchema, ["id"]);
export const schedulingWaitUntilToolInputSchema = Type.Omit(schedulingWaitUntilInputSchema, ["id"]);

const waitRecordCommon = {
    id: schedulingWaitIdSchema,
    agentId: schedulingAgentIdSchema,
    kind: schedulingWaitKindSchema,
    dueAt: schedulingTimestampSchema,
    createdAt: schedulingTimestampSchema,
    updatedAt: schedulingTimestampSchema,
    startedAt: schedulingTimestampSchema,
};

export const schedulingWaitingRecordSchema = Type.Object(
    { ...waitRecordCommon, status: Type.Literal("waiting") },
    { additionalProperties: false },
);

const terminalWaitRecordCommon = {
    ...waitRecordCommon,
    finishedAt: schedulingTimestampSchema,
    elapsedMs: Type.Integer({ minimum: 0, maximum: MAX_SCHEDULING_TIMESTAMP }),
};

export const schedulingElapsedRecordSchema = Type.Object(
    { ...terminalWaitRecordCommon, status: Type.Literal("elapsed") },
    { additionalProperties: false },
);
export const schedulingInterruptedRecordSchema = Type.Object(
    { ...terminalWaitRecordCommon, status: Type.Literal("interrupted") },
    { additionalProperties: false },
);
export const schedulingWaitRecordSchema = Type.Union([
    schedulingWaitingRecordSchema,
    schedulingElapsedRecordSchema,
    schedulingInterruptedRecordSchema,
]);

export const schedulingWaitResultSchema = Type.Object(
    {
        waitId: schedulingWaitIdSchema,
        agentId: schedulingAgentIdSchema,
        outcome: schedulingWaitOutcomeSchema,
        kind: schedulingWaitKindSchema,
        dueAt: schedulingTimestampSchema,
        startedAt: schedulingTimestampSchema,
        endedAt: schedulingTimestampSchema,
        elapsedMs: Type.Integer({ minimum: 0, maximum: MAX_SCHEDULING_TIMESTAMP }),
    },
    { additionalProperties: false },
);

export const schedulingScheduleStatusSchema = Type.Union([
    Type.Literal("pending"),
    Type.Literal("delivered"),
    Type.Literal("undelivered"),
    Type.Literal("cancelled"),
]);

export const schedulingScheduledMessageSchema = Type.Object(
    {
        id: schedulingMessageIdSchema,
        senderAgentId: schedulingAgentIdSchema,
        targetAgentId: schedulingAgentIdSchema,
        message: Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_MESSAGE_LENGTH }),
        dueAt: schedulingTimestampSchema,
        status: schedulingScheduleStatusSchema,
        createdAt: schedulingTimestampSchema,
        updatedAt: schedulingTimestampSchema,
        deliveredAt: Type.Optional(schedulingTimestampSchema),
        failure: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_FAILURE_LENGTH }),
        ),
    },
    { additionalProperties: false },
);

export const schedulingScheduleInputSchema = Type.Union([
    Type.Object(
        {
            id: Type.Optional(schedulingMessageIdSchema),
            targetAgentId: Type.Optional(schedulingAgentIdSchema),
            message: Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_MESSAGE_LENGTH }),
            in: schedulingDurationSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            id: Type.Optional(schedulingMessageIdSchema),
            targetAgentId: Type.Optional(schedulingAgentIdSchema),
            message: Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_MESSAGE_LENGTH }),
            at: schedulingInstantSchema,
        },
        { additionalProperties: false },
    ),
]);

/** The model addresses a recipient by Agent ID and never supplies a durable record identity. */
export const schedulingScheduleToolInputSchema = Type.Union([
    Type.Object(
        {
            agent_id: schedulingAgentIdSchema,
            message: Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_MESSAGE_LENGTH }),
            in: schedulingDurationSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            agent_id: schedulingAgentIdSchema,
            message: Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_MESSAGE_LENGTH }),
            at: schedulingInstantSchema,
        },
        { additionalProperties: false },
    ),
]);

export const schedulingCancelInputSchema = Type.Object(
    { scheduleId: schedulingMessageIdSchema },
    { additionalProperties: false },
);

export const schedulingSchedulePageQuerySchema = Type.Object(
    {
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SCHEDULING_PAGE_SIZE })),
        cursor: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_CURSOR_LENGTH }),
        ),
        status: Type.Optional(schedulingScheduleStatusSchema),
        senderAgentId: Type.Optional(schedulingAgentIdSchema),
        targetAgentId: Type.Optional(schedulingAgentIdSchema),
    },
    { additionalProperties: false },
);

export const schedulingScheduleToolPageQuerySchema = Type.Object(
    {
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_SCHEDULING_PAGE_SIZE })),
        cursor: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_CURSOR_LENGTH }),
        ),
        status: Type.Optional(schedulingScheduleStatusSchema),
    },
    { additionalProperties: false },
);

export const schedulingSchedulePageSchema = Type.Object(
    {
        schedules: Type.Array(schedulingScheduledMessageSchema, {
            maxItems: MAX_SCHEDULING_PAGE_SIZE,
        }),
        limit: Type.Integer({ minimum: 1, maximum: MAX_SCHEDULING_PAGE_SIZE }),
        nextCursor: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_CURSOR_LENGTH }),
        ),
        previousCursor: Type.Optional(
            Type.String({ minLength: 1, maxLength: MAX_SCHEDULING_CURSOR_LENGTH }),
        ),
    },
    { additionalProperties: false },
);

export type SchedulingAgentId = Static<typeof schedulingAgentIdSchema>;
export type SchedulingWaitId = Static<typeof schedulingWaitIdSchema>;
export type SchedulingMessageId = Static<typeof schedulingMessageIdSchema>;
export type SchedulingEventId = Static<typeof schedulingEventIdSchema>;
export type SchedulingDuration = Static<typeof schedulingDurationSchema>;
export type SchedulingInstant = Static<typeof schedulingInstantSchema>;
export type SchedulingWaitKind = Static<typeof schedulingWaitKindSchema>;
export type SchedulingWaitStatus = Static<typeof schedulingWaitStatusSchema>;
export type SchedulingWaitOutcome = Static<typeof schedulingWaitOutcomeSchema>;
export type SchedulingWaitInput = Static<typeof schedulingWaitInputSchema>;
export type SchedulingWaitToolInput = Static<typeof schedulingWaitToolInputSchema>;
export type SchedulingWaitUntilInput = Static<typeof schedulingWaitUntilInputSchema>;
export type SchedulingWaitUntilToolInput = Static<typeof schedulingWaitUntilToolInputSchema>;
export type SchedulingWaitRecord = Static<typeof schedulingWaitRecordSchema>;
export type SchedulingWaitingRecord = Static<typeof schedulingWaitingRecordSchema>;
export type SchedulingWaitResult = Static<typeof schedulingWaitResultSchema>;
export type SchedulingScheduleStatus = Static<typeof schedulingScheduleStatusSchema>;
export type SchedulingScheduledMessage = Static<typeof schedulingScheduledMessageSchema>;
export type SchedulingScheduleInput = Static<typeof schedulingScheduleInputSchema>;
export type SchedulingScheduleToolInput = Static<typeof schedulingScheduleToolInputSchema>;
export type SchedulingCancelInput = Static<typeof schedulingCancelInputSchema>;
export type SchedulingSchedulePageQuery = Static<typeof schedulingSchedulePageQuerySchema>;
export type SchedulingScheduleToolPageQuery = Static<typeof schedulingScheduleToolPageQuerySchema>;
export type SchedulingSchedulePage = Static<typeof schedulingSchedulePageSchema>;
