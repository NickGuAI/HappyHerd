import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HappyHerdAutomation, HappyHerdAutomationRun } from '@slopus/happy-wire';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
    };
});

vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});

vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
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

vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, unknown>) => (
        values?.id ? `${key}:${values.id}` : key
    ),
}));

import { HappyHerdAutomationDetail } from './HappyHerdAutomationDetail';

const automation: HappyHerdAutomation = {
    schemaVersion: 3,
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
        mobile: false,
        onBack: vi.fn(),
        onClose: vi.fn(),
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
    it('keeps exactly one desktop header action and closes through it', () => {
        const { props, renderer } = renderDetail();
        const header = renderer.root.findByProps({ testID: 'automation-detail-header' });

        expect(header.findAllByType('Pressable' as any)).toHaveLength(1);
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.testID === 'automation-detail-close'
        ))).toHaveLength(1);

        act(() => renderer.root.findByProps({ testID: 'automation-detail-close' }).props.onPress());
        expect(props.onClose).toHaveBeenCalledOnce();
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

    it('shows mobile Back separately from the single close action', () => {
        const onBack = vi.fn();
        const { renderer } = renderDetail({ mobile: true, onBack });
        const header = renderer.root.findByProps({ testID: 'automation-detail-header' });

        expect(header.findAllByType('Pressable' as any)).toHaveLength(2);
        act(() => renderer.root.findByProps({
            accessibilityLabel: 'happyHerd.automations.backToAutomations',
        }).props.onPress());
        expect(onBack).toHaveBeenCalledOnce();
        expect(renderer.root.findAll((node: any) => (
            node.type === 'Pressable' && node.props.testID === 'automation-detail-close'
        ))).toHaveLength(1);
    });

    it('keeps metadata, previous runs, Run now, Edit, and lifecycle actions accessible', () => {
        const { props, renderer } = renderDetail();

        expect(renderer.root.findAllByType('Text' as any).map((node: any) => node.props.children).flat(Infinity))
            .toEqual(expect.arrayContaining([
                'MainEC2',
                'dream · health',
                'happyHerd.automations.kindScheduled',
                'happyHerd.automations.runStatusCompleted',
                '0 7 * * *',
                'happyHerd.automations.runNow',
                'happyHerd.automations.editAction',
                'happyHerd.automations.pause',
                'happyHerd.automations.delete',
            ]));

        act(() => renderer.root.findByProps({
            accessibilityLabel: 'happyHerd.automations.openSession:session-123',
        }).props.onPress());
        expect(props.onOpenSession).toHaveBeenCalledWith('session-123');
    });

    it('uses the approved bounded desktop detail width', () => {
        const { renderer } = renderDetail();
        const panel = renderer.root.findByProps({
            accessibilityLabel: 'happyHerd.automations.details',
        });

        expect(panel.props.style.flat()).toEqual(expect.arrayContaining([
            expect.objectContaining({
                width: '34%',
                minWidth: 420,
                maxWidth: 470,
                flexGrow: 0,
                flexBasis: 'auto',
            }),
        ]));
    });

    it('shows a retry action instead of a false empty state when history loading fails', () => {
        const onRetryHistory = vi.fn();
        const { renderer } = renderDetail({
            history: undefined,
            historyFailed: true,
            onRetryHistory,
        });

        const renderedText = renderer.root.findAllByType('Text' as any)
            .map((node: any) => node.props.children)
            .flat(Infinity);
        expect(renderedText).toContain('happyHerd.automations.unableHistory');
        expect(renderedText).not.toContain('happyHerd.automations.noRuns');

        act(() => renderer.root.findByProps({ accessibilityLabel: 'common.retry' }).props.onPress());
        expect(onRetryHistory).toHaveBeenCalledOnce();
    });
});
