import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/** Stable identifiers used for tasks and their dependencies. */
export const taskIdSchema = Type.String({
    minLength: 1,
    maxLength: 128,
});

/** The small lifecycle a task can have. */
export const taskStatusSchema = Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
]);

/** How prominently a task should be shown. */
export const taskPrioritySchema = Type.Union([
    Type.Literal("low"),
    Type.Literal("normal"),
    Type.Literal("high"),
]);

/** A bounded title suitable for both a model context and a protocol response. */
export const taskTitleSchema = Type.String({
    minLength: 1,
    maxLength: 500,
});

/** Optional worker assignment carried by a task. */
export const taskOwnerSchema = Type.String({
    minLength: 1,
    maxLength: 256,
});

/** Present-continuous text shown while a task is in progress. */
export const taskActiveFormSchema = Type.String({
    minLength: 1,
    maxLength: 500,
});

/** Optional detail carried with a task. */
export const taskDetailSchema = Type.String({
    maxLength: 4_000,
});

/** Milliseconds since the Unix epoch. */
export const taskTimestampSchema = Type.Integer({
    minimum: 0,
});

/** Bounds for the arbitrary, JSON-shaped metadata attached to a task. */
export const MAX_TASK_METADATA_DEPTH = 8;
export const MAX_TASK_METADATA_KEYS = 64;
export const MAX_TASK_METADATA_ITEMS = 64;
export const MAX_TASK_METADATA_STRING_LENGTH = 2_000;
export const MAX_TASK_METADATA_BYTES = 16_384;

const taskMetadataKeySchema = Type.String({
    minLength: 1,
    maxLength: 128,
});

/**
 * Metadata is deliberately JSON-shaped rather than `Type.Unknown()`. The recursive schema keeps
 * values safe to persist and the semantic validator below enforces a finite depth and encoded
 * size in addition to TypeBox's per-level bounds.
 */
export const taskMetadataValueSchema = Type.Recursive((value) =>
    Type.Union([
        Type.Null(),
        Type.Boolean(),
        Type.Number(),
        Type.String({ maxLength: MAX_TASK_METADATA_STRING_LENGTH }),
        Type.Array(value, { maxItems: MAX_TASK_METADATA_ITEMS }),
        Type.Record(taskMetadataKeySchema, value, { maxProperties: MAX_TASK_METADATA_KEYS }),
    ]),
);

/** JSON metadata stored on a task. */
export const taskMetadataSchema = Type.Record(taskMetadataKeySchema, taskMetadataValueSchema, {
    maxProperties: MAX_TASK_METADATA_KEYS,
});

/** Metadata patch accepted by updates; `null` removes one existing key. */
export const taskMetadataPatchSchema = Type.Record(
    taskMetadataKeySchema,
    Type.Union([taskMetadataValueSchema, Type.Null()]),
    { maxProperties: MAX_TASK_METADATA_KEYS },
);

/** A task as it is stored in the module-owned task table. */
export const taskSchema = Type.Object(
    {
        activeForm: Type.Optional(taskActiveFormSchema),
        blocks: Type.Array(taskIdSchema, {
            maxItems: 500,
            uniqueItems: true,
        }),
        id: taskIdSchema,
        title: taskTitleSchema,
        detail: Type.Optional(taskDetailSchema),
        status: taskStatusSchema,
        priority: taskPrioritySchema,
        dependsOn: Type.Array(taskIdSchema, {
            maxItems: 64,
            uniqueItems: true,
        }),
        metadata: Type.Optional(taskMetadataSchema),
        owner: Type.Optional(taskOwnerSchema),
        createdAt: taskTimestampSchema,
        updatedAt: taskTimestampSchema,
        ordering: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);

/** A task that can be created through the public module API. */
export const taskCreateInputSchema = Type.Object(
    {
        activeForm: Type.Optional(taskActiveFormSchema),
        id: Type.Optional(taskIdSchema),
        title: taskTitleSchema,
        detail: Type.Optional(taskDetailSchema),
        metadata: Type.Optional(taskMetadataSchema),
        owner: Type.Optional(taskOwnerSchema),
        priority: Type.Optional(taskPrioritySchema),
        dependsOn: Type.Optional(
            Type.Array(taskIdSchema, {
                maxItems: 64,
                uniqueItems: true,
            }),
        ),
    },
    { additionalProperties: false },
);

/** A partial task change. Null clears scalar fields and removes metadata keys. */
export const taskUpdateInputSchema = Type.Object(
    {
        activeForm: Type.Optional(Type.Union([taskActiveFormSchema, Type.Null()])),
        title: Type.Optional(taskTitleSchema),
        detail: Type.Optional(Type.Union([taskDetailSchema, Type.Null()])),
        metadata: Type.Optional(taskMetadataPatchSchema),
        owner: Type.Optional(Type.Union([taskOwnerSchema, Type.Null()])),
        priority: Type.Optional(taskPrioritySchema),
        status: Type.Optional(taskStatusSchema),
        dependsOn: Type.Optional(
            Type.Array(taskIdSchema, {
                maxItems: 64,
                uniqueItems: true,
            }),
        ),
        addBlocks: Type.Optional(
            Type.Array(taskIdSchema, {
                maxItems: 500,
                uniqueItems: true,
            }),
        ),
        addBlockedBy: Type.Optional(
            Type.Array(taskIdSchema, {
                maxItems: 64,
                uniqueItems: true,
            }),
        ),
        removeBlocks: Type.Optional(
            Type.Array(taskIdSchema, {
                maxItems: 500,
                uniqueItems: true,
            }),
        ),
        removeBlockedBy: Type.Optional(
            Type.Array(taskIdSchema, {
                maxItems: 64,
                uniqueItems: true,
            }),
        ),
    },
    { additionalProperties: false, minProperties: 1 },
);

export type TaskId = Static<typeof taskIdSchema>;
export type TaskStatus = Static<typeof taskStatusSchema>;
export type TaskPriority = Static<typeof taskPrioritySchema>;
export type TaskOwner = Static<typeof taskOwnerSchema>;
export type TaskActiveForm = Static<typeof taskActiveFormSchema>;
export type TaskMetadataValue = Static<typeof taskMetadataValueSchema>;
export type TaskMetadata = Static<typeof taskMetadataSchema>;
export type TaskMetadataPatch = Static<typeof taskMetadataPatchSchema>;
export type Task = Static<typeof taskSchema>;
export type TaskCreateInput = Static<typeof taskCreateInputSchema>;
export type TaskUpdateInput = Static<typeof taskUpdateInputSchema>;

/** A normal model-visible failure for a task mutation. */
export const taskMutationErrorSchema = Type.Object(
    {
        success: Type.Literal(false),
        taskId: taskIdSchema,
        error: Type.String({ minLength: 1, maxLength: 1_024 }),
        updatedFields: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 16 }),
        ),
    },
    { additionalProperties: false },
);
export type TaskMutationError = Static<typeof taskMutationErrorSchema>;

/** Domain validation failures are returned as normal tool results by task mutation tools. */
export class TaskValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TaskValidationError";
    }
}

/**
 * Validate metadata after its TypeBox shape has been checked. This keeps recursive JSON bounded at
 * the persistence boundary instead of relying on a formatter-time limit.
 */
export function assertTaskMetadata(value: unknown): asserts value is TaskMetadata {
    assertTaskMetadataStructure(value);
    if (!Value.Check(taskMetadataSchema, value)) {
        throw new TaskValidationError("Task metadata has an invalid shape.");
    }
    assertEncodedMetadataSize(value);
}

/** Validate an update patch before applying its null-as-delete semantics. */
export function assertTaskMetadataPatch(value: unknown): asserts value is TaskMetadataPatch {
    assertTaskMetadataStructure(value);
    if (!Value.Check(taskMetadataPatchSchema, value)) {
        throw new TaskValidationError("Task metadata patch has an invalid shape.");
    }
    assertMetadataPatchValue(value, 0, new Set<object>());
    assertEncodedMetadataSize(value);
}

/**
 * Establish that a metadata value is a finite tree, before anything else walks it.
 *
 * Checking the schema, cloning the value, and encoding it all recurse. A caller can hand in an
 * object that points back at itself, and every one of those would exhaust the stack instead of
 * reporting a bad value, so the tree is shown to terminate first and the rest of validation then
 * runs on something known to be finite.
 */
export function assertTaskMetadataStructure(value: unknown): void {
    assertMetadataValue(value, 0, new Set<object>());
}

function assertMetadataValue(value: unknown, depth: number, seen: Set<object>): void {
    if (depth > MAX_TASK_METADATA_DEPTH) {
        throw new TaskValidationError("Task metadata is nested too deeply.");
    }
    if (value === null || typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) {
            throw new TaskValidationError("Task metadata numbers must be finite.");
        }
        return;
    }
    if (seen.has(value)) throw new TaskValidationError("Task metadata cannot contain cycles.");
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) assertMetadataValue(item, depth + 1, seen);
    } else {
        for (const item of Object.values(value)) assertMetadataValue(item, depth + 1, seen);
    }
    seen.delete(value);
}

function assertMetadataPatchValue(value: unknown, depth: number, seen: Set<object>): void {
    if (depth > MAX_TASK_METADATA_DEPTH) {
        throw new TaskValidationError("Task metadata is nested too deeply.");
    }
    if (value === null || typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) {
            throw new TaskValidationError("Task metadata numbers must be finite.");
        }
        return;
    }
    if (seen.has(value)) throw new TaskValidationError("Task metadata cannot contain cycles.");
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) assertMetadataValue(item, depth + 1, seen);
    } else {
        for (const item of Object.values(value)) {
            if (item !== null) assertMetadataValue(item, depth + 1, seen);
        }
    }
    seen.delete(value);
}

function assertEncodedMetadataSize(value: unknown): void {
    let encoded: string;
    try {
        encoded = JSON.stringify(value);
    } catch {
        throw new TaskValidationError("Task metadata must be JSON serializable.");
    }
    if (new TextEncoder().encode(encoded).byteLength > MAX_TASK_METADATA_BYTES) {
        throw new TaskValidationError("Task metadata exceeds its encoded size bound.");
    }
}
