import * as React from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { runOnJS } from 'react-native-worklets';

import { HERD_MOTION } from '@/components/herd/motion';

/**
 * Expand/collapse with a smooth height (UI overhaul). The body is measured at its
 * natural height and the clipping container animates to it, so rows below move
 * with the reveal instead of jumping. Closing animates to zero, then unmounts.
 * The system reduce-motion setting makes both changes immediate.
 */
export function HerdCollapse({
    open,
    children,
    style,
    testID,
}: {
    open: boolean;
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}) {
    const [mounted, setMounted] = React.useState(open);
    const [measured, setMeasured] = React.useState(0);
    const height = useSharedValue(0);

    React.useEffect(() => {
        if (open) setMounted(true);
    }, [open]);

    React.useEffect(() => {
        if (!mounted) return;
        const config = {
            duration: HERD_MOTION.base,
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            reduceMotion: ReduceMotion.System,
        };
        if (open) {
            height.value = withTiming(measured, config);
            return;
        }
        height.value = withTiming(0, config, (finished) => {
            if (finished) runOnJS(setMounted)(false);
        });
    }, [height, measured, mounted, open]);

    const animatedStyle = useAnimatedStyle(() => ({ height: height.value }));
    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        setMeasured(event.nativeEvent.layout.height);
    }, []);

    if (!mounted) return null;
    return (
        <Animated.View testID={testID} style={[{ overflow: 'hidden' }, animatedStyle]}>
            <View onLayout={onLayout} style={style}>
                {children}
            </View>
        </Animated.View>
    );
}
