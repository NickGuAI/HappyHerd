import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Item, type ItemProps } from '@/components/Item';
import { ItemGroup, type ItemGroupProps } from '@/components/ItemGroup';
import { herdWebClasses } from '@/components/herd/motion';

/**
 * Drop-in replacements for the inherited grouped-list primitives (UI overhaul).
 * Pages import them in place of `ItemGroup` / `Item` with the same props, so an
 * upstream change to a page's list structure still merges without edits:
 *
 *   import { HerdItemGroup as ItemGroup } from '@/components/herd/pages/HerdList';
 *
 * The treatment: a tracked mono amber section label, a 12 px card, a soft
 * entrance, and row icons set in a small raised tile.
 */
export const HerdItemGroup = React.memo(function HerdItemGroup(props: ItemGroupProps) {
    return (
        <ItemGroup
            {...props}
            style={[styles.group, props.style]}
            titleStyle={[styles.title, props.titleStyle]}
            containerStyle={[styles.box, props.containerStyle]}
        />
    );
});

const ICON_SIZE = 17;

/** Scale an inherited 24–29 px row icon down to the tile size. */
function tileIcon(icon: React.ReactNode): React.ReactNode {
    if (!React.isValidElement<{ size?: unknown; style?: unknown }>(icon)) return icon;
    const { size, style } = icon.props;
    if (typeof size === 'number' && size > ICON_SIZE + 3) {
        return React.cloneElement(icon, { size: ICON_SIZE });
    }
    const width = style && typeof style === 'object' && !Array.isArray(style)
        ? (style as { width?: unknown }).width
        : undefined;
    if (typeof width === 'number' && width > ICON_SIZE + 3) {
        return React.cloneElement(icon, { style: [style, styles.tileImage] });
    }
    return icon;
}

export const HerdItem = React.memo(function HerdItem(props: ItemProps) {
    const icon = props.icon
        ? <View style={styles.tile}>{tileIcon(props.icon)}</View>
        : undefined;
    return <Item {...props} icon={icon} />;
});

const styles = StyleSheet.create((theme) => ({
    group: {
        _web: { _classNames: herdWebClasses('herd-rise-sm') },
    },
    title: {
        fontSize: 11.5,
        lineHeight: 16,
        letterSpacing: 2,
        color: theme.colors.textLink,
    },
    box: {
        borderRadius: theme.kilv.radiusCard,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    tile: {
        width: 30,
        height: 30,
        borderRadius: theme.kilv.radius,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
    },
    tileImage: {
        width: ICON_SIZE + 1,
        height: ICON_SIZE + 1,
    },
}));
