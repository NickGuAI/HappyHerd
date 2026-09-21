import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ os: 'web', dark: false }));

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
vi.mock('react-native-unistyles', async () => {
    const { lightTheme, darkTheme } = await import('@/theme');
    const resolveTheme = () => ({
        ...(platform.dark ? darkTheme : lightTheme),
        colors: {
            ...(platform.dark ? darkTheme.colors : lightTheme.colors),
            agentEventText: 'event-text',
            divider: 'divider',
            input: { text: 'input-text' },
            text: 'text',
            userMessageBackground: 'user-message',
        },
    });
    return {
        StyleSheet: {
            create: (factory: any) => typeof factory === 'function'
                ? new Proxy({}, { get: (_target, key) => factory(resolveTheme())[key] })
                : factory,
            hairlineWidth: 1,
        },
        useUnistyles: () => ({ theme: resolveTheme() }),
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
    parseVisibleUserMessage: (message: { text: string }) => ({ kind: 'text', text: message.text }),
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
        : key === 'message.providerQuotaExhausted'
            ? `Quota exhaustion on ${params?.provider}.`
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

function renderQuota(provider: 'claude' | 'codex' | 'grok' | 'dsh'): ReactTestRenderer {
    let renderer!: ReactTestRenderer;
    act(() => {
        renderer = create(React.createElement(MessageView, {
            message: {
                id: 'quota-row',
                createdAt: 1,
                kind: 'agent-event',
                event: {
                    type: 'provider-quota-exhausted',
                    provider,
                    incidentId: 'quota-incident-1',
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

describe('MessageView provider quota receipt', () => {
    it.each([
        ['claude', 'Claude Code'],
        ['codex', 'Codex'],
        ['grok', 'GrokBuild'],
        ['dsh', 'dsh'],
    ] as const)('renders a localized provider-named row for %s', (provider, providerName) => {
        const renderer = renderQuota(provider);
        expect(renderer.root.findByType('Text' as any).children.join('')).toBe(
            `Quota exhaustion on ${providerName}.`,
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

// These are shared React Native renderer checks. Browser gestures live in the
// SessionView fixture; host mocks do not constitute native device acceptance.
describe('MessageView safeguard shared native renderer', () => {
    const prefix = '<happyherd-safeguard-reminder';
    const ready = `${prefix} status="ready">The destination and testing scope are clear.</happyherd-safeguard-reminder>`;
    const revise = `${prefix} status="revise"><quote>publish it everywhere</quote><suggestion>Name the intended destination first.</suggestion></happyherd-safeguard-reminder>`;
    const body = '**Implementation plan**\n\n<options>\n<option>Approve implementation</option>\n</options>';

    function message(text: string, kind: 'agent-text' | 'user-text' = 'agent-text', isThinking = false) {
        return React.createElement(MessageView, {
            message: { kind, id: 'safeguard-message', localId: null, createdAt: 1, text, ...(isThinking ? { isThinking } : {}) },
            metadata: null,
            sessionId: 'safeguard-session',
        });
    }

    function render(text: string, kind: 'agent-text' | 'user-text' = 'agent-text', isThinking = false): ReactTestRenderer {
        let renderer!: ReactTestRenderer;
        act(() => { renderer = create(message(text, kind, isThinking)); });
        return renderer;
    }

    it.each(['ios', 'android'].flatMap((os) => [false, true].flatMap((dark) =>
        ['ready', 'revise'].map((status) => ({ os, dark, status })),
    )))('places $status before ordinary Markdown on $os with dark=$dark', ({ os, dark, status }) => {
        platform.os = os;
        platform.dark = dark;
        const source = `${status === 'ready' ? ready : revise}\n\n${body}`;
        const renderer = render(source);
        const card = renderer.root.findByProps({ testID: `safeguard-reminder-${status}` });
        expect(card).toBeDefined();
        const markdown = renderer.root.findByType('MarkdownView' as any);
        expect(markdown.props.markdown).toBe(`\n\n${body}`);
        const serialized = JSON.stringify(renderer.toJSON());
        expect(serialized).toContain(`message.safeguard.${status}`);
        expect(serialized).not.toContain(prefix);
        expect(serialized.indexOf(`safeguard-reminder-${status}`)).toBeLessThan(serialized.indexOf('MarkdownView'));
        if (status === 'revise') {
            expect(serialized).toContain('publish it everywhere');
            expect(serialized).toContain('Name the intended destination first.');
        } else {
            expect(serialized).toContain('The destination and testing scope are clear.');
        }
        vi.mocked(sync.sendMessage).mockClear();
        act(() => markdown.props.onOptionPress({ title: 'Approve implementation' }));
        expect(sync.sendMessage).toHaveBeenCalledExactlyOnceWith('safeguard-session', 'Approve implementation', { source: 'option' });
        act(() => renderer.unmount());
        const reopened = render(source);
        expect(JSON.stringify(reopened.toJSON())).toBe(serialized);
        act(() => reopened.unmount());
        platform.dark = false;
    });

    it.each([
        `${prefix} status="ready">`,
        `${prefix} status="ready">Still checking`,
        `${prefix} status="ready"></happyherd-safeguard-reminder>`,
        `${prefix} status="unknown">Proceed</happyherd-safeguard-reminder>`,
        `${prefix} status="revise"><quote>publish</quote></happyherd-safeguard-reminder>`,
    ])('does not turn incomplete or invalid XML into a positive assessment: %s', (text) => {
        platform.os = 'ios';
        const renderer = render(text);
        expect(renderer.root.findAll((node: any) => typeof node.props.testID === 'string' && node.props.testID.startsWith('safeguard-reminder-'))).toHaveLength(0);
        expect(sync.sendMessage).not.toHaveBeenCalledWith('safeguard-session', 'Proceed', expect.anything());
        act(() => renderer.unmount());
    });

    it.each([
        ['agent-text', 'Ordinary **Markdown** remains unchanged.'],
        ['agent-text', `\`\`\`xml\n${ready}\n\`\`\``],
        ['user-text', ready],
    ] as const)('keeps literal content byte-faithful for %s', (kind, text) => {
        platform.os = 'android';
        const renderer = render(text, kind);
        expect(renderer.root.findAll((node: any) => typeof node.props.testID === 'string' && node.props.testID.startsWith('safeguard-reminder-'))).toHaveLength(0);
        expect(renderer.root.findByType('MarkdownView' as any).props.markdown).toBe(text);
        act(() => renderer.unmount());
    });

    it('keeps thinking messages hidden even when they contain a complete reminder', () => {
        const renderer = render(ready, 'agent-text', true);
        expect(renderer.root.findAllByType('MarkdownView' as any)).toHaveLength(0);
        expect(renderer.root.findAll((node: any) => typeof node.props.testID === 'string' && node.props.testID.startsWith('safeguard-reminder-'))).toHaveLength(0);
        act(() => renderer.unmount());
    });
});

describe('MessageView Human message alignment', () => {
    it.each([
        ['short Latin', 'Read the email'],
        ['multiline Latin', 'Read the email\nThen summarize it'],
        ['short CJK', '读一下邮件'],
        ['multiline CJK', '读一下邮件\n看看有没有新的活动'],
    ])('left-aligns %s inner text in a vertically centered right-aligned bubble', (_label, text) => {
        platform.os = 'web';
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(MessageView, {
                message: {
                    kind: 'user-text',
                    id: `user-${_label}`,
                    localId: null,
                    createdAt: 1,
                    text,
                },
                metadata: null,
                sessionId: 'session-user-message',
            }));
        });

        const markdown = renderer.root.findByType('MarkdownView' as any);
        expect(markdown.props).toMatchObject({
            markdown: text,
            externalCopyHandler: true,
            textAlign: 'left',
        });
        const copyTarget = renderer.root.findByType('LongPressCopyable' as any);
        expect(copyTarget.props.text).toBe(text);
        const rightAlignedBubble = renderer.root.findAllByType('View' as any).find((node: { props: { style?: unknown } }) => {
            const style = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
            return style.some((entry: any) => entry?.alignItems === 'flex-end');
        });
        expect(rightAlignedBubble).toBeDefined();
        const verticallyCenteredBubble = renderer.root.findAllByType('View' as any).find((node: { props: { style?: unknown } }) => {
            const style = Array.isArray(node.props.style) ? node.props.style : [node.props.style];
            return style.some((entry: any) => entry?.justifyContent === 'center');
        });
        expect(verticallyCenteredBubble).toBeDefined();
        act(() => renderer.unmount());
    });
});
