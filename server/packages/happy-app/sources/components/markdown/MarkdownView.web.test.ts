import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    clipboard: vi.fn(),
    loadWorkspaceImage: vi.fn(),
    modalAlert: vi.fn(),
    modalShow: vi.fn(),
    openWorkspace: vi.fn(),
    resolveImage: vi.fn(),
}));

vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('expo-clipboard', () => ({ setStringAsync: mocks.clipboard }));
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            dark: false,
            colors: {
                text: '#000000',
                textSecondary: '#49454f',
                divider: '#eaeaea',
                surface: '#ffffff',
                surfaceHigh: '#f8f8f8',
                surfaceHighest: '#f0f0f0',
                syntaxKeyword: '#1d4ed8',
                syntaxString: '#059669',
                syntaxComment: '#6b7280',
                syntaxNumber: '#0891b2',
                syntaxFunction: '#9333ea',
                syntaxDefault: '#374151',
            },
        },
    }),
}));
vi.mock('@/-session/workspaceLinkNavigation', () => ({ useWorkspaceLinkPress: () => mocks.openWorkspace }));
vi.mock('./MermaidRenderer', async () => {
    const ReactModule = await import('react');
    return { MermaidRenderer: (props: any) => ReactModule.createElement('MermaidRenderer', props) };
});
vi.mock('@/sync/storage', () => ({ useSession: () => ({ metadata: { machineId: 'machine-one', path: '/repo' } }) }));
vi.mock('@/utils/markdownWorkspaceLink', () => ({
    resolveMarkdownWorkspaceImageReference: mocks.resolveImage,
    resolveMarkdownWorkspaceLinkRoute: vi.fn(),
}));
vi.mock('@/utils/markdownWorkspaceImage', () => ({ loadMarkdownWorkspaceImage: mocks.loadWorkspaceImage }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/modal', () => ({ Modal: { alert: mocks.modalAlert, show: mocks.modalShow } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { MarkdownView } from './MarkdownView.web';

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
        if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
    vi.clearAllMocks();
    mocks.clipboard.mockResolvedValue(undefined);
    mocks.resolveImage.mockReturnValue({ rootPath: '/repo', workspaceRoute: { pathname: '/workspace', params: {} } });
});

describe('MarkdownView web parity', () => {
    it('renders option tags as the original full-width chips without consuming ordinary lists', () => {
        const onOptionPress = vi.fn();
        const onLineComment = vi.fn();
        let renderer: any;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: [
                    '<options>',
                    '<option>把 Speaker 2 改成 Maria</option>',
                    '<option>保持 Speaker 2 不变</option>',
                    '</options>',
                    '',
                    '- ordinary one',
                    '- ordinary two',
                ].join('\n'),
                onOptionPress,
                onLineComment,
            }));
        });

        const optionBlock = renderer.root.findByProps({ className: 'hh-markdown-options' });
        expect(optionBlock.findAllByType('ul')).toHaveLength(0);
        expect(optionBlock.findAllByType('li')).toHaveLength(0);
        const chips = optionBlock.findAllByProps({ className: 'hh-markdown-option' });
        expect(chips.map((chip: any) => chip.children.join(''))).toEqual([
            '把 Speaker 2 改成 Maria',
            '保持 Speaker 2 不变',
        ]);
        act(() => chips[0].props.onClick());
        expect(onOptionPress).toHaveBeenCalledOnce();
        expect(onOptionPress).toHaveBeenCalledWith({ title: '把 Speaker 2 改成 Maria' });
        expect(renderer.root.findAllByType('ul')).toHaveLength(1);
        const ordinaryItems = renderer.root.findAllByType('li');
        expect(ordinaryItems).toHaveLength(2);
        expect(ordinaryItems.map((item: any) => item.props['data-source-line'])).toEqual([6, 7]);
        const gutter = ordinaryItems[0].findByProps({ className: 'hh-markdown-comment-gutter' });
        act(() => gutter.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
        expect(onLineComment).toHaveBeenCalledWith({ line: 6 });
        act(() => renderer.unmount());
    });

    it('preserves option text containing CommonMark destination and label delimiters', () => {
        const optionTitles = [
            'Keep Speaker 2 (recommended))',
            'Keep Speaker 2 trailing \\',
            String.raw`Keep \[Speaker 2\]`,
        ];
        const onOptionPress = vi.fn();
        let renderer: any;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: [
                    '<options>',
                    ...optionTitles.map((title) => `<option>${title}</option>`),
                    '</options>',
                ].join('\n'),
                onOptionPress,
            }));
        });

        const chips = renderer.root.findByProps({ className: 'hh-markdown-options' })
            .findAllByProps({ className: 'hh-markdown-option' });
        expect(chips.map((chip: any) => chip.children.join(''))).toEqual(optionTitles);
        act(() => chips.forEach((chip: any) => chip.props.onClick()));
        expect(onOptionPress.mock.calls.map(([option]) => option.title)).toEqual(optionTitles);
        act(() => renderer.unmount());
    });

    it('opens an HTTP image at full size and exposes failure with retry', () => {
        let renderer: any;
        act(() => { renderer = create(React.createElement(MarkdownView, { markdown: '![diagram](https://example.com/diagram.png)' })); });

        const open = renderer.root.find((node: any) => node.props['aria-label'] === 'markdown.openImageFullSize: diagram');
        act(() => open.props.onClick());
        expect(mocks.modalShow).toHaveBeenCalledWith(expect.objectContaining({ props: { url: 'https://example.com/diagram.png', alt: 'diagram' } }));

        act(() => renderer.root.findByType('img').props.onError());
        expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined();
        act(() => renderer.root.find((node: any) => node.type === 'button' && node.props.children === 'common.retry').props.onClick());
        expect(renderer.root.findByType('img').props.src).toBe('https://example.com/diagram.png');
        act(() => renderer.unmount());
    });

    it('retries a transient workspace image before rendering it', async () => {
        vi.useFakeTimers();
        mocks.loadWorkspaceImage.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('data:image/png;base64,ok');
        let renderer: any;
        try {
            await act(async () => {
                renderer = create(React.createElement(MarkdownView, {
                    markdown: '![chart](images/chart.png)',
                    sessionId: 'session-one',
                    enableWorkspaceLinks: true,
                }));
                await Promise.resolve();
            });
            await act(async () => { await vi.runAllTimersAsync(); });

            expect(mocks.loadWorkspaceImage).toHaveBeenCalledTimes(3);
            expect(renderer.root.findByType('img').props.src).toBe('data:image/png;base64,ok');
        } finally {
            act(() => renderer?.unmount());
            vi.useRealTimers();
        }
    });

    it('copies fenced code through the existing action', async () => {
        let renderer: any;
        act(() => { renderer = create(React.createElement(MarkdownView, { markdown: '```ts\nconst answer = 42;\n```' })); });
        const copy = renderer.root.find((node: any) => node.type === 'button' && node.props['aria-label'] === 'common.copy');
        await act(async () => {
            copy.props.onClick();
            await Promise.resolve();
        });

        expect(mocks.clipboard).toHaveBeenCalledWith('const answer = 42;\n');
        expect(mocks.modalAlert).toHaveBeenCalledWith('common.success', 'markdown.codeCopied', expect.any(Array));
        act(() => renderer.unmount());
    });

    it('anchors tight list-item comments to the exact source line', () => {
        const onLineComment = vi.fn();
        let renderer: any;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: '- first\n- second',
                onLineComment,
            }));
        });
        const items = renderer.root.findAllByType('li');
        expect(items.map((item: any) => item.props['data-source-line'])).toEqual([1, 2]);
        const gutter = items[1].find((node: any) => node.type === 'button' && node.props.className === 'hh-markdown-comment-gutter');
        act(() => gutter.props.onClick({ preventDefault: vi.fn(), stopPropagation: vi.fn() }));
        expect(onLineComment).toHaveBeenCalledWith({ line: 2 });
        act(() => renderer.unmount());
    });

    it('keeps table and thematic-break review controls in valid wrapper elements', () => {
        const onLineComment = vi.fn();
        let renderer: any;
        act(() => {
            renderer = create(React.createElement(MarkdownView, {
                markdown: '| A | B |\n| - | - |\n| 1 | 2 |\n\n---',
                onLineComment,
            }));
        });

        const table = renderer.root.findByType('table');
        expect(table.parent?.type).toBe('div');
        expect(table.parent?.props.className).toBe('hh-markdown-table-wrap');
        expect(table.parent?.parent?.props.className).toContain('hh-markdown-table-review');
        expect(renderer.root.findByType('hr').parent?.type).toBe('div');
        expect(renderer.root.findAllByType('tr').every((row: any) => row.findAllByType('button').length === 0)).toBe(true);
        act(() => renderer.unmount());
    });
});
