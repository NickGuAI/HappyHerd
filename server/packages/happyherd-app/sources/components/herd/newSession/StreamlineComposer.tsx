import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { HerdAnchorRect } from '../HerdPopover';
import { herdWebClasses } from '../motion';

export type StreamlineChipKey = 'agent' | 'model' | 'effort' | 'permission' | 'worktree';

export type StreamlineChip = {
    key: StreamlineChipKey;
    label: string;
    icon?: React.ReactNode;
    accent?: boolean;
};

/**
 * Streamline's launch choices as composer chips. Each opens the same picker
 * as the Advanced form; phones keep the agent, permission and worktree chips.
 */
export function StreamlineComposerChips({ chips, activeKey, compact, onPress }: {
    chips: readonly StreamlineChip[];
    activeKey: StreamlineChipKey | null;
    compact: boolean;
    /** The pressed chip's window rectangle anchors its picker. */
    onPress: (key: StreamlineChipKey, anchor: HerdAnchorRect | null) => void;
}) {
    const { theme } = useUnistyles();
    const refs = React.useRef<Partial<Record<StreamlineChipKey, View | null>>>({});
    const visible = compact ? chips.filter((chip) => chip.key !== 'model' && chip.key !== 'effort') : chips;
    const press = React.useCallback((key: StreamlineChipKey) => {
        const node = refs.current[key];
        if (!node) {
            onPress(key, null);
            return;
        }
        node.measureInWindow((x, y, width, height) => onPress(key, { x, y, width, height }));
    }, [onPress]);
    return (
        <View style={styles.chips} testID="streamline-composer-chips">
            {visible.map((chip) => {
                const active = activeKey === chip.key;
                return (
                    <Pressable
                        key={chip.key}
                        ref={(node) => { refs.current[chip.key] = node; }}
                        accessibilityRole="button"
                        accessibilityLabel={chip.label}
                        aria-expanded={active}
                        onPress={() => press(chip.key)}
                        testID={`streamline-chip-${chip.key}`}
                        style={({ hovered, pressed }: any) => [
                            styles.chip,
                            chip.accent && styles.chipAccent,
                            (hovered || pressed || active) && styles.chipHovered,
                            active && styles.chipActive,
                        ]}
                    >
                        {chip.icon}
                        <Text numberOfLines={1} style={[styles.chipText, chip.accent && styles.chipTextAccent]}>{chip.label}</Text>
                        <Ionicons name="chevron-down" size={11} color={chip.accent ? theme.colors.textLink : theme.colors.kilv.inkFaint} />
                    </Pressable>
                );
            })}
        </View>
    );
}

/** One line under the composer: what this launch will use, and where to change the defaults. */
export function StreamlineSummary({ summary, worktree, onOpenSettings }: {
    summary: string;
    worktree: boolean;
    onOpenSettings: () => void;
}) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.summary} testID="streamline-summary">
            <Ionicons name="sparkles-outline" size={14} color={theme.colors.textLink} />
            <Text style={styles.summaryText}>
                {summary} {worktree ? t('newSession.streamline.worktreeOn') : t('newSession.streamline.worktreeOff')}.
            </Text>
            <Pressable
                accessibilityRole="link"
                onPress={onOpenSettings}
                testID="streamline-settings-link"
                style={({ hovered, pressed }: any) => [styles.settingsLink, (hovered || pressed) && styles.settingsLinkHovered]}
            >
                <Text style={styles.settingsLinkText}>{t('newSession.streamline.settingsLink')}</Text>
                <Ionicons name="chevron-forward" size={13} color={theme.colors.textSecondary} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    chips: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
    },
    chip: {
        height: 28,
        maxWidth: 200,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 9,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        _web: { _classNames: herdWebClasses('herd-transition', 'herd-press') },
    },
    chipAccent: {
        borderColor: theme.colors.selection.border,
    },
    chipHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    chipActive: {
        backgroundColor: theme.colors.selection.background,
    },
    chipText: {
        flexShrink: 1,
        fontSize: 12.5,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    chipTextAccent: {
        color: theme.colors.textLink,
    },
    summary: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        marginTop: 12,
        _web: { _classNames: herdWebClasses('herd-fade') },
    },
    summaryText: {
        flex: 1,
        minWidth: 200,
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    settingsLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        height: 28,
        paddingHorizontal: 8,
        marginLeft: 'auto',
        borderRadius: theme.kilv.radius,
    },
    settingsLinkHovered: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    settingsLinkText: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
}));
