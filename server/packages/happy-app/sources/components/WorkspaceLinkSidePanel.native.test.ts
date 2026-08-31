import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    mounts: 0,
}));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return {
        View: (props: any) => ReactModule.createElement('View', props, props.children),
    };
});
vi.mock('react-native-unistyles', () => ({
    StyleSheet: { hairlineWidth: 1 },
    useUnistyles: () => ({ theme: { colors: { divider: '#ddd' } } }),
}));
vi.mock('./WorkspaceLinkViewer', async () => {
    const ReactModule = await import('react');
    return {
        WorkspaceLinkViewer: (props: any) => {
            const [draft] = ReactModule.useState('keep this feedback');
            const [error, setError] = ReactModule.useState<string | null>(null);
            ReactModule.useState(() => {
                mocks.mounts += 1;
                return null;
            });
            return ReactModule.createElement('WorkspaceLinkViewer', {
                ...props,
                draft,
                error,
                beginFailingSend: () => {
                    props.onFeedbackSendingChange?.(true);
                    return () => {
                        setError('delivery failed');
                        props.onFeedbackSendingChange?.(false);
                    };
                },
            });
        },
    };
});

import { WorkspaceLinkSidePanel, type WorkspaceLinkSidePanelProps } from './WorkspaceLinkSidePanel';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
    mocks.mounts = 0;
});

describe('WorkspaceLinkSidePanel', () => {
    it('fills its split host and keeps the same feedback composer mounted through host rerenders', () => {
        const sendingStates: boolean[] = [];
        const dirtyStates: boolean[] = [];
        const reference = {
            mode: 'link' as const,
            originSessionId: 'origin-session',
            machineId: 'owner-machine',
            absolutePath: '/work/report.md',
        };
        const baseProps: WorkspaceLinkSidePanelProps = {
            reference,
            onBack: vi.fn(),
            onDirtyChange: (dirty) => dirtyStates.push(dirty),
            onFeedbackSendingChange: (sending) => sendingStates.push(sending),
            onFeedbackSent: vi.fn(),
        };
        let renderer!: ReactTestRenderer;

        act(() => {
            renderer = create(React.createElement(WorkspaceLinkSidePanel, baseProps));
        });
        const originalViewer = renderer.root.findByType('WorkspaceLinkViewer' as any);
        act(() => originalViewer.props.onDirtyChange(true));
        let finishFailure!: () => void;
        act(() => {
            finishFailure = originalViewer.props.beginFailingSend();
        });

        act(() => {
            renderer.update(React.createElement(WorkspaceLinkSidePanel, baseProps));
        });
        const resizedViewer = renderer.root.findByType('WorkspaceLinkViewer' as any);
        expect(renderer.root.findByType('View' as any).props.style).toMatchObject({
            flex: 1,
            minWidth: 0,
            alignSelf: 'stretch',
        });
        expect(mocks.mounts).toBe(1);
        expect(resizedViewer.props.draft).toBe('keep this feedback');
        expect(resizedViewer.props.error).toBeNull();

        act(() => finishFailure());
        const failedViewer = renderer.root.findByType('WorkspaceLinkViewer' as any);
        expect(mocks.mounts).toBe(1);
        expect(failedViewer.props.draft).toBe('keep this feedback');
        expect(failedViewer.props.error).toBe('delivery failed');
        expect(sendingStates).toEqual([true, false]);
        expect(dirtyStates).toEqual([true]);

        act(() => renderer.unmount());
    });
});
