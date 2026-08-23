import * as React from 'react';
import type { Router } from 'expo-router';

import type { WorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';

export type WorkspaceLinkPressHandler = (route: WorkspaceLinkRoute) => void;

export const WorkspaceLinkPressContext = React.createContext<WorkspaceLinkPressHandler | undefined>(undefined);

export function useWorkspaceLinkPress(): WorkspaceLinkPressHandler | undefined {
    return React.useContext(WorkspaceLinkPressContext);
}

export function preventWorkspaceLinkDismissWhileSending(
    sending: boolean,
    event: { preventDefault: () => void },
): boolean {
    if (!sending) return false;
    event.preventDefault();
    return true;
}

export function dismissWorkspaceLinkToOrigin(
    router: Pick<Router, 'dismissTo'>,
    originSessionId: string,
    focusMessageId: string,
): void {
    router.dismissTo({
        pathname: '/session/[id]',
        params: {
            id: originSessionId,
            focusMessageId,
        },
    });
}
