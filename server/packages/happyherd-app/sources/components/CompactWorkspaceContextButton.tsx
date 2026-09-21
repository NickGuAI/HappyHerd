import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { t } from '@/text';
import { BubblePressable } from './BubblePressable';

export const CompactWorkspaceContextButton = React.memo((props: {
    onPress?: () => void;
    active: boolean;
    color: string;
    activeColor: string;
    style?: StyleProp<ViewStyle>;
}) => {
    if (!props.onPress) return null;

    return (
        <BubblePressable
            onPress={props.onPress}
            hitSlop={6}
            style={props.style}
            accessibilityRole="button"
            accessibilityLabel={t('workspace.browseContext')}
        >
            <Ionicons
                name="folder-open-outline"
                size={20}
                color={props.active ? props.activeColor : props.color}
            />
        </BubblePressable>
    );
});
