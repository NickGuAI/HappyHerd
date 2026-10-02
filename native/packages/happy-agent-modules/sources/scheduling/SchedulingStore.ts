import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { Context } from "@steve.kite/stdlib";

import {
    MAX_SCHEDULING_PAGE_SIZE,
    schedulingAgentIdSchema,
    schedulingMessageIdSchema,
    schedulingSchedulePageQuerySchema,
    schedulingSchedulePageSchema,
    schedulingScheduledMessageSchema,
    schedulingTimestampSchema,
    schedulingWaitRecordSchema,
    schedulingWaitResultSchema,
    type SchedulingSchedulePage,
    type SchedulingScheduledMessage,
    type SchedulingWaitRecord,
    type SchedulingWaitResult,
} from "./Scheduling.js";

export const schedulingContextSchema = Type.Unsafe<Context>(
    Type.Object({}, { additionalProperties: true }),
);

const voidPromiseSchema = Type.Promise(Type.Void());

/** How many pending messages one recovery pass arms, so a large catalog cannot flood startup. */
export const MAX_SCHEDULING_RECOVERY_BATCH = 1_000;

export const schedulingPendingQuerySchema = Type.Object(
    {
        limit: Type.Integer({ minimum: 1, maximum: MAX_SCHEDULING_RECOVERY_BATCH }),
        afterDueAt: Type.Optional(schedulingTimestampSchema),
    },
    { additionalProperties: false },
);

export const schedulingStoreSchema = Type.Object(
    {
        readWait: Type.Function(
            [schedulingContextSchema, schedulingAgentIdSchema, schedulingMessageIdSchema],
            Type.Promise(Type.Union([schedulingWaitRecordSchema, Type.Undefined()])),
        ),
        writeWait: Type.Function(
            [schedulingContextSchema, schedulingWaitRecordSchema],
            voidPromiseSchema,
        ),
        readSchedule: Type.Function(
            [schedulingContextSchema, schedulingMessageIdSchema],
            Type.Promise(Type.Union([schedulingScheduledMessageSchema, Type.Undefined()])),
        ),
        writeSchedule: Type.Function(
            [schedulingContextSchema, schedulingScheduledMessageSchema],
            voidPromiseSchema,
        ),
        listSchedules: Type.Function(
            [schedulingContextSchema, schedulingSchedulePageQuerySchema],
            Type.Promise(schedulingSchedulePageSchema),
        ),
        listPendingSchedules: Type.Function(
            [schedulingContextSchema, schedulingPendingQuerySchema],
            Type.Promise(
                Type.Array(schedulingScheduledMessageSchema, {
                    maxItems: MAX_SCHEDULING_RECOVERY_BATCH,
                }),
            ),
        ),
    },
    { additionalProperties: false },
);

export type SchedulingStore = Static<typeof schedulingStoreSchema>;
export type SchedulingPendingQuery = Static<typeof schedulingPendingQuerySchema>;

export function assertSchedulingStore(value: unknown): asserts value is SchedulingStore {
    if (!Value.Check(schedulingStoreSchema, value)) {
        throw new Error("Scheduling module received an invalid internal storage adapter.");
    }
}
export function assertSchedulingWaitRecord(value: unknown): asserts value is SchedulingWaitRecord {
    if (!Value.Check(schedulingWaitRecordSchema, value)) {
        throw new Error("Scheduling store returned an invalid durable wait.");
    }
    const record = value as SchedulingWaitRecord;
    if (record.createdAt > record.updatedAt || record.startedAt < record.createdAt) {
        throw new Error("Scheduling durable wait has invalid timestamp ordering.");
    }
    if (record.startedAt > record.dueAt) {
        throw new Error("Scheduling durable wait starts after its due time.");
    }
    if (record.status === "waiting") {
        if ("finishedAt" in record || "elapsedMs" in record) {
            throw new Error("Waiting durable wait has terminal fields.");
        }
    } else if (
        record.finishedAt < record.startedAt ||
        record.finishedAt < record.createdAt ||
        record.elapsedMs !== record.finishedAt - record.startedAt ||
        (record.status === "elapsed" && record.finishedAt < record.dueAt)
    ) {
        throw new Error("Scheduling durable wait has an untruthful elapsed duration.");
    }
}

export function assertSchedulingScheduledMessage(
    value: unknown,
): asserts value is SchedulingScheduledMessage {
    if (!Value.Check(schedulingScheduledMessageSchema, value)) {
        throw new Error("Scheduling store returned an invalid scheduled message.");
    }
    const schedule = value as SchedulingScheduledMessage;
    if (schedule.createdAt > schedule.updatedAt || schedule.dueAt < schedule.createdAt) {
        throw new Error("Scheduled message has invalid timestamp ordering.");
    }
    if (schedule.status === "delivered") {
        if (schedule.deliveredAt === undefined || schedule.failure !== undefined) {
            throw new Error("Delivered message has inconsistent delivery fields.");
        }
        if (
            schedule.deliveredAt < schedule.createdAt ||
            schedule.deliveredAt < schedule.dueAt ||
            schedule.deliveredAt > schedule.updatedAt
        ) {
            throw new Error("Delivered message has an invalid delivery timestamp.");
        }
    } else if (schedule.deliveredAt !== undefined) {
        throw new Error("Non-delivered message has deliveredAt.");
    }
    if (schedule.status === "undelivered") {
        if (schedule.failure === undefined || schedule.updatedAt < schedule.dueAt) {
            throw new Error("Undelivered message has invalid failure detail.");
        }
    } else if (schedule.failure !== undefined) {
        throw new Error("Only undelivered messages may include failure detail.");
    }
}

export function assertSchedulingWaitResult(value: unknown): asserts value is SchedulingWaitResult {
    if (!Value.Check(schedulingWaitResultSchema, value)) {
        throw new Error("Scheduling produced an invalid wait result.");
    }
    const result = value as SchedulingWaitResult;
    if (
        result.endedAt < result.startedAt ||
        result.elapsedMs !== result.endedAt - result.startedAt
    ) {
        throw new Error("Scheduling produced an untruthful elapsed duration.");
    }
    if (result.outcome === "elapsed" && result.endedAt < result.dueAt) {
        throw new Error("An elapsed wait ended before its requested due time.");
    }
}

export function assertSchedulingPage(
    value: unknown,
    requestedLimit: number,
): asserts value is SchedulingSchedulePage {
    if (!Value.Check(schedulingSchedulePageSchema, value)) {
        throw new Error("Scheduling store returned an invalid schedule page.");
    }
    const page = value as SchedulingSchedulePage;
    if (
        page.limit > Math.min(requestedLimit, MAX_SCHEDULING_PAGE_SIZE) ||
        page.schedules.length > page.limit
    ) {
        throw new Error("Scheduling store returned more records than requested.");
    }
}
