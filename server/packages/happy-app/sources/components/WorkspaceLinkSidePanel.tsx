import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { WorkspaceLinkViewer, type WorkspaceLinkViewerProps } from './WorkspaceLinkViewer';
import { workspaceLinkViewerKey } from './WorkspaceLinkViewerModel';

export type WorkspaceLinkSidePanelProps = Pick<
    WorkspaceLinkViewerProps,
    'reference' | 'onBack' | 'onFeedbackSendingChange' | 'onFeedbackSent'
> & {
    windowWidth: number;
};

/**
 * The open Viewer stays in this one mounted branch while the window crosses
 * the desktop/mobile breakpoint. Its width may change, but its composer state
 * and an in-flight send continue to belong to the same Viewer instance.
 */
export function WorkspaceLinkSidePanel({
    reference,
    windowWidth,
    onBack,
    onFeedbackSendingChange,
    onFeedbackSent,
}: WorkspaceLinkSidePanelProps) {
    const { theme } = useUnistyles();
    const preferredWidth = Math.min(Math.max(Math.floor(windowWidth * 0.42), 360), 620);
    return (
        <View
            style={{
                width: Math.min(Math.max(windowWidth, 0), preferredWidth),
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
                onFeedbackSendingChange={onFeedbackSendingChange}
                onFeedbackSent={onFeedbackSent}
            />
        </View>
    );
}
