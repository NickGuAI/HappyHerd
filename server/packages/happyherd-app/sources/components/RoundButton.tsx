import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export type RoundButtonSize = 'large' | 'normal' | 'small';
const sizes: { [key in RoundButtonSize]: { height: number, fontSize: number, hitSlop: number, pad: number } } = {
    large: { height: 48, fontSize: 17, hitSlop: 0, pad: Platform.OS == 'ios' ? 0 : -1 },
    normal: { height: 40, fontSize: 16, hitSlop: 4, pad: Platform.OS == 'ios' ? 1 : -2 },
    small: { height: 32, fontSize: 14, hitSlop: 8, pad: Platform.OS == 'ios' ? -1 : -1 }
}

export type RoundButtonDisplay = 'default' | 'inverted';

const stylesheet = StyleSheet.create(() => ({
    loadingContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    contentContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 64,
        paddingHorizontal: 16,
        borderRadius: 4,
    },
    text: {
        ...Typography.default('semiBold'),
        fontWeight: '600',
        includeFontPadding: false,
        textAlign: 'center',
        maxWidth: '100%',
    },
}));

export const RoundButton = React.memo((props: { size?: RoundButtonSize, display?: RoundButtonDisplay, title?: any, numberOfLines?: number, style?: StyleProp<ViewStyle>, textStyle?: StyleProp<TextStyle>, disabled?: boolean, loading?: boolean, onPress?: () => void, action?: () => Promise<any> }) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const [loading, setLoading] = React.useState(false);
    const [hovered, setHovered] = React.useState(false);
    const doLoading = props.loading !== undefined ? props.loading : loading;
    const doAction = React.useCallback(() => {
        if (props.onPress) {
            props.onPress();
            return;
        }
        if (props.action) {
            setLoading(true);
            (async () => {
                try {
                    await props.action!();
                } finally {
                    setLoading(false);
                }
            })();
        }
    }, [props.onPress, props.action]);
    const displays: { [key in RoundButtonDisplay]: {
        textColor: string,
        backgroundColor: string,
        borderColor: string,
    } } = {
        default: {
            backgroundColor: theme.colors.button.primary.background,
            borderColor: theme.colors.button.primary.background,
            textColor: theme.colors.button.primary.tint
        },
        inverted: {
            backgroundColor: 'transparent',
            borderColor: theme.colors.kilv.rimLine,
            textColor: theme.colors.text,
        }
    }

    const size = sizes[props.size || 'large'];
    const display = displays[props.display || 'default'];
    const content = (
        <View
            style={[
                styles.contentContainer,
                { minHeight: size.height - 2, paddingVertical: (props.numberOfLines ?? 1) > 1 ? 6 : 0 },
            ]}
        >
            {doLoading && (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator color={display.textColor} size='small' />
                </View>
            )}
            <Text
                style={[
                    styles.text,
                    {
                        marginTop: size.pad,
                        opacity: doLoading ? 0 : 1,
                        color: display.textColor,
                        fontSize: size.fontSize,
                    },
                    props.textStyle,
                ]}
                numberOfLines={props.numberOfLines ?? 1}
            >
                {props.title}
            </Text>
        </View>
    );

    return (
        <Pressable
            disabled={doLoading || props.disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: doLoading || !!props.disabled, busy: doLoading }}
            hitSlop={size.hitSlop}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            style={(p) => ([
                {
                    borderWidth: 1,
                    borderRadius: 4,
                    backgroundColor: (p.pressed || hovered) && !props.disabled && !doLoading
                        ? props.display === 'inverted' ? theme.colors.surfacePressed : theme.colors.kilv.accentHot
                        : display.backgroundColor,
                    borderColor: hovered && !props.disabled && !doLoading ? theme.colors.kilv.accent : display.borderColor,
                    opacity: props.disabled ? 0.45 : p.pressed ? 0.92 : 1,
                    overflow: Platform.OS === 'web' ? 'hidden' : 'visible',
                },
                props.style])}
            onPress={doAction}
        >
            {content}
        </Pressable>
    )
});
