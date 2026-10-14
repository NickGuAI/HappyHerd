import * as React from 'react';
import { Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

export type HerdTooltipAlign = 'center' | 'start' | 'end';

/** Pointer hints for iPad trackpads and iPad apps running on Mac. */
export function HerdTooltip({ label, hint, align = 'center', testID }: { label: string; hint?: string; align?: HerdTooltipAlign; testID?: string }) {
    const { theme } = useUnistyles();
    const [width, setWidth] = React.useState(0);
    return (
        <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={testID ?? 'herd-tooltip'}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
            style={{
                position: 'absolute', top: '100%', marginTop: 8,
                ...(align === 'start' ? { left: 0 } : align === 'end' ? { right: 0 } : { left: '50%', transform: [{ translateX: -width / 2 }] }),
                width: 220, zIndex: 90, paddingVertical: 5, paddingHorizontal: 9,
                borderRadius: 6, borderWidth: 1, borderColor: theme.colors.kilv.rimLine,
                backgroundColor: theme.colors.surface,
            }}
        >
            <Text style={{ color: theme.colors.text, fontSize: 12, lineHeight: 16, ...Typography.default() }}>
                {label}
                {hint ? <Text style={{ color: theme.colors.kilv.inkFaint, ...Typography.mono() }}>{`  ${hint}`}</Text> : null}
            </Text>
        </View>
    );
}
