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

        expect(renderer.root.findByType('table').parent?.type).toBe('div');
        expect(renderer.root.findByType('hr').parent?.type).toBe('div');
        expect(renderer.root.findAllByType('tr').every((row: any) => row.findAllByType('button').length === 0)).toBe(true);
        act(() => renderer.unmount());
    });
});
