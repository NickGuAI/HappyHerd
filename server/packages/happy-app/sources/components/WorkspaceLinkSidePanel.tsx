import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { WorkspaceLinkViewer, type WorkspaceLinkViewerProps } from './WorkspaceLinkViewer';
import { workspaceLinkViewerKey } from './WorkspaceLinkViewerModel';

export type WorkspaceLinkSidePanelProps = Pick<
    WorkspaceLinkViewerProps,
    'reference' | 'onBack' | 'onDirtyChange' | 'onFeedbackSendingChange' | 'onFeedbackSent'
>;

/**
 * The split host owns this panel's width. Keeping the Viewer inside this
 * fill-sized surface lets the host move between split and full-screen layouts
 * without remounting the Viewer or losing its composer state.
 */
export function WorkspaceLinkSidePanel({
    reference,
    onBack,
    onDirtyChange,
    onFeedbackSendingChange,
    onFeedbackSent,
}: WorkspaceLinkSidePanelProps) {
    const { theme } = useUnistyles();
    return (
        <View
            testID="workspace-link-side-panel"
            style={{
                flex: 1,
                minWidth: 0,
                alignSelf: 'stretch',
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderLeftColor: theme.colors.divider,
            }}
        >
            <WorkspaceLinkViewer
                key={workspaceLinkViewerKey(reference)}
                reference={reference}
                onBack={onBack}
                onDirtyChange={onDirtyChange}
                onFeedbackSendingChange={onFeedbackSendingChange}
                onFeedbackSent={onFeedbackSent}
            />
        </View>
    );
}
