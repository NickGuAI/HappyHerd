import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    usePreventRemove: vi.fn(),
}));

vi.mock('@react-navigation/native', () => ({
    usePreventRemove: mocks.usePreventRemove,
}));

import {
    dismissWorkspaceLinkToOrigin,
    useWorkspaceLinkDismissGuard,
} from './workspaceLinkNavigation';

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
});

function DismissGuardHarness() {
    const guard = useWorkspaceLinkDismissGuard();
    return React.createElement('DismissGuardHarness', guard);
}

describe('workspace link navigation', () => {
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
});
