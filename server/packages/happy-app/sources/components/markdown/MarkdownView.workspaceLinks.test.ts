import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

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
    resolveWorkspaceImage: vi.fn((): any => ({
        rootPath: '/workspace',
        workspaceRoute: {
            pathname: '/workspace' as const,
            params: {
                mode: 'link' as const,
                originSessionId: 'session-one',
                machineId: 'machine-one',
                absolutePath: '/workspace/images/chart.png',
            },
        },
    })),
    machineReadFileWithinRoot: vi.fn(),
    modalShow: vi.fn(),
    modalAlert: vi.fn(),
    clipboard: vi.fn(),
    openExternalUrl: vi.fn(),
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            OS: 'ios',
            select: (values: Record<string, unknown>) => values.ios ?? values.default,
        },
        ActivityIndicator: host('ActivityIndicator'),
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
        surfaceHigh: 'surface-high',
        surfaceHighest: 'surface-highest',
        divider: 'divider',
        text: 'text',
        textLink: 'text-link',
        textSecondary: 'text-secondary',
        textDestructive: 'text-destructive',
        success: 'success',
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
        default: () => ({ fontFamily: 'IBMPlexSans-Regular' }),
        mono: () => ({ fontFamily: 'IBMPlexMono-Regular' }),
    },
}));
vi.mock('../SimpleSyntaxHighlighter', async () => {
    const ReactModule = await import('react');
    return { SimpleSyntaxHighlighter: (props: any) => ReactModule.createElement('SimpleSyntaxHighlighter', props) };
});
vi.mock('@/modal', () => ({ Modal: { alert: mocks.modalAlert, show: mocks.modalShow } }));
vi.mock('@/sync/storage', () => ({
    useLocalSetting: () => false,
    useSession: () => ({ metadata: { machineId: 'machine-one', path: '/workspace' } }),
}));
vi.mock('@/sync/ops', () => ({ machineReadFileWithinRoot: mocks.machineReadFileWithinRoot }));
vi.mock('@/sync/persistence', () => ({ storeTempText: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('expo-clipboard', () => ({ setStringAsync: mocks.clipboard }));
vi.mock('./MermaidRenderer', async () => {
    const ReactModule = await import('react');
    return { MermaidRenderer: (props: any) => ReactModule.createElement('MermaidRenderer', props) };
});
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: mocks.openExternalUrl }));
vi.mock('@/utils/markdownWorkspaceLink', () => ({
    resolveMarkdownWorkspaceImageReference: mocks.resolveWorkspaceImage,
    resolveMarkdownWorkspaceLinkRoute: mocks.resolveWorkspaceLink,
}));
vi.mock('@/-session/workspaceLinkNavigation', () => ({ useWorkspaceLinkPress: () => null }));

import { MarkdownView } from './MarkdownView';

function findText(text: string) {
    return mocks.renderedText.find((props) => props.children === text);
}

beforeEach(() => {
    mocks.renderedText.length = 0;
    mocks.resolveWorkspaceImage.mockClear();
    mocks.resolveWorkspaceLink.mockClear();
    mocks.machineReadFileWithinRoot.mockReset();
    mocks.modalShow.mockClear();
    mocks.modalAlert.mockClear();
    mocks.clipboard.mockReset().mockResolvedValue(undefined);
    mocks.openExternalUrl.mockClear();
});

describe('MarkdownView workspace-link opt-in', () => {
    it('restores native option chips without list markers and sends the exact title once', () => {
        const onOptionPress = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: [
                    '<options>',
                    '<option>把 Speaker 2 改成 Maria</option>',
                    '<option>保持 Speaker 2 不变</option>',
                    '</options>',
                ].join('\n'),
                onOptionPress,
            }));
        });

        expect(findText('•')).toBeUndefined();
        const optionText = findText('把 Speaker 2 改成 Maria');
        expect(optionText?.style).toMatchObject({
            color: 'text',
            fontFamily: 'IBMPlexSans-Regular',
            fontSize: 16,
            lineHeight: 24,
        });
        const chip = renderer.root.findAllByType('button' as any).find((candidate: any) => (
            candidate.findAll((node: any) => node.type === 'span' && node.children.includes('把 Speaker 2 改成 Maria')).length > 0
        ));
        expect(chip).toBeDefined();
        const optionContainer = renderer.root.find((node: any) => (
            node.type === 'div'
            && node.props.style?.flexDirection === 'column'
            && node.props.style?.gap === 8
            && node.props.style?.marginVertical === 8
        ));
        expect(optionContainer.props.style).toMatchObject({
            flexDirection: 'column',
            gap: 8,
            marginVertical: 8,
        });
        expect(chip?.props.style({ pressed: false })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                backgroundColor: 'surface-highest',
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 8,
                overflow: 'hidden',
            }),
        ]));
        expect(chip?.props.style({ pressed: true })).toEqual(expect.arrayContaining([
            expect.objectContaining({ opacity: 0.7 }),
        ]));
        act(() => chip?.props.onPress());
        expect(onOptionPress).toHaveBeenCalledOnce();
        expect(onOptionPress).toHaveBeenCalledWith({ title: '把 Speaker 2 改成 Maria' });
        act(() => renderer.unmount());
    });

    it('keeps inline and block math visible on native', () => {
        renderToStaticMarkup(React.createElement(MarkdownView, {
            markdown: 'Inline $x + y$.\n\n$$\nz = 3\n$$',
        }));

        expect(findText('x + y')).toBeDefined();
        expect(findText('z = 3')).toBeDefined();
    });

    it('preserves ordered-list starts and nested list markers on native', () => {
        const html = renderToStaticMarkup(React.createElement(MarkdownView, {
            markdown: '5. Parent\n   - Child\n6. Next',
        }));

        expect(findText('5.')).toBeDefined();
        expect(findText('6.')).toBeDefined();
        expect(findText('•')).toBeDefined();
        expect(html).toContain('Child');
    });

    it('copies fenced code through the existing native action', async () => {
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: '```ts\nconst answer = 42;\n```',
            }));
        });
        const copy = renderer.root.find((node: any) => node.props.accessibilityLabel === 'common.copy');
        await act(async () => {
            copy.props.onPress();
            await Promise.resolve();
        });

        expect(mocks.clipboard).toHaveBeenCalledWith('const answer = 42;');
        expect(mocks.modalAlert).toHaveBeenCalledWith('common.success', 'markdown.codeCopied', expect.any(Array));
        act(() => renderer.unmount());
    });

    it('keeps local links inert by default while preserving external links', () => {
        renderToStaticMarkup(React.createElement(MarkdownView, {
            markdown: '[local](README.md) [web](https://example.com)',
            sessionId: 'session-one',
        }));

        expect(findText('local')?.accessibilityRole).toBeUndefined();
        expect(findText('web')?.accessibilityRole).toBe('link');
        expect(mocks.resolveWorkspaceLink).not.toHaveBeenCalled();
    });

    it('resolves a local link only when the Agent Chat renderer opts in', () => {
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

    it.each([
        ['[web](//example.com/docs)', 'https://example.com/docs'],
        ['[web](//example.com/docs "Docs")', 'https://example.com/docs'],
        ['[web](<//example.com/docs>)', 'https://example.com/docs'],
    ])('opens %s as an external HTTPS link instead of a machine path', (markdown, expectedUrl) => {
        renderToStaticMarkup(React.createElement(MarkdownView, {
            markdown,
            sessionId: 'session-one',
            enableWorkspaceLinks: true,
        }));

        const web = findText('web');
        expect(web?.accessibilityRole).toBe('link');
        web?.onPress();
        expect(mocks.openExternalUrl).toHaveBeenCalledWith(expectedUrl);
        expect(mocks.resolveWorkspaceLink).not.toHaveBeenCalled();
    });

    it('loads a rooted workspace image and opens its existing workspace route', async () => {
        const base64 = onePixelPng.toString('base64');
        const openWorkspace = vi.fn();
        mocks.machineReadFileWithinRoot.mockResolvedValue({ success: true, content: base64 });

        let renderer!: ReactTestRenderer;
        await act(async () => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: '![chart](images/chart.png)',
                sessionId: 'session-one',
                enableWorkspaceLinks: true,
                onWorkspaceLinkPress: openWorkspace,
            }));
            await Promise.resolve();
        });

        expect(mocks.resolveWorkspaceImage).toHaveBeenCalledWith({
            url: 'images/chart.png',
            label: 'chart',
            originSessionId: 'session-one',
            metadata: { machineId: 'machine-one', path: '/workspace' },
        });
        expect(mocks.machineReadFileWithinRoot).toHaveBeenCalledWith(
            'machine-one',
            '/workspace/images/chart.png',
            '/workspace',
        );
        const image = renderer.root.findByType('Image' as any);
        expect(image.props.source.uri).toBe(`data:image/png;base64,${base64}`);
        expect(image.props.accessibilityLabel).toBe('chart');
        act(() => image.props.onLoad({ source: { width: 1, height: 1 } }));
        expect(renderer.root.findByType('Image' as any).props.style).toEqual({
            width: '100%',
            aspectRatio: 1,
        });

        const openButton = renderer.root.find((node: any) => (
            node.props.accessibilityLabel === 'markdown.openImageFullSize: chart'
        ));
        act(() => openButton.props.onPress());
        expect(openWorkspace).toHaveBeenCalledWith(
            mocks.resolveWorkspaceImage.mock.results[0].value.workspaceRoute,
        );
        act(() => renderer.unmount());
    });

    it('renders an exact persisted inline-image override without reading the workspace', () => {
        const dataUri = `data:image/png;base64,${onePixelPng.toString('base64')}`;
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: '![chart](images/chart.png)',
                sessionId: 'session-one',
                enableWorkspaceLinks: true,
                inlineImages: {
                    sources: new Map([['images/chart.png', dataUri]]),
                    suppressed: new Set<string>(),
                },
            }));
        });

        expect(renderer.root.findByType('Image' as any).props.source.uri).toBe(dataUri);
        expect(mocks.resolveWorkspaceImage).not.toHaveBeenCalled();
        expect(mocks.machineReadFileWithinRoot).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('suppresses pseudo Markdown already represented by an encrypted attachment', () => {
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: '![chart](images/chart.png)',
                sessionId: 'session-one',
                enableWorkspaceLinks: true,
                inlineImages: {
                    sources: new Map(),
                    suppressed: new Set(['images/chart.png']),
                },
            }));
        });

        expect(renderer.root.findAllByType('Image' as any)).toHaveLength(0);
        expect(mocks.resolveWorkspaceImage).not.toHaveBeenCalled();
        expect(mocks.machineReadFileWithinRoot).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('retries a transient workspace-image read and renders without a page refresh', async () => {
        vi.useFakeTimers();
        const base64 = onePixelPng.toString('base64');
        mocks.machineReadFileWithinRoot
            .mockResolvedValueOnce({ success: false, error: 'File is still being written' })
            .mockResolvedValueOnce({ success: true, content: base64 });

        let renderer!: ReactTestRenderer;
        try {
            await act(async () => {
                renderer = create(React.createElement(MarkdownView, {
                    markdown: '![chart](images/chart.png)',
                    sessionId: 'session-one',
                    enableWorkspaceLinks: true,
                }));
                await Promise.resolve();
            });

            expect(mocks.machineReadFileWithinRoot).toHaveBeenCalledOnce();
            await act(async () => {
                await vi.runAllTimersAsync();
            });

            expect(mocks.machineReadFileWithinRoot).toHaveBeenCalledTimes(2);
            expect(renderer.root.findByType('Image' as any).props.source.uri).toBe(
                `data:image/png;base64,${base64}`,
            );
        } finally {
            act(() => renderer?.unmount());
            vi.useRealTimers();
        }
    });

    it('offers an inline retry after automatic workspace-image recovery is exhausted', async () => {
        vi.useFakeTimers();
        const base64 = onePixelPng.toString('base64');
        mocks.machineReadFileWithinRoot.mockResolvedValue({ success: false, error: 'Not ready' });

        let renderer!: ReactTestRenderer;
        try {
            await act(async () => {
                renderer = create(React.createElement(MarkdownView, {
                    markdown: '![chart](images/chart.png)',
                    sessionId: 'session-one',
                    enableWorkspaceLinks: true,
                }));
                await Promise.resolve();
            });
            await act(async () => {
                await vi.runAllTimersAsync();
            });

            const retry = renderer.root.find((node: any) => (
                node.props.accessibilityLabel === 'common.retry'
            ));
            mocks.machineReadFileWithinRoot.mockResolvedValue({ success: true, content: base64 });
            await act(async () => {
                retry.props.onPress();
                await Promise.resolve();
            });

            expect(renderer.root.findByType('Image' as any).props.source.uri).toBe(
                `data:image/png;base64,${base64}`,
            );
        } finally {
            act(() => renderer?.unmount());
            vi.useRealTimers();
        }
    });

    it('keeps an unresolved workspace image as inert Markdown without reading a machine', () => {
        mocks.resolveWorkspaceImage.mockReturnValueOnce(null);
        renderToStaticMarkup(React.createElement(MarkdownView, {
            markdown: '![chart](../outside.png)',
            sessionId: 'session-one',
            enableWorkspaceLinks: true,
        }));

        expect(findText('![chart](../outside.png)')).toBeDefined();
        expect(mocks.machineReadFileWithinRoot).not.toHaveBeenCalled();
    });

    it('keeps HTTP images on the existing modal path without a machine read', () => {
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: '![remote chart](https://example.com/chart.png)',
                sessionId: 'session-one',
                enableWorkspaceLinks: true,
            }));
        });

        expect(mocks.machineReadFileWithinRoot).not.toHaveBeenCalled();
        const openButton = renderer.root.find((node: any) => (
            node.props.accessibilityLabel === 'markdown.openImageFullSize: remote chart'
        ));
        act(() => openButton.props.onPress());
        expect(mocks.modalShow).toHaveBeenCalledWith(expect.objectContaining({
            props: {
                alt: 'remote chart',
                url: 'https://example.com/chart.png',
            },
        }));
        act(() => renderer.unmount());
    });
});
