import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    usePreventRemove: vi.fn(),
    navigationDispatch: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ dispatch: mocks.navigationDispatch }),
    usePreventRemove: mocks.usePreventRemove,
}));
vi.mock('@/modal', () => ({ Modal: { confirm: mocks.confirm } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import {
    dismissWorkspaceLinkToOrigin,
    openWorkspaceLinkFromSession,
    useWorkspaceLinkDismissGuard,
} from './workspaceLinkNavigation';

const workspaceRoute = {
    pathname: '/workspace' as const,
    params: {
        mode: 'link' as const,
        originSessionId: 'origin-session',
        machineId: 'owner-machine',
        absolutePath: '/work/report.md',
    },
};

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
    mocks.usePreventRemove.mockReset();
    mocks.navigationDispatch.mockReset();
    mocks.confirm.mockReset();
    mocks.confirm.mockResolvedValue(false);
});

function DismissGuardHarness() {
    const guard = useWorkspaceLinkDismissGuard();
    return React.createElement('DismissGuardHarness', guard);
}

describe('workspace link navigation', () => {
    it('opens the side-panel Viewer only through the existing unsaved-file guard', () => {
        const showSidePanel = vi.fn();
        const pushRoute = vi.fn();
        let confirmedAction: (() => void) | undefined;

        openWorkspaceLinkFromSession({
            route: workspaceRoute,
            sessionId: 'origin-session',
            feedbackSending: false,
            withFileDiscardConfirmation: (action) => {
                confirmedAction = action;
            },
            pushRoute,
            showSidePanel,
        });

        expect(showSidePanel).not.toHaveBeenCalled();
        expect(pushRoute).not.toHaveBeenCalled();
        confirmedAction?.();
        expect(showSidePanel).toHaveBeenCalledWith(workspaceRoute);
        expect(pushRoute).not.toHaveBeenCalled();
    });

    it('does not request file discard while strict Viewer feedback is pending', () => {
        const withFileDiscardConfirmation = vi.fn();

        openWorkspaceLinkFromSession({
            route: workspaceRoute,
            sessionId: 'origin-session',
            feedbackSending: true,
            withFileDiscardConfirmation,
            pushRoute: vi.fn(),
            showSidePanel: vi.fn(),
        });

        expect(withFileDiscardConfirmation).not.toHaveBeenCalled();
    });

    it('dismisses the Viewer to the existing origin session with the accepted message focused', () => {
        const dismissTo = vi.fn();

        dismissWorkspaceLinkToOrigin(
            { dismissTo },
            'origin-session',
            'feedback-local-id',
        );

        expect(dismissTo).toHaveBeenCalledWith({
            pathname: '/session/[id]',
            params: {
                id: 'origin-session',
                focusMessageId: 'feedback-local-id',
            },
        });
    });

    it('registers pending feedback with the native-stack prevent-remove context', () => {
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(DismissGuardHarness));
        });
        expect(mocks.usePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));

        act(() => {
            renderer.root.findByType('DismissGuardHarness' as any).props.onSendingChange(true);
        });
        expect(mocks.usePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
        expect(renderer.root.findByType('DismissGuardHarness' as any).props.sendingRef.current).toBe(true);

        act(() => {
            renderer.root.findByType('DismissGuardHarness' as any).props.reset();
        });
        expect(mocks.usePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
        expect(renderer.root.findByType('DismissGuardHarness' as any).props.sendingRef.current).toBe(false);

        act(() => renderer.unmount());
    });

    it('guards dirty mobile route dismissal until discard is confirmed', async () => {
        const dismiss = vi.fn();
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(DismissGuardHarness));
        });

        act(() => {
            renderer.root.findByType('DismissGuardHarness' as any).props.onDirtyChange(true);
        });
        expect(mocks.usePreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));

        await act(async () => {
            renderer.root.findByType('DismissGuardHarness' as any).props.guardDismiss(dismiss);
            await Promise.resolve();
        });
        expect(mocks.confirm).toHaveBeenCalledWith(
            'uiCopy.discardUnsavedChanges',
            'uiCopy.yourCurrentFileEditsHaveNotBeenSaved',
            { cancelText: 'common.cancel', confirmText: 'common.discard', destructive: true },
        );
        expect(dismiss).not.toHaveBeenCalled();

        mocks.confirm.mockResolvedValueOnce(true);
        await act(async () => {
            renderer.root.findByType('DismissGuardHarness' as any).props.guardDismiss(dismiss);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(dismiss).toHaveBeenCalledOnce();
        expect(renderer.root.findByType('DismissGuardHarness' as any).props.dirtyRef.current).toBe(false);
        expect(mocks.usePreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));

        act(() => renderer.unmount());
    });

    it('replays an intercepted native back action after dirty discard confirmation', async () => {
        mocks.confirm.mockResolvedValueOnce(true);
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(React.createElement(DismissGuardHarness));
        });
        act(() => {
            renderer.root.findByType('DismissGuardHarness' as any).props.onDirtyChange(true);
        });
        const preventRemoveHandler = mocks.usePreventRemove.mock.calls.at(-1)?.[1];

        await act(async () => {
            preventRemoveHandler({ data: { action: { type: 'GO_BACK' } } });
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(mocks.navigationDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
        act(() => renderer.unmount());
    });
});
