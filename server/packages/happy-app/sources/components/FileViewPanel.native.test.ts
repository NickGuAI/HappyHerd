import * as React from 'react';
import { createHash } from 'node:crypto';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: {
            OS: 'ios',
            select: (values: Record<string, unknown>) => values.ios ?? values.default,
        },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        TextInput: host('TextInput'),
        View: host('View'),
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
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/components/markdown/MarkdownView', async () => {
    const ReactModule = await import('react');
    return { MarkdownView: (props: any) => ReactModule.createElement('MarkdownView', props) };
});
vi.mock('@/components/diff/PierreDiffView', async () => {
    const ReactModule = await import('react');
    return { PierreDiffView: (props: any) => ReactModule.createElement('PierreDiffView', props) };
});
vi.mock('@/components/FileDocumentPreview', async () => {
    const ReactModule = await import('react');
    return { FileDocumentPreview: (props: any) => ReactModule.createElement('FileDocumentPreview', props) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/sync/ops', () => ({ sessionReadFile: vi.fn(), sessionWriteFile: vi.fn() }));
vi.mock('@/sync/storage', () => ({ useSession: vi.fn() }));
vi.mock('@/sync/rig', () => ({ rigCanWriteFiles: vi.fn(() => true) }));
vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/components/layout', () => ({ layout: { maxWidth: 1200 } }));
vi.mock('react-native-unistyles', () => {
    const colors = new Proxy({
        groupped: { background: '#eee' },
        input: { background: '#ddd' },
    }, { get: (target, key) => Reflect.get(target, key) ?? '#000' });
    const theme = { colors, dark: false };
    return {
        StyleSheet: {
            create: (factory: any) => factory(theme),
            hairlineWidth: 1,
        },
        useUnistyles: () => ({ theme }),
    };
});

import { FileContentPanel, type FileContentPanelProps } from './FileViewPanel';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

async function renderPanel(overrides: Partial<FileContentPanelProps>) {
    let headerSlot: React.ReactNode = null;
    let renderer!: ReactTestRenderer;
    const props: FileContentPanelProps = {
        resourceKey: 'machine:one',
        filePath: '/workspace/.xxenv',
        readFile: vi.fn(),
        writeFile: vi.fn(),
        canWrite: true,
        onHeaderRightSlotChange: (slot) => { headerSlot = slot; },
        ...overrides,
    };

    await act(async () => {
        renderer = create(React.createElement(FileContentPanel, props));
        await Promise.resolve();
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
        await act(async () => {
            await vi.dynamicImportSettled();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        if (renderer.root.findAllByType('TextInput' as any).length > 0) break;
    }

    return {
        renderer,
        getHeaderSlot: () => headerSlot,
    };
}

describe('FileContentPanel native editing', () => {
    it.each(['notes.png', 'notes.pdf', 'settings.bmp', 'sentinel.gif', 'notes.svg'])(
        'routes valid UTF-8 named %s to the editor instead of a rich preview',
        async (fileName) => {
            const content = Buffer.from('plain text\n');
            const panel = await renderPanel({
                filePath: `/workspace/${fileName}`,
                readFile: vi.fn(async () => ({ success: true, content: content.toString('base64') })),
            });

            expect(panel.renderer.root.findByType('TextInput' as any).props.value).toBe('plain text\n');
            act(() => panel.renderer.unmount());
        },
    );

    it('loads the native editor and saves BOM-bearing bytes with the raw original hash', async () => {
        const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('TOKEN=before\n')]);
        const updated = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('TOKEN=after\n')]);
        const readFile = vi.fn(async () => ({ success: true, content: original.toString('base64') }));
        const writeFile = vi.fn(async () => ({ success: true }));
        const panel = await renderPanel({ readFile, writeFile });

        const input = panel.renderer.root.findByType('TextInput' as any);
        expect(input.props).toMatchObject({ editable: true, value: 'TOKEN=before\n' });

        act(() => input.props.onChangeText('TOKEN=after\n'));

        let header!: ReactTestRenderer;
        act(() => { header = create(panel.getHeaderSlot() as React.ReactElement); });
        const save = header.root.findByType('Pressable' as any);
        await act(async () => { await save.props.onPress(); });

        expect(writeFile).toHaveBeenCalledWith(
            '/workspace/.xxenv',
            updated.toString('base64'),
            createHash('sha256').update(original).digest('hex'),
        );

        act(() => {
            header.unmount();
            panel.renderer.unmount();
        });
    });

    it('loads the same editor in read-only mode without publishing a save action', async () => {
        const content = Buffer.from('{"mcpServers":{}}\n');
        const panel = await renderPanel({
            filePath: '/workspace/.mcp.json',
            canWrite: false,
            writeFile: undefined,
            readFile: vi.fn(async () => ({ success: true, content: content.toString('base64') })),
        });

        expect(panel.renderer.root.findByType('TextInput' as any).props).toMatchObject({
            editable: false,
            onChangeText: undefined,
        });

        let header!: ReactTestRenderer;
        act(() => { header = create(panel.getHeaderSlot() as React.ReactElement); });
        expect(header.root.findAllByType('Pressable' as any)).toHaveLength(0);

        act(() => {
            header.unmount();
            panel.renderer.unmount();
        });
    });

    it('re-runs rich-content classification when an external change is reloaded', async () => {
        let pollForExternalChange: (() => Promise<void>) | undefined;
        const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation((callback) => {
            pollForExternalChange = callback as () => Promise<void>;
            return 1 as unknown as ReturnType<typeof setInterval>;
        });
        const initialText = Buffer.from('plain text\n').toString('base64');
        const replacementPdf = Buffer.from('%PDF-1.7\n').toString('base64');
        const readFile = vi.fn()
            .mockResolvedValueOnce({ success: true, content: initialText })
            .mockResolvedValueOnce({ success: true, content: replacementPdf })
            .mockResolvedValueOnce({ success: true, content: replacementPdf });
        const panel = await renderPanel({ filePath: '/workspace/notes.pdf', readFile });

        await act(async () => { await pollForExternalChange?.(); });
        const reload = panel.renderer.root.findAllByType('Pressable' as any).find((button: any) => (
            button.findAllByType('Text' as any).some((label: any) => label.props.children === 'files.reload')
        ));
        expect(reload).toBeDefined();

        await act(async () => {
            reload!.props.onPress();
            await Promise.resolve();
        });

        expect(panel.renderer.root.findAllByType('TextInput' as any)).toHaveLength(0);
        expect(panel.renderer.root.findByType('FileDocumentPreview' as any).props.kind).toBe('pdf');
        expect(readFile).toHaveBeenCalledTimes(3);

        act(() => panel.renderer.unmount());
        interval.mockRestore();
    });
});
