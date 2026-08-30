import * as React from 'react';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import type { Router } from 'expo-router';

import { Modal } from '@/modal';
import { t } from '@/text';
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
    const navigation = useNavigation();
    const sendingRef = React.useRef(false);
    const dirtyRef = React.useRef(false);
    const [preventRemove, setPreventRemove] = React.useState(false);
    const onSendingChange = React.useCallback((sending: boolean) => {
        sendingRef.current = sending;
        setPreventRemove(sending || dirtyRef.current);
    }, []);
    const onDirtyChange = React.useCallback((dirty: boolean) => {
        dirtyRef.current = dirty;
        setPreventRemove(dirty || sendingRef.current);
    }, []);
    const guardDismiss = React.useCallback((action: () => void) => {
        if (sendingRef.current) return;
        if (!dirtyRef.current) {
            action();
            return;
        }
        void Modal.confirm(
            t('uiCopy.discardUnsavedChanges'),
            t('uiCopy.yourCurrentFileEditsHaveNotBeenSaved'),
            { cancelText: t('common.cancel'), confirmText: t('common.discard'), destructive: true },
        ).then((confirmed) => {
            if (!confirmed) return;
            dirtyRef.current = false;
            setPreventRemove(sendingRef.current);
            // Let usePreventRemove commit false before dispatching a native
            // back action, matching the feedback-send dismissal lifecycle.
            setTimeout(action, 0);
        });
    }, []);
    const reset = React.useCallback(() => {
        sendingRef.current = false;
        dirtyRef.current = false;
        setPreventRemove(false);
    }, []);

    // Native-stack reads the PreventRemove context to set iOS
    // preventNativeDismiss. A raw beforeRemove listener cannot protect a
    // pending Viewer or dirty editor from an interactive native back-swipe.
    usePreventRemove(preventRemove, React.useCallback((event) => {
        guardDismiss(() => navigation.dispatch(event.data.action));
    }, [guardDismiss, navigation]));

    return { sendingRef, dirtyRef, onSendingChange, onDirtyChange, guardDismiss, reset };
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
