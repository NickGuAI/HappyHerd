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
    it('keeps the same feedback composer mounted through a breakpoint crossing and late send failure', () => {
        const sendingStates: boolean[] = [];
        const reference = {
            mode: 'link' as const,
            originSessionId: 'origin-session',
            machineId: 'owner-machine',
            absolutePath: '/work/report.md',
        };
        const baseProps: Omit<WorkspaceLinkSidePanelProps, 'windowWidth'> = {
            reference,
            onBack: vi.fn(),
            onFeedbackSendingChange: (sending) => sendingStates.push(sending),
            onFeedbackSent: vi.fn(),
        };
        let renderer!: ReactTestRenderer;

        act(() => {
            renderer = create(React.createElement(WorkspaceLinkSidePanel, {
                ...baseProps,
                windowWidth: 1200,
            }));
        });
        const originalViewer = renderer.root.findByType('WorkspaceLinkViewer' as any);
        let finishFailure!: () => void;
        act(() => {
            finishFailure = originalViewer.props.beginFailingSend();
        });

        act(() => {
            renderer.update(React.createElement(WorkspaceLinkSidePanel, {
                ...baseProps,
                windowWidth: 320,
            }));
        });
        const resizedViewer = renderer.root.findByType('WorkspaceLinkViewer' as any);
        expect(renderer.root.findByType('View' as any).props.style.width).toBe(320);
        expect(mocks.mounts).toBe(1);
        expect(resizedViewer.props.draft).toBe('keep this feedback');
        expect(resizedViewer.props.error).toBeNull();

        act(() => finishFailure());
        const failedViewer = renderer.root.findByType('WorkspaceLinkViewer' as any);
        expect(mocks.mounts).toBe(1);
        expect(failedViewer.props.draft).toBe('keep this feedback');
        expect(failedViewer.props.error).toBe('delivery failed');
        expect(sendingStates).toEqual([true, false]);

        act(() => renderer.unmount());
    });
});
