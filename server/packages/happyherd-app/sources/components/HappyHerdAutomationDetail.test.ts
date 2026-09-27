import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HappyHerdAutomation, HappyHerdAutomationRun } from '@happyherd/wire';

import { lightTheme } from '@/theme';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: { OS: 'web' },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        Text: host('Text'),
        View: host('View'),
        useWindowDimensions: () => ({ width: 1200, height: 800 }),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    const theme = {
        ...lightTheme,
        colors: {
            ...lightTheme.colors,
            text: '#111111',
            textSecondary: '#666666',
            textLink: '#2baccc',
            surface: '#ffffff',
            divider: '#dddddd',
            status: { disconnected: '#cc0000' },
        },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: (value: typeof theme) => unknown) => factory(theme),
        },
        useUnistyles: () => ({ theme }),
    };
});

vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});

vi.mock('@/components/markdown/MarkdownView', async () => {
    const ReactModule = await import('react');
    return { MarkdownView: (props: any) => ReactModule.createElement('MarkdownView', props) };
});

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}), mono: () => ({}) } }));
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => (
        values?.id ? `${key}:${values.id}` : key
    ),
}));

import { HappyHerdAutomationDetail } from './HappyHerdAutomationDetail';

const automation: HappyHerdAutomation = {
    schemaVersion: 4,
    runtimeOwner: 'happyherd',
    id: '11111111-1111-4111-8111-111111111111',
    machineId: 'machine-a',
    name: 'daily-attention',
    kind: 'scheduled',
    instruction: '# Daily attention\n\nReview **important** work.',
    schedule: '0 7 * * *',
    timezone: 'America/New_York',
    workspace: '/srv/daily-attention',
    rail: 'codex',
    commanderId: 'athena',
    status: 'active',
    maxRetries: 0,
    tags: ['dream', 'health'],
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    lastScheduledAt: null,
    lastRunAt: '2026-08-30T11:00:00.000Z',
};

const run: HappyHerdAutomationRun = {
    id: '22222222-2222-4222-8222-222222222222',
    automationId: automation.id,
    source: 'schedule',
    scheduledFor: '2026-08-30T11:00:00.000Z',
    startedAt: '2026-08-30T11:00:01.000Z',
    finishedAt: '2026-08-30T11:02:00.000Z',
    status: 'completed',
    attempt: 1,
    sessionId: 'session-123',
    message: '3 items summarized',
};

const execAutomation: HappyHerdAutomation = {
    schemaVersion: 4,
    runtimeOwner: 'happyherd',
    id: '33333333-3333-4333-8333-333333333333',
    machineId: 'machine-a',
    name: 'data-sink',
    kind: 'scheduled',
    schedule: '0 */2 * * *',
    timezone: 'UTC',
    workspace: '/srv/happyherd',
    rail: 'exec',
    executable: '/opt/happyherd/bin/data-sink',
    arguments: ['--run-now'],
    status: 'paused',
    tags: ['Operations'],
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
    lastScheduledAt: null,
    lastRunAt: '2026-08-30T02:00:00.000Z',
};

const execRun: HappyHerdAutomationRun = {
    id: '44444444-4444-4444-8444-444444444444',
    automationId: execAutomation.id,
    source: 'schedule',
    scheduledFor: '2026-08-30T02:00:00.000Z',
    startedAt: '2026-08-30T02:00:01.000Z',
    finishedAt: '2026-08-30T02:00:02.000Z',
    status: 'failed',
    execution: 'exec',
    attempt: 1,
    sessionId: null,
    message: 'Command exited with code 2.',
};

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

function renderDetail(overrides: Partial<React.ComponentProps<typeof HappyHerdAutomationDetail>> = {}) {
    const props: React.ComponentProps<typeof HappyHerdAutomationDetail> = {
        automation,
        machineName: 'MainEC2',
        history: [run],
        historyLoading: false,
        historyFailed: false,
        onRunNow: vi.fn(),
        onEdit: vi.fn(),
        onToggleStatus: vi.fn(),
        onDelete: vi.fn(),
        onOpenSession: vi.fn(),
        onRetryHistory: vi.fn(),
        ...overrides,
    };
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(HappyHerdAutomationDetail, props));
    });
    return { props, renderer };
}

describe('HappyHerdAutomationDetail', () => {
    function renderedText(renderer: ReactTestRenderer): unknown[] {
        return renderer.root.findAllByType('Text' as any)
            .map((node: any) => node.props.children)
            .flat(Infinity);
    }

    function byTestId(renderer: ReactTestRenderer, type: string, testID: string) {
        return renderer.root.findAll((node: any) => node.type === type && node.props.testID === testID);
    }

    function runRows(renderer: ReactTestRenderer) {
        return renderer.root.findAll((node: any) => (
            (node.type === 'View' || node.type === 'Pressable')
            && node.props.style?.flat?.().some((style: any) => style?.minHeight === 40 && style?.borderWidth === 1)
        ));
    }

    it('offers Pause for an active automation and Resume for a paused one', () => {
        const active = renderedText(renderDetail().renderer);
        expect(active).toContain('happyHerd.automations.pause');
        expect(active).not.toContain('happyHerd.automations.resume');

        const paused = renderedText(renderDetail({ automation: { ...automation, status: 'paused' } }).renderer);
        expect(paused).toContain('happyHerd.automations.resume');
        expect(paused).not.toContain('happyHerd.automations.pause');
    });

    it('renders Markdown inside a bounded card and expands and collapses it', () => {
        const { renderer } = renderDetail();
        const markdown = renderer.root.findByType('MarkdownView' as any);
        const body = renderer.root.findByProps({ testID: 'automation-instruction-markdown' });
        const toggle = renderer.root.findByProps({
            accessibilityLabel: 'happyHerd.automations.showFullInstruction',
        });

        expect(markdown.props.markdown).toBe(automation.instruction);
        expect(body.props.style.flat()).toEqual(expect.arrayContaining([
            expect.objectContaining({ maxHeight: 92, overflow: 'hidden' }),
        ]));
        expect(toggle.props.accessibilityState).toEqual({ expanded: false });

        act(() => toggle.props.onPress());

        expect(renderer.root.findByProps({
            accessibilityLabel: 'happyHerd.automations.showLessInstruction',
        }).props.accessibilityState).toEqual({ expanded: true });
        expect(renderer.root.findByProps({ testID: 'automation-instruction-markdown' }).props.style.flat())
            .not.toEqual(expect.arrayContaining([expect.objectContaining({ maxHeight: 92 })]));
    });

    it('keeps metadata, previous runs, Run now, Edit, and lifecycle actions accessible', () => {
        const { props, renderer } = renderDetail();

        expect(renderedText(renderer)).toEqual(expect.arrayContaining([
            'MainEC2',
            'dream · health',
            'happyHerd.automations.kindScheduled',
            'happyHerd.automations.runStatusCompleted',
            '0 7 * * *',
            'happyHerd.automations.runNow',
            'happyHerd.automations.editAction',
            'happyHerd.automations.history',
            'happyHerd.automations.pause',
            'happyHerd.automations.delete',
        ]));

        act(() => renderer.root.findByProps({
            accessibilityLabel: 'happyHerd.automations.openSession:session-123',
        }).props.onPress());
        expect(props.onOpenSession).toHaveBeenCalledWith('session-123');

        act(() => renderer.root.findByProps({ accessibilityLabel: 'happyHerd.automations.runNow' }).props.onPress());
        act(() => renderer.root.findByProps({ accessibilityLabel: 'happyHerd.automations.editAction' }).props.onPress());
        act(() => renderer.root.findByProps({ accessibilityLabel: 'happyHerd.automations.delete' }).props.onPress());
        expect(props.onRunNow).toHaveBeenCalledOnce();
        expect(props.onEdit).toHaveBeenCalledOnce();
        expect(props.onDelete).toHaveBeenCalledOnce();

        const toggles = renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.accessibilityLabel === 'happyHerd.automations.pause'
        ));
        expect(toggles.length).toBeGreaterThan(0);
        act(() => toggles[0].props.onPress());
        expect(props.onToggleStatus).toHaveBeenCalledOnce();
    });

    it('names the Commander when its list is loaded and falls back to the identifier', () => {
        expect(renderedText(renderDetail({ commanderName: 'Athena' }).renderer)).toContain('Athena');
        expect(renderedText(renderDetail().renderer)).toContain('athena');
    });

    it('lists the most recent runs until History shows and reloads every run', () => {
        const runs = Array.from({ length: 5 }, (_, index) => ({
            ...run,
            id: `run-${index}`,
            sessionId: null,
            message: `run ${index}`,
        }));
        const onRetryHistory = vi.fn();
        const { renderer } = renderDetail({ history: runs, onRetryHistory });
        const history = () => renderer.root.findByProps({ accessibilityLabel: 'happyHerd.automations.history' });

        expect(runRows(renderer)).toHaveLength(3);
        expect(history().props.accessibilityState).toMatchObject({ selected: false });

        act(() => history().props.onPress());
        expect(onRetryHistory).toHaveBeenCalledOnce();
        expect(runRows(renderer)).toHaveLength(5);
        expect(history().props.accessibilityState).toMatchObject({ selected: true });

        act(() => history().props.onPress());
        expect(onRetryHistory).toHaveBeenCalledOnce();
        expect(runRows(renderer)).toHaveLength(3);
    });

    it('shows a fresh manual run as Running, then Completed when history settles', () => {
        const started: HappyHerdAutomationRun = {
            ...run,
            id: 'fresh-run',
            source: 'manual',
            finishedAt: null,
            status: 'started',
            message: null,
        };
        const { props, renderer } = renderDetail({ history: [started, run], freshRunId: 'fresh-run' });

        expect(byTestId(renderer, 'ActivityIndicator', 'automation-run-running')).toHaveLength(1);
        expect(renderedText(renderer)).toContain('happyHerd.automations.runStatusRunning');

        act(() => renderer.update(React.createElement(HappyHerdAutomationDetail, {
            ...props,
            history: [{ ...started, status: 'completed', finishedAt: '2026-08-30T11:05:00.000Z' }, run],
        })));

        expect(byTestId(renderer, 'ActivityIndicator', 'automation-run-running')).toHaveLength(0);
        expect(byTestId(renderer, 'Ionicons', 'automation-run-completed')).toHaveLength(2);
        expect(renderedText(renderer)).not.toContain('happyHerd.automations.runStatusRunning');
    });

    it('keeps heartbeats to their target session without Run now or lifecycle actions', () => {
        const heartbeat = {
            ...automation,
            kind: 'heartbeat',
            schedule: null,
            targetSessionId: 'session-target',
            intervalSeconds: 1800,
            nextDueAt: null,
            maxRetries: 0,
        } as HappyHerdAutomation;
        const { props, renderer } = renderDetail({ automation: heartbeat });
        const text = renderedText(renderer);

        expect(text).toContain('happyHerd.heartbeat.openTarget');
        expect(text).not.toContain('happyHerd.automations.runNow');
        expect(text).not.toContain('happyHerd.automations.lifecycle');
        act(() => renderer.root.findByProps({ accessibilityLabel: 'happyHerd.heartbeat.openTarget' }).props.onPress());
        expect(props.onEdit).toHaveBeenCalledOnce();
    });

    it('shows the exact exec command and sessionless failure history', () => {
        const { renderer } = renderDetail({
            automation: execAutomation,
            history: [execRun],
        });

        expect(renderedText(renderer)).toEqual(expect.arrayContaining([
            'happyHerd.automations.command',
            '/opt/happyherd/bin/data-sink',
            '["--run-now"]',
            'Command exited with code 2.',
            'happyHerd.automations.runStatusFailed',
        ]));
        expect(renderer.root.findAllByType('MarkdownView' as any)).toHaveLength(0);
        expect(renderer.root.findAll((node: any) => node.props.accessibilityRole === 'link')).toHaveLength(0);
    });

    it('shows a retry action instead of a false empty state when history loading fails', () => {
        const onRetryHistory = vi.fn();
        const { renderer } = renderDetail({
            history: undefined,
            historyFailed: true,
            onRetryHistory,
        });

        const text = renderedText(renderer);
        expect(text).toContain('happyHerd.automations.unableHistory');
        expect(text).not.toContain('happyHerd.automations.noRuns');

        act(() => renderer.root.findByProps({ accessibilityLabel: 'common.retry' }).props.onPress());
        expect(onRetryHistory).toHaveBeenCalledOnce();
    });
});
