import * as React from 'react';
import { Platform, Pressable, View, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Item, type ItemProps } from '@/components/Item';
import { ItemGroup, type ItemGroupProps } from '@/components/ItemGroup';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { layout } from '@/components/layout';
import { t } from '@/text';

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

/**
 * Holds a page header (`HerdPageHeader`) on the grouped cards' left edge and
 * width, so an entity page's title row lines up with the lists below it.
 */
export function HerdListHeader({ children, testID }: { children: React.ReactNode; testID?: string }) {
    return (
        <View testID={testID} style={styles.listHeaderWrapper}>
            <View style={styles.listHeader}>{children}</View>
        </View>
    );
}

export type HerdValueItemProps = {
    title: string;
    /** The value, drawn on the row's right edge (`.iv` in the mock). */
    value?: string | null;
    /** Mono value: ids, paths, versions, ports. */
    mono?: boolean;
    /** Before the value, such as a status dot. */
    prefix?: React.ReactNode;
    /** After the value, or in its place, such as a check icon. */
    trailing?: React.ReactNode;
    icon?: React.ReactNode;
    /** Copies this text on press, and the copy icon turns into a check. */
    copyText?: string | null;
    /**
     * Replaces the built-in clipboard write, for pages that report their own
     * success or failure. Return false when nothing was copied.
     */
    onCopy?: () => Promise<boolean | void> | boolean | void;
    onPress?: () => void;
    valueLines?: number;
    valueStyle?: StyleProp<TextStyle>;
    /** Destructive rows draw their label in the destructive tone. */
    destructive?: boolean;
    /** Injected by `ItemGroup` for every row but the last. */
    showDivider?: boolean;
    testID?: string;
};

/**
 * One grouped-list row with its label on the left and its value on the right
 * edge of the same line (UI overhaul, the mock's `.kv-list` rows). A long value
 * shrinks and ellipsizes instead of pushing the label out. Copyable rows show a
 * copy icon that confirms with a check.
 */
export function HerdValueItem({
    title,
    value,
    mono = false,
    prefix,
    trailing,
    icon,
    copyText,
    onCopy,
    onPress,
    valueLines = 1,
    valueStyle,
    destructive = false,
    showDivider = true,
    testID,
}: HerdValueItemProps) {
    const { theme } = useUnistyles();
    const [copied, setCopied] = React.useState(false);
    const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => () => {
        if (resetTimer.current) clearTimeout(resetTimer.current);
    }, []);
    const copyable = Boolean(onCopy || copyText);
    const copy = React.useCallback(async () => {
        let done = true;
        if (onCopy) {
            done = (await onCopy()) !== false;
        } else if (copyText) {
            await Clipboard.setStringAsync(copyText);
        }
        if (!done) return;
        setCopied(true);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(false), 1300);
    }, [copyText, onCopy]);
    const handlePress = copyable ? () => { void copy(); } : onPress;
    const content = (
        <>
            <View style={styles.valueRow}>
                {icon ? <View style={[styles.tile, styles.valueIcon]}>{tileIcon(icon)}</View> : null}
                <Text testID={testID ? `${testID}-title` : undefined} numberOfLines={1} style={[styles.valueTitle, destructive && styles.valueTitleDestructive]}>{title}</Text>
                <View style={styles.valueSide}>
                    {prefix}
                    {value ? (
                        <Text
                            testID={testID ? `${testID}-value` : undefined}
                            numberOfLines={valueLines}
                            ellipsizeMode={mono ? 'middle' : 'tail'}
                            style={[styles.valueText, mono && styles.valueTextMono, valueStyle]}
                        >
                            {value}
                        </Text>
                    ) : null}
                    {trailing}
                    {copyable ? (
                        <Ionicons
                            testID={testID ? `${testID}-copy-icon` : undefined}
                            name={copied ? 'checkmark' : 'copy-outline'}
                            size={14}
                            color={copied ? theme.colors.success : theme.colors.textSecondary}
                        />
                    ) : null}
                </View>
            </View>
            {showDivider ? <View style={styles.valueDivider} /> : null}
        </>
    );
    if (!handlePress) {
        return <View testID={testID}>{content}</View>;
    }
    return (
        <Pressable
            testID={testID}
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={copyable ? `${title}: ${t('common.copy')}` : title}
            style={({ pressed }) => [styles.valuePressable, pressed && styles.valuePressed]}
        >
            {content}
        </Pressable>
    );
}

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
    listHeaderWrapper: {
        alignItems: 'center',
    },
    listHeader: {
        width: '100%',
        maxWidth: layout.maxWidth,
        paddingHorizontal: 16,
        paddingTop: Platform.select({ ios: 16, default: 22 }),
    },
    valuePressable: {
        _web: { cursor: 'pointer' },
    },
    valuePressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    valueRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: Platform.select({ ios: 12, default: 14 }),
        minHeight: Platform.select({ ios: 44, default: 52 }),
    },
    valueIcon: {
        flexShrink: 0,
    },
    valueTitle: {
        ...Typography.default('regular'),
        flexShrink: 0,
        maxWidth: '55%',
        fontSize: Platform.select({ ios: 17, default: 15 }),
        lineHeight: 22,
        color: theme.colors.text,
    },
    valueTitleDestructive: {
        color: theme.colors.textDestructive,
    },
    valueSide: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 7,
    },
    valueText: {
        ...Typography.default('regular'),
        flexShrink: 1,
        minWidth: 0,
        textAlign: 'right',
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    valueTextMono: {
        ...Typography.mono(),
        fontSize: 13,
    },
    valueDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.divider,
    },
}));
