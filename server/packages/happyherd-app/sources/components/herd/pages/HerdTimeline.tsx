import * as React from 'react';
import { Text, View, type StyleProp, type TextStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { herdStaggerClass, herdWebClasses } from '@/components/herd/motion';

/**
 * One entry of a vertical timeline (UI overhaul, What's New): a hairline rail
 * with a molten marker, the entry title, and its content. The newest entry's
 * marker is filled and glows.
 */
export function HerdTimelineGroup({
    title,
    titleStyle,
    index = 0,
    children,
}: {
    title: string | React.ReactNode;
    titleStyle?: StyleProp<TextStyle>;
    index?: number;
    children: React.ReactNode;
}) {
    const newest = index === 0;
    return (
        <View style={styles.entry(index)}>
            <View style={[styles.marker, newest && styles.markerNewest]} />
            <View style={styles.header}>
                {typeof title === 'string'
                    ? <Text accessibilityRole="header" style={[styles.title, titleStyle]}>{title}</Text>
                    : title}
            </View>
            <View style={styles.body}>{children}</View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    // The only style in an entry's list that sets web classes (Unistyles merges `_web` key by key).
    entry: (index: number) => ({
        marginLeft: 6,
        paddingLeft: 22,
        paddingTop: 4,
        paddingBottom: 22,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.divider,
        _web: { _classNames: herdWebClasses('herd-rise-sm', herdStaggerClass(index)) },
    }),
    // The mock's hollow 10 px ring on the rail; the newest entry's is filled.
    marker: {
        position: 'absolute',
        left: -6,
        top: 8,
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: theme.colors.kilv.accent,
        backgroundColor: theme.colors.groupped.background,
    },
    markerNewest: {
        backgroundColor: theme.colors.kilv.accent,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    header: {
        marginBottom: 8,
    },
    title: {
        ...Typography.default('semiBold'),
        fontSize: 17,
        lineHeight: 24,
        color: theme.colors.text,
    },
    body: {
        gap: 4,
    },
}));
