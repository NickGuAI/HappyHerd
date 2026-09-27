import { Text } from '@/components/StyledText';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { AgentWorkGroupItem, formatWorkDuration } from '@/hooks/useGroupedMessages';
import { Typography } from '@/constants/Typography';
import { layout } from './layout';
import { t } from '@/text';
import { herdWebClasses } from './herd/motion';

/**
 * The one-line toggle for a completed turn's intermediate work. It is only a
 * toggle: the group's messages are separate list items inserted next to it
 * while expanded, so tapping it changes the list data and the content unfolds
 * — this row itself never grows.
 *
 * An expanded group renders two of these, one at each end of its content. The
 * reason is geometric, and load-bearing enough that changing the height of
 * this row will break it: the chat list is inverted, so its fixed point is the
 * bottom-most visible row. Content inserted into a group therefore grows
 * upward, carrying the tapped header off the top of the screen. The trailing
 * copy takes the header's place at the bottom edge of the expansion — the same
 * pixels the reader just tapped, because both rows are this same component and
 * so exactly as tall. Collapsing from it returns the viewport to where it
 * started.
 *
 * UI overhaul: the chevron leads and rotates as the group opens (web eases
 * it); the summary carries the member count.
 */
export const AgentWorkGroupHeader = React.memo((props: {
    group: AgentWorkGroupItem;
    expanded: boolean;
    onToggle: () => void;
    /**
     * 'leading' is the summary above the group. 'trailing' is the collapse
     * control below it, rendered only while expanded.
     */
    placement?: 'leading' | 'trailing';
    /** Rise in on mount (web). Captured once so later renders cannot cut it short. */
    entrance?: boolean;
    onEntranceShown?: (id: string) => void;
}) => {
    const { theme } = useUnistyles();
    const durationMs = (props.group.completedAt ?? props.group.startedAt) - props.group.startedAt;
    const trailing = props.placement === 'trailing';
    const label = trailing
        ? t('toolGroup.hide')
        : t('toolGroup.workedFor', { duration: formatWorkDuration(durationMs) });
    const [entrance] = React.useState(() => Platform.OS === 'web' && props.entrance === true);
    const [hovered, setHovered] = React.useState(false);
    const groupId = props.group.id;
    const onEntranceShown = props.onEntranceShown;
    React.useEffect(() => {
        if (entrance) onEntranceShown?.(groupId);
    }, [entrance, groupId, onEntranceShown]);
    // The trailing row only ever collapses, so its chevron points back up.
    const rotation = trailing ? '-90deg' : props.expanded ? '90deg' : '0deg';

    return (
        <View style={[styles.outerContainer, entrance && styles.entrance]}>
            <View style={styles.innerContainer}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ expanded: props.expanded }}
                    aria-expanded={props.expanded}
                    onPress={props.onToggle}
                    onHoverIn={() => setHovered(true)}
                    onHoverOut={() => setHovered(false)}
                    style={({ pressed }: any) => [
                        styles.header,
                        (hovered || pressed) && styles.headerHovered,
                        pressed && styles.headerPressed,
                    ]}
                >
                    <View style={[styles.chevron, { transform: [{ rotate: rotation }] }]}>
                        <Ionicons
                            name="chevron-forward"
                            size={13}
                            color={hovered ? theme.colors.text : theme.colors.textSecondary}
                        />
                    </View>
                    <Text style={[styles.summaryText, hovered && styles.summaryTextHovered]} numberOfLines={1}>
                        {label}
                    </Text>
                    {!trailing && props.group.messages.length > 0 ? (
                        <Text style={styles.countText} numberOfLines={1}>
                            {`· ${props.group.messages.length}`}
                        </Text>
                    ) : null}
                </Pressable>
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    outerContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
    entrance: {
        _web: {
            _classNames: herdWebClasses('herd-rise-sm'),
        },
    },
    innerContainer: {
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 0,
        maxWidth: layout.maxWidth,
        marginVertical: 8,
        alignItems: 'flex-start',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        maxWidth: '100%',
        marginHorizontal: 8,
        minHeight: 28,
        paddingVertical: 4,
        paddingLeft: 8,
        paddingRight: 10,
        borderRadius: theme.borderRadius.md,
        _web: {
            cursor: 'pointer',
            transition: `background-color ${theme.kilv.motionFast}ms ${theme.kilv.easeOut}`,
        },
    },
    headerHovered: {
        backgroundColor: theme.colors.glass.backgroundSubtle,
    },
    headerPressed: {
        opacity: 0.8,
    },
    chevron: {
        width: 14,
        alignItems: 'center',
        justifyContent: 'center',
        _web: {
            transition: `transform ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}`,
        },
    },
    summaryText: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    summaryTextHovered: {
        color: theme.colors.text,
    },
    countText: {
        flexShrink: 0,
        fontSize: 12,
        lineHeight: 20,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
}));
