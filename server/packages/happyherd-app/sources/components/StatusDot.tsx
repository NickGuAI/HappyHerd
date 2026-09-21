import * as React from 'react';
import { type StyleProp, ViewStyle } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming } from 'react-native-reanimated';

export interface StatusDotProps {
    color: string;
    isPulsing?: boolean;
    size?: number;
    style?: ViewStyle;
}

export const StatusPulse = React.memo(({
    children,
    isPulsing,
    style,
}: {
    children?: React.ReactNode;
    isPulsing?: boolean;
    style?: StyleProp<ViewStyle>;
}) => {
    const opacity = useSharedValue(1);

    React.useEffect(() => {
        if (isPulsing) {
            opacity.value = withRepeat(
                withTiming(0.3, { duration: 1000 }),
                -1, // infinite
                true // reverse
            );
        } else {
            opacity.value = withTiming(1, { duration: 200 });
        }
    }, [isPulsing]);

    const animatedStyle = useAnimatedStyle(() => {
        return {
            opacity: opacity.value,
        };
    });

    return (
        <Animated.View style={[style, animatedStyle]}>
            {children}
        </Animated.View>
    );
});

export const StatusDot = React.memo(({ color, isPulsing, size = 6, style }: StatusDotProps) => {

    const baseStyle: ViewStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
    };

    return <StatusPulse isPulsing={isPulsing} style={[baseStyle, style]} />;
});
