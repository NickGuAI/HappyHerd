import { describe, expect, it, vi } from 'vitest';

import { dismissWorkspaceLinkToOrigin } from './workspaceLinkNavigation';

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
});
