import {
    type SchedulingSchedulePage,
    type SchedulingScheduleStatus,
    type SchedulingScheduledMessage,
    type SchedulingWaitResult,
} from "./Scheduling.js";
import { humanDuration } from "./schedulingTime.js";

/** What the model is told when a wait ends. A wait ID means nothing to it, so it never appears. */
export function waitText(result: SchedulingWaitResult): string {
    const elapsed = humanDuration(result.elapsedMs);
    return result.outcome === "interrupted"
        ? `The wait ended early because a new message arrived after ${elapsed}.`
        : `The wait finished after ${elapsed}.`;
}

/** What the model is told about one scheduled message it just created. */
export function scheduleText(schedule: SchedulingScheduledMessage): string {
    const recipient =
        schedule.targetAgentId === schedule.senderAgentId
            ? "yourself"
            : `agent ${schedule.targetAgentId}`;
    return `Message ${schedule.id} to ${recipient} is ${statusText(schedule.status)}; due ${dateText(
        schedule.dueAt,
    )}.`;
}

/** What the model is told about a message it cancelled. */
export function cancellationText(schedule: SchedulingScheduledMessage): string {
    return `Message ${schedule.id} is now ${statusText(schedule.status)}.`;
}

/**
 * A page of scheduled messages, trimmed to fit the model's output budget.
 *
 * Trimming moves the cursor back with it: a row that did not fit is not skipped, it is simply on
 * the next page, so paging can never step over a message the model never saw.
 */
export function schedulePageText(
    page: SchedulingSchedulePage,
    maxOutputCharacters: number,
): { readonly page: SchedulingSchedulePage; readonly text: string } {
    if (page.schedules.length === 0) {
        return { page, text: "You have no scheduled messages." };
    }
    const start = pageStart(page);
    let fitted = pageOf(page, start, 0);
    let text = renderPage(fitted);
    for (let visible = 1; visible <= page.schedules.length; visible += 1) {
        const candidate = pageOf(page, start, visible);
        const candidateText = renderPage(candidate);
        if (candidateText.length > maxOutputCharacters) break;
        fitted = candidate;
        text = candidateText;
    }
    if (fitted.schedules.length === 0) {
        throw new Error("A scheduled message does not fit the model output budget.");
    }
    return { page: fitted, text };
}

/** The status of a scheduled message in the words a person would use. */
export function statusText(status: SchedulingScheduleStatus): string {
    switch (status) {
        case "pending":
            return "waiting to be delivered";
        case "delivered":
            return "delivered";
        case "undelivered":
            return "not delivered";
        case "cancelled":
            return "cancelled before delivery";
    }
}

/** Parse a page cursor, which is an offset into the sender's messages in due order. */
export function parseCursor(cursor: string | undefined): number {
    if (cursor === undefined) return 0;
    const value = Number(cursor);
    if (!Number.isSafeInteger(value) || value < 0 || String(value) !== cursor) {
        throw new Error("Scheduling cursor is not a bounded integer.");
    }
    return value;
}

function pageOf(
    page: SchedulingSchedulePage,
    start: number,
    visible: number,
): SchedulingSchedulePage {
    const schedules = page.schedules.slice(0, visible);
    const truncated = visible < page.schedules.length;
    return {
        schedules,
        limit: page.limit,
        ...(truncated || page.nextCursor !== undefined
            ? { nextCursor: String(start + visible) }
            : {}),
        ...(page.previousCursor === undefined ? {} : { previousCursor: page.previousCursor }),
    };
}

function renderPage(page: SchedulingSchedulePage): string {
    const rows = page.schedules.map(
        (schedule) =>
            `${schedule.id} | to ${schedule.targetAgentId} | ${statusText(
                schedule.status,
            )} | due ${dateText(schedule.dueAt)}`,
    );
    return [
        ...rows,
        ...(page.previousCursor === undefined
            ? []
            : [`Earlier messages start at cursor ${page.previousCursor}.`]),
        ...(page.nextCursor === undefined
            ? []
            : [`More messages start at cursor ${page.nextCursor}.`]),
    ].join("\n");
}

function pageStart(page: SchedulingSchedulePage): number {
    if (page.nextCursor !== undefined) return parseCursor(page.nextCursor) - page.schedules.length;
    if (page.previousCursor !== undefined) return parseCursor(page.previousCursor) + page.limit;
    return 0;
}

function dateText(timestamp: number): string {
    return new Date(timestamp).toISOString();
}
