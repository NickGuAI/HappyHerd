import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ os: 'web' }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            get OS() { return platform.os; },
            select: (options: Record<string, unknown>) => options[platform.os] ?? options.default,
        },
        Pressable: host('Pressable'),
        Text: host('Text'),
        View: host('View'),
    };
});
vi.mock('react-native-unistyles', () => {
    const theme = {
        dark: false,
        colors: {
            agentEventText: 'event-text',
            divider: 'divider',
            input: { text: 'input-text' },
            text: 'text',
            userMessageBackground: 'user-message',
        },
    };
    return {
        StyleSheet: {
            create: (factory: any) => factory(theme),
            hairlineWidth: 1,
        },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn(async () => {}) }));
vi.mock('./markdown/MarkdownView', async () => {
    const ReactModule = await import('react');
    return { MarkdownView: (props: any) => ReactModule.createElement('MarkdownView', props) };
});
vi.mock('./tools/ToolView', async () => {
    const ReactModule = await import('react');
    return { ToolView: (props: any) => ReactModule.createElement('ToolView', props) };
});
vi.mock('@/sync/sync', () => ({ sync: { sendMessage: vi.fn() } }));
vi.mock('@/sync/storage', () => ({ useSetting: () => 'default' }));
vi.mock('./layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('./parseLocalCommandMessage', () => ({
    parseLocalCommandMessage: (text: string) => ({ kind: 'text', text }),
    isUserSlashCommandEcho: () => false,
}));
vi.mock('@/utils/userMessageBubbleColor', () => ({
    resolveUserMessageBubbleColor: () => ({ background: 'background', border: 'border' }),
}));
vi.mock('./LongPressCopyable', async () => {
    const ReactModule = await import('react');
    return { LongPressCopyable: (props: any) => ReactModule.createElement('LongPressCopyable', props, props.children) };
});
vi.mock('@/text', () => ({
    t: (key: string, params?: Record<string, string>) => key === 'message.providerAccountSwitched'
        ? `Quota exhaustion on ${params?.provider} triggered an account switch from ${params?.fromAccount} to ${params?.toAccount}.`
        : key,
}));

import { MessageView } from './MessageView';
import { sync } from '@/sync/sync';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

function renderSwitch(provider: 'claude' | 'codex' | 'grok'): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(MessageView, {
            message: {
                id: 'switch-row',
                createdAt: 1,
                kind: 'agent-event',
                event: {
                    type: 'provider-account-switched',
                    provider,
                    fromAccount: 'personal-账号',
                    toAccount: 'work-primary',
                    incidentId: 'incident-1',
                },
            },
            metadata: null,
            sessionId: 'session-1',
        }));
    });
    return renderer;
}

describe('MessageView provider account switch receipt', () => {
    it('uses the same localized system row on desktop and native while naming non-Claude providers correctly', () => {
        platform.os = 'web';
        const desktop = renderSwitch('grok');
        expect(desktop.root.findByType('Text' as any).children.join('')).toBe(
            'Quota exhaustion on GrokBuild triggered an account switch from personal-账号 to work-primary.',
        );

        platform.os = 'ios';
        const native = renderSwitch('codex');
        expect(native.root.findByType('Text' as any).children.join('')).toBe(
            'Quota exhaustion on Codex triggered an account switch from personal-账号 to work-primary.',
        );
    });
});

describe('MessageView suggestion option boundary', () => {
    it('forwards an exact chip selection to the session once', () => {
        platform.os = 'web';
        vi.mocked(sync.sendMessage).mockClear();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(MessageView, {
                message: {
                    kind: 'agent-text',
                    id: 'options-row',
                    localId: null,
                    createdAt: 1,
                    text: '<options>\n<option>保持 Speaker 2 不变</option>\n</options>',
                },
                metadata: null,
                sessionId: 'session-options',
            }));
        });

        const markdown = renderer.root.findByType('MarkdownView' as any);
        expect(markdown.props.markdown).toContain('<option>保持 Speaker 2 不变</option>');
        act(() => markdown.props.onOptionPress({ title: '保持 Speaker 2 不变' }));
        expect(sync.sendMessage).toHaveBeenCalledOnce();
        expect(sync.sendMessage).toHaveBeenCalledWith(
            'session-options',
            '保持 Speaker 2 不变',
            { source: 'option' },
        );
        act(() => renderer.unmount());
    });
});
