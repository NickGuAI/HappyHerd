import { describe, expect, it } from 'vitest';
import type { HappyHerdAutomation, HappyHerdAutomationRun } from '@slopus/happy-wire';

import {
    happyHerdAutomationKindLabel,
    happyHerdAutomationRowMeta,
    happyHerdAutomationRunStatusLabel,
} from './happyHerdAutomationPresentation';

const messages: Record<string, string> = {
    'happyHerd.automations.kindScheduled': 'Scheduled',
    'happyHerd.automations.kindHeartbeat': 'Heartbeat',
    'happyHerd.automations.kindMemoryMaintenance': 'Memory maintenance',
    'happyHerd.automations.runStatusRunning': 'Running',
    'happyHerd.automations.runStatusCompleted': 'Completed',
    'happyHerd.automations.runStatusFailed': 'Failed',
    'happyHerd.automations.runStatusSkipped': 'Skipped',
    'happyHerd.automations.runStatusMissed': 'Missed',
    'happyHerd.automations.cadenceScheduled': 'Scheduled',
    'happyHerd.automations.cadenceDailyAt': 'Daily at {time}',
    'happyHerd.automations.cadenceWeekdaysAt': 'Weekdays at {time}',
    'happyHerd.automations.cadenceWeeklyAt': 'Weekly on {day} at {time}',
    'happyHerd.automations.cadenceMonthlyAt': 'Monthly on day {day} at {time}',
    'happyHerd.automations.nextRunIn': 'Next run in {duration}',
    'happyHerd.automations.nextRunNow': 'Next run now',
    'happyHerd.automations.statusPaused': 'Paused',
    'happyHerd.heartbeat.every': 'Every',
};

function translate(key: string, params: Record<string, string | number> = {}): string {
    return Object.entries(params).reduce(
        (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
        messages[key] ?? key,
    );
}

function scheduledAutomation(overrides: Partial<HappyHerdAutomation> = {}): HappyHerdAutomation {
    return {
        schemaVersion: 3,
        runtimeOwner: 'happyherd',
        id: '11111111-1111-4111-8111-111111111111',
        machineId: 'machine-a',
        name: 'daily-attention',
        kind: 'scheduled',
        instruction: 'Review.',
        schedule: '0 7 * * *',
        timezone: 'America/New_York',
        workspace: '/srv/app',
        rail: 'codex',
        commanderId: null,
        status: 'active',
        maxRetries: 0,
        tags: [],
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:00.000Z',
        lastScheduledAt: null,
        lastRunAt: null,
        ...overrides,
    } as HappyHerdAutomation;
}

describe('HappyHerd automation presentation', () => {
    it('localizes automation kinds and every run status', () => {
        expect(happyHerdAutomationKindLabel('scheduled', translate)).toBe('Scheduled');
        expect(happyHerdAutomationKindLabel('heartbeat', translate)).toBe('Heartbeat');
        expect(happyHerdAutomationKindLabel('memory-maintenance', translate)).toBe('Memory maintenance');

        expect([
            'running',
            'started',
            'completed',
            'failed',
            'skipped',
            'missed',
        ].map((status) => happyHerdAutomationRunStatusLabel(
            status as HappyHerdAutomationRun['status'],
            translate,
        ))).toEqual(['Running', 'Running', 'Completed', 'Failed', 'Skipped', 'Missed']);
    });

    it('shows a localized daily cadence and exact next run in the automation timezone', () => {
        const now = Date.parse('2026-08-30T10:00:00.000Z');
        expect(happyHerdAutomationRowMeta(scheduledAutomation(), translate, 'en', now))
            .toBe('Daily at 7:00 AM · Next run in 1h');
    });

    it('shows weekly cadence and does not claim a next run while paused', () => {
        const now = Date.parse('2026-08-30T03:00:00.000Z');
        expect(happyHerdAutomationRowMeta(scheduledAutomation({
            schedule: '0 4 * * 0',
            timezone: 'UTC',
        }), translate, 'en', now)).toBe('Weekly on Sunday at 4:00 AM · Next run in 1h');
        expect(happyHerdAutomationRowMeta(scheduledAutomation({
            schedule: '0 4 * * 0',
            timezone: 'UTC',
            status: 'paused',
        }), translate, 'en', now)).toBe('Weekly on Sunday at 4:00 AM · Paused');
    });

    it('uses the persisted heartbeat due time and a safe fallback for complex cron', () => {
        const now = Date.parse('2026-08-30T10:00:00.000Z');
        const heartbeat = {
            ...scheduledAutomation(),
            kind: 'heartbeat',
            schedule: null,
            targetSessionId: 'session-1',
            intervalSeconds: 1_800,
            nextDueAt: '2026-08-30T10:30:00.000Z',
            maxRetries: 0,
        } as HappyHerdAutomation;

        expect(happyHerdAutomationRowMeta(heartbeat, translate, 'en', now))
            .toBe('Every 30m · Next run in 30m');
        expect(happyHerdAutomationRowMeta(scheduledAutomation({
            schedule: '*/15 * * * *',
        }), translate, 'en', now)).toBe('Scheduled');
    });

    it('keeps a heartbeat cadence exact while rounding only its next-run countdown', () => {
        const now = Date.parse('2026-08-30T10:00:00.000Z');
        const heartbeat = {
            ...scheduledAutomation(),
            kind: 'heartbeat',
            schedule: null,
            targetSessionId: 'session-1',
            intervalSeconds: 90,
            nextDueAt: '2026-08-30T10:01:30.000Z',
            maxRetries: 0,
        } as HappyHerdAutomation;

        expect(happyHerdAutomationRowMeta(heartbeat, translate, 'en', now))
            .toBe('Every 90s · Next run in 2m');
    });
});
