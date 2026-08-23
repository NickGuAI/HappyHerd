import { describe, expect, it, vi } from 'vitest';

import {
    dismissWorkspaceLinkToOrigin,
    preventWorkspaceLinkDismissWhileSending,
} from './workspaceLinkNavigation';

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

    it('prevents gesture or hardware dismissal only while feedback is pending', () => {
        const preventDefault = vi.fn();

        expect(preventWorkspaceLinkDismissWhileSending(true, { preventDefault })).toBe(true);
        expect(preventDefault).toHaveBeenCalledOnce();

        preventDefault.mockClear();
        expect(preventWorkspaceLinkDismissWhileSending(false, { preventDefault })).toBe(false);
        expect(preventDefault).not.toHaveBeenCalled();
    });
});
