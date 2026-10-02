import { Value } from "@sinclair/typebox/value";

import {
    schedulingDurationSchema,
    schedulingInstantSchema,
    type SchedulingDuration,
    type SchedulingInstant,
} from "./Scheduling.js";

const DURATION_UNITS: Readonly<Record<string, number>> = {
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000,
    h: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    s: 1_000,
    sec: 1_000,
    secs: 1_000,
    second: 1_000,
    seconds: 1_000,
};

/** How many milliseconds a requested duration is, in any of the forms a model may write. */
export function durationMilliseconds(duration: SchedulingDuration): number {
    if (!Value.Check(schedulingDurationSchema, duration)) {
        throw new Error("Scheduling duration is invalid.");
    }
    const amount =
        typeof duration === "string"
            ? parseDurationText(duration)
            : (duration.seconds ?? 0) * 1_000 +
              (duration.minutes ?? 0) * 60_000 +
              (duration.hours ?? 0) * 3_600_000 +
              (duration.days ?? 0) * 86_400_000;
    const rounded = Math.round(amount);
    if (!Number.isSafeInteger(rounded) || rounded < 0) {
        throw new Error(
            "Scheduling duration must resolve to a finite whole number of milliseconds.",
        );
    }
    return rounded;
}

/** The millisecond timestamp a requested date names, in any of the forms a model may write. */
export function instantMilliseconds(instant: SchedulingInstant): number {
    if (!Value.Check(schedulingInstantSchema, instant)) {
        throw new Error("Scheduling time is invalid.");
    }
    if (typeof instant === "number") return unixTimestampMilliseconds(instant);
    const trimmed = instant.trim();
    if (trimmed.length === 0) throw new Error("Provide a scheduled date.");
    if (/^[+-]?\d+(?:\.\d+)?$/u.test(trimmed)) return unixTimestampMilliseconds(Number(trimmed));
    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) {
        throw new Error(
            "The date could not be understood. Use ISO 8601, RFC 2822, or a Unix timestamp.",
        );
    }
    return parsed;
}

/** A duration written the way a person says it, such as `2 hours` or `1 hour 30 minutes`. */
export function humanDuration(milliseconds: number): string {
    if (milliseconds < 1_000) return `${milliseconds} milliseconds`;
    if (milliseconds < 60_000) return quantity(milliseconds / 1_000, "second");
    if (milliseconds < 3_600_000) return quantity(milliseconds / 60_000, "minute");
    if (milliseconds < 86_400_000) return quantity(milliseconds / 3_600_000, "hour");
    return quantity(milliseconds / 86_400_000, "day");
}

function quantity(value: number, unit: string): string {
    const shown = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, "");
    return `${shown} ${Number(shown) === 1 ? unit : `${unit}s`}`;
}

function parseDurationText(value: string): number {
    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) throw new Error("Provide a duration.");
    let total = 0;
    let matchedThrough = 0;
    for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/gu)) {
        const between = normalized.slice(matchedThrough, match.index).trim();
        if (between.length > 0 && between !== ",") {
            throw new Error(
                `The duration could not be understood near ${JSON.stringify(between)}.`,
            );
        }
        const multiplier = DURATION_UNITS[match[2] ?? ""];
        if (multiplier === undefined) {
            throw new Error(`Unknown duration unit ${JSON.stringify(match[2] ?? "")}.`);
        }
        total += Number(match[1]) * multiplier;
        matchedThrough = (match.index ?? 0) + match[0].length;
    }
    if (matchedThrough === 0 || normalized.slice(matchedThrough).trim().length > 0) {
        throw new Error(
            "The duration could not be understood. Examples: 90 seconds, 2 hours, 1h 30m.",
        );
    }
    return total;
}

function unixTimestampMilliseconds(value: number): number {
    if (!Number.isFinite(value)) throw new Error("The scheduled date must be finite.");
    const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
    const rounded = Math.round(milliseconds);
    if (!Number.isSafeInteger(rounded)) {
        throw new Error("The scheduled date must resolve to a whole millisecond timestamp.");
    }
    return rounded;
}
