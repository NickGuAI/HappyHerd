import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HappyHerdAutomation, HappyHerdAutomationRun } from '@slopus/happy-wire';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { Pressable: host('Pressable'), Text: host('Text'), View: host('View') };
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
            surface: '#ffffff',
            divider: '#dddddd',
            status: { disconnected: '#cc0000' },
        },
    };
    return {
        StyleSheet: {
            hairlineWidth: 1,
            create: (factory: (value: unknown) => unknown) => factory(theme),
        },
        useUnistyles: () => ({ theme }),
    };
});

vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));

const translations: Record<string, string> = {
    'happyHerd.automations.statusActive': 'Active',
    'happyHerd.automations.expandDetails': 'Show details for {name}',
    'happyHerd.automations.collapseDetails': 'Hide details for {name}',
    'happyHerd.automations.pause': 'Pause',
    'happyHerd.automations.runNow': 'Run now',
    'happyHerd.automations.history': 'History',
    'happyHerd.automations.editAction': 'Edit',
    'happyHerd.automations.delete': 'Delete',
    'happyHerd.automations.openSession': 'Open session {id}',
};

vi.mock('@/text', () => ({
    t: (key: string, values: Record<string, string> = {}) => {
        let value = translations[key] ?? key;
        for (const [name, replacement] of Object.entries(values)) {
            value = value.replace(`{${name}}`, replacement);
        }
        return value;
    },
}));

import { HappyHerdAutomationCard } from './HappyHerdAutomationCard';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

function visibleText(renderer: ReactTestRenderer): string {
    return renderer.root.findAllByType('Text' as any)
        .map((node: any) => node.props.children)
        .flat(Infinity)
        .join(' ');
}

const automation = {
    id: '8f0a5dd0-b7c0-4b60-a747-675b49ccfdc8',
    name: 'memory-reflector-weekly',
    status: 'active',
    schedule: '0 4 * * 0',
    timezone: 'America/New_York',
    kind: 'memory-maintenance',
    instruction: 'Private automation instruction',
    rail: 'codex',
    workspace: '/srv/workspace',
    commanderId: null,
    tags: ['Operations', 'Project Beacon'],
} as HappyHerdAutomation;

describe('HappyHerdAutomationCard', () => {
    it('keeps details hidden until its summary is opened', () => {
        let renderer!: ReactTestRenderer;

        act(() => {
            renderer = create(React.createElement(HappyHerdAutomationCard, {
                automation,
                onToggleStatus: vi.fn(),
                onRunNow: vi.fn(),
                onToggleHistory: vi.fn(),
                onOpenSession: vi.fn(),
                onEdit: vi.fn(),
                onDelete: vi.fn(),
            }));
        });

        expect(visibleText(renderer)).toContain('memory-reflector-weekly Active');
        expect(visibleText(renderer)).not.toContain('0 4 * * 0');
        expect(visibleText(renderer)).not.toContain('Private automation instruction');
        expect(visibleText(renderer)).not.toContain('Project Beacon');

        const summary = renderer.root.findByProps({
            accessibilityLabel: 'Show details for memory-reflector-weekly',
        });
        expect(summary.props.accessibilityState).toEqual({ expanded: false });

        act(() => summary.props.onPress());

        expect(visibleText(renderer)).toContain('0 4 * * 0');
        expect(visibleText(renderer)).toContain('America/New_York');
        expect(visibleText(renderer)).toContain('Private automation instruction');
        expect(visibleText(renderer)).toContain('Operations Project Beacon');
        expect(visibleText(renderer)).toContain('Run now');
        expect(renderer.root.findByProps({
            accessibilityLabel: 'Hide details for memory-reflector-weekly',
        }).props.accessibilityState).toEqual({ expanded: true });
    });

    it('opens successful run sessions while leaving failed runs as plain history', () => {
        const onOpenSession = vi.fn();
        const history = [
            {
                id: '00000000-0000-4000-8000-000000000001',
                automationId: automation.id,
                source: 'schedule',
                scheduledFor: '2026-08-15T04:00:00.000Z',
                startedAt: '2026-08-15T04:00:01.000Z',
                finishedAt: '2026-08-15T04:00:02.000Z',
                status: 'started',
                attempt: 1,
                sessionId: 'session-success',
                message: null,
            },
            {
                id: '00000000-0000-4000-8000-000000000002',
                automationId: automation.id,
                source: 'schedule',
                scheduledFor: '2026-08-14T04:00:00.000Z',
                startedAt: '2026-08-14T04:00:01.000Z',
                finishedAt: '2026-08-14T04:00:02.000Z',
                status: 'failed',
                attempt: 1,
                sessionId: null,
                message: 'provider unavailable',
            },
        ] as HappyHerdAutomationRun[];
        let renderer!: ReactTestRenderer;

        act(() => {
            renderer = create(React.createElement(HappyHerdAutomationCard, {
                automation,
                history,
                onToggleStatus: vi.fn(),
                onRunNow: vi.fn(),
                onToggleHistory: vi.fn(),
                onOpenSession,
                onEdit: vi.fn(),
                onDelete: vi.fn(),
            }));
        });

        act(() => renderer.root.findByProps({
            accessibilityLabel: 'Show details for memory-reflector-weekly',
        }).props.onPress());

        const sessionLinks = renderer.root
            .findAllByType('Pressable' as any)
            .filter((node: any) => node.props.accessibilityRole === 'link');
        expect(sessionLinks).toHaveLength(1);
        expect(sessionLinks[0].props.accessibilityLabel).toBe('Open session session-success');

        act(() => sessionLinks[0].props.onPress());

        expect(onOpenSession).toHaveBeenCalledOnce();
        expect(onOpenSession).toHaveBeenCalledWith('session-success');
        expect(visibleText(renderer)).toContain('failed');
    });
});
