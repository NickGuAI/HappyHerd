import * as React from 'react';
import { Pressable, View } from 'react-native';
import { Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { panelHairline, panelHoverWash } from './panelColors';

/**
 * Header of a phone full-screen panel (UI overhaul, mock `.m-head`): a back
 * control on the left, a one-line title with an optional subtitle, and
 * trailing actions.
 */
export function HerdPanelScreenHeader(props: {
    backIcon: 'chevron-left' | 'chevron-down';
    backLabel: string;
    onBack: () => void;
    backTestID?: string;
    title: string;
    subtitle?: string | null;
    leading?: React.ReactNode;
    actions?: React.ReactNode;
    topInset?: number;
    testID?: string;
}) {
    const { theme } = useUnistyles();
    return (
        <View
            style={[styles.header, props.topInset ? { paddingTop: props.topInset, height: 56 + props.topInset } : null]}
            testID={props.testID}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={props.backLabel}
                onPress={props.onBack}
                hitSlop={8}
                testID={props.backTestID}
                style={({ hovered, pressed }: any) => [styles.back, (hovered || pressed) && styles.backHovered]}
            >
                <Octicons name={props.backIcon} size={22} color={theme.colors.text} />
            </Pressable>
            {props.leading ? <View style={styles.leading}>{props.leading}</View> : null}
            <View style={styles.titles}>
                <Text numberOfLines={1} style={styles.title}>{props.title}</Text>
                {props.subtitle ? (
                    <Text numberOfLines={1} style={styles.subtitle}>{props.subtitle}</Text>
                ) : null}
            </View>
            {props.actions ? <View style={styles.actions}>{props.actions}</View> : null}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    header: {
        height: 56,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 8,
        paddingRight: 8,
        borderBottomWidth: 1,
        borderBottomColor: panelHairline(theme),
        backgroundColor: theme.colors.surface,
    },
    back: {
        width: 40,
        height: 40,
        flexShrink: 0,
        borderRadius: theme.kilv.radius,
        alignItems: 'center',
        justifyContent: 'center',
        _web: {
            cursor: 'pointer',
            _classNames: herdWebClasses('herd-transition', 'herd-press'),
        },
    },
    backHovered: {
        backgroundColor: panelHoverWash(theme),
    },
    leading: {
        flexShrink: 0,
        marginLeft: 2,
    },
    titles: {
        flex: 1,
        minWidth: 0,
        gap: 1,
    },
    title: {
        fontSize: 16,
        lineHeight: 21,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.kilv.inkFaint,
        ...Typography.default(),
    },
    actions: {
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
}));
