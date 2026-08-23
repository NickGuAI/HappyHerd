import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    renderedText: [] as any[],
    resolveWorkspaceLink: vi.fn(() => ({
        pathname: '/workspace' as const,
        params: {
            mode: 'link' as const,
            originSessionId: 'session-one',
            machineId: 'machine-one',
            absolutePath: '/workspace/README.md',
        },
    })),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, null, props.children);
    return {
        Platform: {
            OS: 'ios',
            select: (values: Record<string, unknown>) => values.ios ?? values.default,
        },
        Pressable: host('button'),
        ScrollView: host('div'),
        View: host('div'),
        useWindowDimensions: () => ({ width: 1200, height: 800 }),
    };
});
vi.mock('expo-image', async () => {
    const ReactModule = await import('react');
    return { Image: (props: any) => ReactModule.createElement('Image', props) };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('../HorizontalScrollView', async () => {
    const ReactModule = await import('react');
    return { HorizontalScrollView: (props: any) => ReactModule.createElement('HorizontalScrollView', props, props.children) };
});
vi.mock('react-native-gesture-handler', () => ({
    Gesture: {
        LongPress: () => {
            const chain = {
                minDuration: () => chain,
                onStart: () => chain,
                runOnJS: () => chain,
            };
            return chain;
        },
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-native-unistyles', () => {
    const colors = new Proxy({
        groupped: { background: '#eee' },
        surface: '#fff',
    }, { get: (target, key) => Reflect.get(target, key) ?? '#000' });
    return {
        StyleSheet: {
            create: (factory: any) => factory({ colors, dark: false }),
            hairlineWidth: 1,
        },
    };
});
vi.mock('../StyledText', async () => {
    const ReactModule = await import('react');
    return {
        Text: (props: any) => {
            mocks.renderedText.push(props);
            return ReactModule.createElement('span', null, props.children);
        },
    };
});
vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
        mono: () => ({}),
    },
}));
vi.mock('../SimpleSyntaxHighlighter', async () => {
    const ReactModule = await import('react');
    return { SimpleSyntaxHighlighter: (props: any) => ReactModule.createElement('SimpleSyntaxHighlighter', props) };
});
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn(), show: vi.fn() } }));
vi.mock('@/sync/storage', () => ({
    useLocalSetting: () => false,
    useSession: () => ({ metadata: { machineId: 'machine-one', path: '/workspace' } }),
}));
vi.mock('@/sync/persistence', () => ({ storeTempText: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('./MermaidRenderer', async () => {
    const ReactModule = await import('react');
    return { MermaidRenderer: (props: any) => ReactModule.createElement('MermaidRenderer', props) };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/utils/markdownWorkspaceLink', () => ({
    resolveMarkdownWorkspaceLinkRoute: mocks.resolveWorkspaceLink,
}));
vi.mock('@/-session/workspaceLinkNavigation', () => ({ useWorkspaceLinkPress: () => null }));

import { MarkdownView } from './MarkdownView';

function findText(text: string) {
    return mocks.renderedText.find((props) => props.children === text);
}

describe('MarkdownView workspace-link opt-in', () => {
    it('keeps local links inert by default while preserving external links', () => {
        mocks.renderedText.length = 0;
        renderToStaticMarkup(React.createElement(MarkdownView, {
            markdown: '[local](README.md) [web](https://example.com)',
            sessionId: 'session-one',
        }));

        expect(findText('local')?.accessibilityRole).toBeUndefined();
        expect(findText('web')?.accessibilityRole).toBe('link');
        expect(mocks.resolveWorkspaceLink).not.toHaveBeenCalled();
    });

    it('resolves a local link only when the Agent Chat renderer opts in', () => {
        mocks.renderedText.length = 0;
        mocks.resolveWorkspaceLink.mockClear();
        renderToStaticMarkup(React.createElement(MarkdownView, {
            markdown: '[local](README.md)',
            sessionId: 'session-one',
            enableWorkspaceLinks: true,
        }));

        expect(findText('local')?.accessibilityRole).toBe('link');
        expect(mocks.resolveWorkspaceLink).toHaveBeenCalledWith({
            url: 'README.md',
            label: 'local',
            originSessionId: 'session-one',
            metadata: { machineId: 'machine-one', path: '/workspace' },
        });
    });
});
