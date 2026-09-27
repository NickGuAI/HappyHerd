import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useAllMachines } from '@/sync/storage';
import type { Machine } from '@/sync/storageTypes';
import { t } from '@/text';
import { isMachineOnline } from '@/utils/machineUtils';
import { resolveNewSessionMachine } from '@/utils/newSessionMachine';
import {
    HerdMenuItem,
    HerdMenuSeparator,
    HerdMenuTitle,
    HerdPopover,
    measureHerdAnchor,
    type HerdAnchorRect,
} from '../HerdPopover';
import { useHerdTopBarLayout } from './topBarLayout';

const MACHINE_POPOVER_WIDTH = 300;

export function machineLabel(machine: Machine): string {
    return machine.metadata?.displayName?.trim() || machine.metadata?.host || machine.id;
}

/** Online machines first, each group keeping the store's newest-first order. */
export function orderMachinesForMenu(machines: readonly Machine[]): Machine[] {
    return [...machines.filter(isMachineOnline), ...machines.filter((machine) => !isMachineOnline(machine))];
}

/**
 * Top bar machine pill: the current machine and whether it is online, with a
 * menu to switch the machine New Session uses or open its details. On phones
 * the pill sits in a 44 px touch target, and `nameHidden` leaves only its dot
 * when the bar runs out of room (a narrow screen, or the Focus countdown).
 */
export function HerdMachineMenu({ compact, nameHidden = false }: { compact: boolean; nameHidden?: boolean }) {
    const { theme } = useUnistyles();
    const phone = useHerdTopBarLayout() === 'phone';
    const router = useRouter();
    const triggerRef = React.useRef<View>(null);
    const [anchor, setAnchor] = React.useState<HerdAnchorRect | null>(null);
    const machines = useAllMachines({ includeOffline: true });
    const selectedMachineId = useNewSessionDraft((state) => state.selectedMachineId);
    const setMachineId = useNewSessionDraft((state) => state.setMachineId);
    // The same rule New Session applies, so the pill never promises another target.
    const current = resolveNewSessionMachine(machines, selectedMachineId);

    const toggle = React.useCallback(async () => {
        if (anchor) {
            setAnchor(null);
            return;
        }
        setAnchor(await measureHerdAnchor(triggerRef.current));
    }, [anchor]);
    const close = React.useCallback(() => setAnchor(null), []);

    if (!current) {
        return null;
    }
    // A removed daemon stays selected (New Session fails in place) and reads as offline.
    const online = !!current.machine && isMachineOnline(current.machine);
    const statusLabel = online ? t('status.online') : t('status.offline');
    const currentLabel = current.machine ? machineLabel(current.machine) : current.id;

    return (
        <>
            {/* Phones: every level may shrink, so a long name ellipsizes instead of pushing the bar offscreen. */}
            <View ref={triggerRef} collapsable={false} style={phone ? styles.phoneShrink : undefined}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('settings.machines')}: ${currentLabel}, ${statusLabel}`}
                    aria-expanded={!!anchor}
                    onPress={toggle}
                    testID="herd-machine-menu"
                    style={phone ? [styles.phoneTarget, styles.phoneShrink] : undefined}
                >
                    {({ hovered, pressed }: any) => (
                        <View style={[styles.pill, phone && styles.phoneShrink, (hovered || pressed || anchor) && styles.pillHovered]}>
                            {!nameHidden && <Ionicons name="desktop-outline" size={14} color={theme.colors.textSecondary} />}
                            {!nameHidden && <Text numberOfLines={1} style={styles.pillName}>{currentLabel}</Text>}
                            <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
                            {!compact && <Text style={styles.pillStatus}>{statusLabel}</Text>}
                            <Ionicons name="chevron-down" size={13} color={theme.colors.textSecondary} />
                        </View>
                    )}
                </Pressable>
            </View>
            <HerdPopover
                visible={!!anchor}
                anchor={anchor}
                onClose={close}
                width={MACHINE_POPOVER_WIDTH}
                accessibilityLabel={t('settings.machines')}
                testID="herd-machine-popover"
            >
                <HerdMenuTitle>{t('settings.machines')}</HerdMenuTitle>
                <ScrollView style={styles.options} testID="herd-machine-options">
                {orderMachinesForMenu(machines).map((machine) => {
                    const machineOnline = isMachineOnline(machine);
                    return (
                        <HerdMenuItem
                            key={machine.id}
                            label={machineLabel(machine)}
                            hint={[machine.metadata?.platform, machineOnline ? t('status.online') : t('status.offline')]
                                .filter(Boolean)
                                .join(' · ')}
                            leading={<View style={[styles.dot, machineOnline ? styles.dotOnline : styles.dotOffline]} />}
                            selected={machine.id === current.id}
                            disabled={!machineOnline}
                            testID={`herd-machine-option-${machine.id}`}
                            onPress={() => {
                                if (machine.id !== selectedMachineId) setMachineId(machine.id);
                                close();
                            }}
                        />
                    );
                })}
                </ScrollView>
                <HerdMenuSeparator />
                <HerdMenuItem
                    icon="desktop-outline"
                    label={t('sessionInfo.viewMachine')}
                    onPress={() => {
                        close();
                        router.push(`/machine/${current.id}` as any);
                    }}
                />
            </HerdPopover>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    phoneTarget: {
        height: 44,
        justifyContent: 'center',
        paddingHorizontal: 2,
    },
    phoneShrink: {
        flexShrink: 1,
        minWidth: 0,
    },
    pill: {
        height: 32,
        maxWidth: 240,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 10,
        borderRadius: theme.kilv.radius,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        _web: { _classNames: ['herd-transition'] },
    },
    pillHovered: {
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    pillName: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12.5,
        color: theme.colors.text,
        ...Typography.mono(),
    },
    pillStatus: {
        fontSize: 12.5,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    // Bounded so every machine stays reachable when the list outgrows the window.
    options: {
        flexGrow: 0,
        flexShrink: 1,
        minHeight: 0,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    dotOnline: {
        backgroundColor: theme.colors.status.connected,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    dotOffline: {
        backgroundColor: theme.colors.status.disconnected,
        opacity: 0.6,
    },
}));
