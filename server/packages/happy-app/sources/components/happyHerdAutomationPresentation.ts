import type {
    HappyHerdAutomation,
    HappyHerdAutomationRun,
} from '@slopus/happy-wire';

import { formatCompactCountdown } from '@/utils/heartbeatCommand';

type Translate = (key: any, params?: Record<string, string | number>) => string;
type SupportedLocale = 'en' | 'cn' | 'de';

type SimpleSchedule = {
    hour: number;
    minute: number;
    matchesDate: (date: Date) => boolean;
    cadence: (translate: Translate, locale: SupportedLocale) => string;
};

const WEEKDAYS: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
};

function localeTag(locale: SupportedLocale): string {
    if (locale === 'cn') return 'zh-CN';
    if (locale === 'de') return 'de-DE';
    return 'en-US';
}

function exactInteger(value: string, minimum: number, maximum: number): number | null {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number.parseInt(value, 10);
    return parsed >= minimum && parsed <= maximum ? parsed : null;
}

function weekdayIndex(value: string): number | null {
    const normalized = value.toLowerCase();
    const numeric = exactInteger(normalized, 0, 7);
    if (numeric !== null) return numeric === 7 ? 0 : numeric;
    return WEEKDAYS[normalized] ?? null;
}

function timeLabel(hour: number, minute: number, locale: SupportedLocale): string {
    return new Intl.DateTimeFormat(localeTag(locale), {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(2026, 0, 4, hour, minute)));
}

function weekdayLabel(day: number, locale: SupportedLocale): string {
    return new Intl.DateTimeFormat(localeTag(locale), {
        weekday: 'long',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(2026, 0, 4 + day)));
}

function parseSimpleSchedule(schedule: string): SimpleSchedule | null {
    const fields = schedule.trim().split(/\s+/);
    const normalized = fields.length === 5
        ? fields
        : fields.length === 6 && fields[0] === '0'
            ? fields.slice(1)
            : null;
    if (!normalized) return null;

    const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = normalized;
    const minute = exactInteger(minuteField, 0, 59);
    const hour = exactInteger(hourField, 0, 23);
    if (minute === null || hour === null || month !== '*') return null;

    if (dayOfMonth === '*' && dayOfWeek === '*') {
        return {
            hour,
            minute,
            matchesDate: () => true,
            cadence: (translate, locale) => translate('happyHerd.automations.cadenceDailyAt', {
                time: timeLabel(hour, minute, locale),
            }),
        };
    }

    if (dayOfMonth === '*' && dayOfWeek === '1-5') {
        return {
            hour,
            minute,
            matchesDate: (date) => date.getUTCDay() >= 1 && date.getUTCDay() <= 5,
            cadence: (translate, locale) => translate('happyHerd.automations.cadenceWeekdaysAt', {
                time: timeLabel(hour, minute, locale),
            }),
        };
    }

    const weekday = dayOfMonth === '*' ? weekdayIndex(dayOfWeek) : null;
    if (weekday !== null) {
        return {
            hour,
            minute,
            matchesDate: (date) => date.getUTCDay() === weekday,
            cadence: (translate, locale) => translate('happyHerd.automations.cadenceWeeklyAt', {
                day: weekdayLabel(weekday, locale),
                time: timeLabel(hour, minute, locale),
            }),
        };
    }

    const monthDay = dayOfWeek === '*' ? exactInteger(dayOfMonth, 1, 31) : null;
    if (monthDay !== null) {
        return {
            hour,
            minute,
            matchesDate: (date) => date.getUTCDate() === monthDay,
            cadence: (translate, locale) => translate('happyHerd.automations.cadenceMonthlyAt', {
                day: monthDay,
                time: timeLabel(hour, minute, locale),
            }),
        };
    }

    return null;
}

type ZonedParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
};

function zonedParts(timestamp: number, timezone: string): ZonedParts | null {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(new Date(timestamp));
        const value = (type: Intl.DateTimeFormatPartTypes) => Number.parseInt(
            parts.find((part) => part.type === type)?.value ?? '',
            10,
        );
        const result = {
            year: value('year'),
            month: value('month'),
            day: value('day'),
            hour: value('hour'),
            minute: value('minute'),
        };
        return Object.values(result).every(Number.isFinite) ? result : null;
    } catch {
        return null;
    }
}

function wallClockTimestamp(parts: ZonedParts, timezone: string): number | null {
    const intended = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    let candidate = intended;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const observed = zonedParts(candidate, timezone);
        if (!observed) return null;
        const observedWallClock = Date.UTC(
            observed.year,
            observed.month - 1,
            observed.day,
            observed.hour,
            observed.minute,
        );
        const adjustment = intended - observedWallClock;
        if (adjustment === 0) break;
        candidate += adjustment;
    }

    const verified = zonedParts(candidate, timezone);
    return verified
        && verified.year === parts.year
        && verified.month === parts.month
        && verified.day === parts.day
        && verified.hour === parts.hour
        && verified.minute === parts.minute
        ? candidate
        : null;
}

function nextSimpleOccurrence(
    schedule: SimpleSchedule,
    timezone: string,
    now: number,
): number | null {
    const current = zonedParts(now, timezone);
    if (!current) return null;
    const localDate = new Date(Date.UTC(current.year, current.month - 1, current.day));

    for (let offset = 0; offset <= 62; offset += 1) {
        const date = new Date(localDate.getTime() + offset * 86_400_000);
        if (!schedule.matchesDate(date)) continue;
        const candidate = wallClockTimestamp({
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate(),
            hour: schedule.hour,
            minute: schedule.minute,
        }, timezone);
        if (candidate !== null && candidate > now) return candidate;
    }

    return null;
}

export function happyHerdAutomationKindLabel(
    kind: HappyHerdAutomation['kind'],
    translate: Translate,
): string {
    if (kind === 'heartbeat') return translate('happyHerd.automations.kindHeartbeat');
    if (kind === 'memory-maintenance') return translate('happyHerd.automations.kindMemoryMaintenance');
    return translate('happyHerd.automations.kindScheduled');
}

export function happyHerdAutomationRunStatusLabel(
    status: HappyHerdAutomationRun['status'],
    translate: Translate,
): string {
    if (status === 'running' || status === 'started') {
        return translate('happyHerd.automations.runStatusRunning');
    }
    if (status === 'completed') return translate('happyHerd.automations.runStatusCompleted');
    if (status === 'failed') return translate('happyHerd.automations.runStatusFailed');
    if (status === 'skipped') return translate('happyHerd.automations.runStatusSkipped');
    return translate('happyHerd.automations.runStatusMissed');
}

export function happyHerdAutomationRowMeta(
    automation: HappyHerdAutomation,
    translate: Translate,
    locale: SupportedLocale,
    now: number = Date.now(),
): string {
    const simpleSchedule = automation.kind === 'heartbeat'
        ? null
        : parseSimpleSchedule(automation.schedule);
    const cadence = automation.kind === 'heartbeat'
        ? `${translate('happyHerd.heartbeat.every')} ${formatCompactCountdown(automation.intervalSeconds)}`
        : simpleSchedule?.cadence(translate, locale)
            ?? translate('happyHerd.automations.cadenceScheduled');

    if (automation.status === 'paused') {
        return `${cadence} · ${translate('happyHerd.automations.statusPaused')}`;
    }

    const nextRunAt = automation.kind === 'heartbeat'
        ? automation.nextDueAt ? Date.parse(automation.nextDueAt) : Number.NaN
        : simpleSchedule ? nextSimpleOccurrence(simpleSchedule, automation.timezone, now) : null;
    if (nextRunAt === null || !Number.isFinite(nextRunAt)) return cadence;

    const remainingSeconds = Math.max(0, Math.ceil((nextRunAt - now) / 1_000));
    const nextRun = remainingSeconds === 0
        ? translate('happyHerd.automations.nextRunNow')
        : translate('happyHerd.automations.nextRunIn', {
            duration: formatCompactCountdown(remainingSeconds),
        });
    return `${cadence} · ${nextRun}`;
}
