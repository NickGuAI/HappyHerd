import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HappyHerdAutomation } from '@slopus/happy-wire';

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

describe('HappyHerdAutomationCard', () => {
    it('keeps details hidden until its summary is opened', () => {
        const automation = {
            id: 'automation-1',
            name: 'memory-reflector-weekly',
            status: 'active',
            schedule: '0 4 * * 0',
            timezone: 'America/New_York',
            kind: 'memory-maintenance',
            instruction: 'Private automation instruction',
            rail: 'codex',
            workspace: '/srv/workspace',
            commanderId: null,
        } as HappyHerdAutomation;
        let renderer!: ReactTestRenderer;

        act(() => {
            renderer = create(React.createElement(HappyHerdAutomationCard, {
                automation,
                onToggleStatus: vi.fn(),
                onRunNow: vi.fn(),
                onToggleHistory: vi.fn(),
                onEdit: vi.fn(),
                onDelete: vi.fn(),
            }));
        });

        expect(visibleText(renderer)).toContain('memory-reflector-weekly Active');
        expect(visibleText(renderer)).not.toContain('0 4 * * 0');
        expect(visibleText(renderer)).not.toContain('Private automation instruction');

        const summary = renderer.root.findByProps({
            accessibilityLabel: 'Show details for memory-reflector-weekly',
        });
        expect(summary.props.accessibilityState).toEqual({ expanded: false });

        act(() => summary.props.onPress());

        expect(visibleText(renderer)).toContain('0 4 * * 0');
        expect(visibleText(renderer)).toContain('America/New_York');
        expect(visibleText(renderer)).toContain('Private automation instruction');
        expect(visibleText(renderer)).toContain('Run now');
        expect(renderer.root.findByProps({
            accessibilityLabel: 'Hide details for memory-reflector-weekly',
        }).props.accessibilityState).toEqual({ expanded: true });
    });
});
