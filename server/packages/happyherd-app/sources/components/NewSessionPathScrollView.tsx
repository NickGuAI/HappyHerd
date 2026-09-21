import React from 'react';
import {
    Platform,
    ScrollView,
    type ScrollViewProps,
} from 'react-native';

export function NewSessionPathScrollView({
    maxHeight,
    style,
    ...props
}: ScrollViewProps & { maxHeight: number }) {
    return (
        <ScrollView
            {...props}
            nestedScrollEnabled
            style={[scrollStyle, { maxHeight }, style]}
        />
    );
}

const scrollStyle = Platform.select({
    web: {
        overscrollBehaviorY: 'contain',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
    } as any,
    default: {},
});
