import * as React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { compactCount } from '@/utils/rigGitLineChanges';
import { formatToolSeconds, type ToolLineStats } from './toolLineModel';

export type ToolLineState = 'running' | 'completed' | 'error' | 'interrupted' | 'denied' | 'pending';

/** Live elapsed milliseconds, refreshed ten times a second while mounted. */
function useLiveElapsedMs(from: number): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(interval);
    }, []);
    return Math.max(0, now - from);
}

function LiveTime(props: { from: number }) {
    const elapsed = useLiveElapsedMs(props.from);
    return <Text style={styles.time}>{formatToolSeconds(elapsed)}</Text>;
}

/** Spinner while running, then a check that pops in when the call finishes. */
export function ToolLineStateIcon(props: { state: ToolLineState }) {
    const { theme } = useUnistyles();
    const wasRunning = React.useRef(props.state === 'running');
    const [popCheck, setPopCheck] = React.useState(false);
    React.useEffect(() => {
        if (props.state === 'running') {
            wasRunning.current = true;
            return;
        }
        if (props.state === 'completed' && wasRunning.current) setPopCheck(true);
        wasRunning.current = false;
    }, [props.state]);

    let content: React.ReactNode = null;
    switch (props.state) {
        case 'running':
            content = <ActivityIndicator size="small" color={theme.colors.textSecondary} style={styles.spinner} />;
            break;
        case 'completed':
            content = (
                <View style={popCheck ? styles.checkPop : undefined} testID="tool-line-check">
                    <Octicons name="check" size={16} color={theme.colors.gitAddedText} />
                </View>
            );
            break;
        case 'error':
            content = <Ionicons name="alert-circle-outline" size={17} color={theme.colors.warning} />;
            break;
        case 'denied':
            content = <Ionicons name="remove-circle-outline" size={17} color={theme.colors.textSecondary} />;
            break;
        case 'interrupted':
            content = <Ionicons name="stop-circle-outline" size={17} color={theme.colors.textSecondary} />;
            break;
        case 'pending':
            content = <View style={styles.pendingDot} />;
            break;
    }
    return <View style={styles.state}>{content}</View>;
}

export function ToolLineStatsText(props: { stats: ToolLineStats }) {
    if (props.stats.additions === 0 && props.stats.deletions === 0) return null;
    return (
        <Text style={styles.stats} numberOfLines={1}>
            <Text style={styles.additions}>+{compactCount(props.stats.additions)}</Text>
            {' '}
            <Text style={styles.deletions}>−{compactCount(props.stats.deletions)}</Text>
        </Text>
    );
}

/**
 * One compact tool row: icon, verb, monospaced argument, `+N −N`, a live timer
 * and the call's state. It is a button when it can expand a body or open the
 * call's detail screen.
 */
export function ToolLine(props: {
    icon: React.ReactNode;
    verb: string;
    argument?: string | null;
    stats?: ToolLineStats | null;
    state: ToolLineState;
    startedAt: number;
    completedAt?: number | null;
    expanded?: boolean;
    /** Shows the disclosure chevron; the row then toggles its body. */
    expandable?: boolean;
    /** `card` heads a bordered tool card: bold title and a quieter argument. */
    variant?: 'row' | 'card';
    onPress?: () => void;
    accessibilityLabel: string;
    testID?: string;
}) {
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const card = props.variant === 'card';
    const finishedMs = props.completedAt && props.completedAt >= props.startedAt
        ? props.completedAt - props.startedAt
        : null;
    const content = (
        <>
            <View style={styles.icon}>{props.icon}</View>
            <View style={[styles.text, card && styles.textCard]}>
                <Text style={card ? styles.cardTitle : styles.verb} numberOfLines={1}>{props.verb}</Text>
                {props.argument ? (
                    <Text style={card ? styles.cardArgument : styles.argument} numberOfLines={1} ellipsizeMode="middle">{props.argument}</Text>
                ) : null}
                {props.stats ? <ToolLineStatsText stats={props.stats} /> : null}
            </View>
            {props.state === 'running'
                ? <LiveTime from={props.startedAt} />
                : finishedMs !== null && finishedMs > 0
                    ? <Text style={styles.time}>{formatToolSeconds(finishedMs)}</Text>
                    : null}
            <ToolLineStateIcon state={props.state} />
            {props.expandable ? (
                <View style={[styles.chevron, props.expanded && styles.chevronOpen]}>
                    <Octicons
                        name="chevron-right"
                        size={14}
                        color={hovered ? theme.colors.text : theme.colors.textSecondary}
                    />
                </View>
            ) : null}
        </>
    );

    if (!props.onPress) {
        return (
            <View style={[styles.line, !card && styles.lineRow]} accessibilityLabel={props.accessibilityLabel} testID={props.testID}>
                {content}
            </View>
        );
    }
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel}
            accessibilityState={props.expandable ? { expanded: !!props.expanded } : undefined}
            aria-expanded={props.expandable ? !!props.expanded : undefined}
            onPress={props.onPress}
            onHoverIn={() => setHovered(true)}
            onHoverOut={() => setHovered(false)}
            testID={props.testID}
            style={({ pressed }: any) => [
                styles.line,
                !card && styles.lineRow,
                styles.lineInteractive,
                (hovered || pressed) && styles.lineHovered,
            ]}
        >
            {content}
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    line: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        minHeight: 38,
        paddingHorizontal: 10,
        borderRadius: theme.borderRadius.md,
        minWidth: 0,
    },
    // A compact row is as wide as its content, so the timer and state read
    // right after the argument; a card header spans the card.
    lineRow: {
        alignSelf: 'flex-start',
        maxWidth: '100%',
    },
    lineInteractive: {
        _web: {
            cursor: 'pointer',
            transition: `background-color ${theme.kilv.motionFast}ms ${theme.kilv.easeOut}`,
        },
    },
    lineHovered: {
        backgroundColor: theme.colors.glass.backgroundSubtle,
    },
    icon: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    text: {
        flexShrink: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
    },
    textCard: {
        flex: 1,
    },
    verb: {
        flexShrink: 0,
        maxWidth: '100%',
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.mono(),
    },
    argument: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    cardTitle: {
        flexShrink: 0,
        maxWidth: '100%',
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    cardArgument: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12.5,
        lineHeight: 18,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    stats: {
        flexShrink: 0,
        fontSize: 12,
        ...Typography.mono(),
    },
    additions: {
        color: theme.colors.gitAddedText,
        ...Typography.mono(),
    },
    deletions: {
        color: theme.colors.gitRemovedText,
        ...Typography.mono(),
    },
    time: {
        flexShrink: 0,
        fontSize: 12,
        color: theme.colors.kilv.inkFaint,
        ...Typography.mono(),
    },
    state: {
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    spinner: {
        transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }],
    },
    checkPop: {
        _web: {
            _classNames: herdWebClasses('herd-check'),
        },
    },
    pendingDot: {
        width: 8,
        height: 8,
        borderRadius: theme.kilv.radiusPill,
        backgroundColor: theme.colors.warning,
        _web: {
            _classNames: herdWebClasses('herd-attention'),
        },
    },
    chevron: {
        width: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        _web: {
            transition: `transform ${theme.kilv.motionBase}ms ${theme.kilv.easeOut}`,
        },
    },
    chevronOpen: {
        transform: [{ rotate: '90deg' }],
    },
}));
