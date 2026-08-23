import * as React from 'react';
import { usePreventRemove } from '@react-navigation/native';
import type { Router } from 'expo-router';

import type { WorkspaceLinkRoute } from '@/utils/markdownWorkspaceLink';

export type WorkspaceLinkPressHandler = (route: WorkspaceLinkRoute) => void;

export const WorkspaceLinkPressContext = React.createContext<WorkspaceLinkPressHandler | undefined>(undefined);

export function useWorkspaceLinkPress(): WorkspaceLinkPressHandler | undefined {
    return React.useContext(WorkspaceLinkPressContext);
}

export function openWorkspaceLinkFromSession(input: Readonly<{
    route: WorkspaceLinkRoute;
    sessionId: string;
    feedbackSending: boolean;
    withFileDiscardConfirmation: (action: () => void) => void;
    pushRoute: (route: WorkspaceLinkRoute) => void;
    showSidePanel: (route: WorkspaceLinkRoute) => void;
}>): void {
    if (input.feedbackSending) return;
    input.withFileDiscardConfirmation(() => {
        if (input.route.params.originSessionId !== input.sessionId) {
            input.pushRoute(input.route);
            return;
        }
        input.showSidePanel(input.route);
    });
}

export function useWorkspaceLinkDismissGuard() {
    const sendingRef = React.useRef(false);
    const [preventRemove, setPreventRemove] = React.useState(false);
    const onSendingChange = React.useCallback((sending: boolean) => {
        sendingRef.current = sending;
        setPreventRemove(sending);
    }, []);
    const reset = React.useCallback(() => onSendingChange(false), [onSendingChange]);

    // Native-stack reads the PreventRemove context to set iOS
    // preventNativeDismiss. A raw beforeRemove listener cannot protect a
    // pending Viewer from an interactive native back-swipe.
    usePreventRemove(preventRemove, React.useCallback(() => undefined, []));

    return { sendingRef, onSendingChange, reset };
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
