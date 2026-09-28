import * as React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { useNewSessionDraft } from '@/hooks/useNewSessionDraft';
import { useAllMachines, useSessionListViewData } from '@/sync/storage';
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
import { HerdShellIcon } from './HerdShellIcon';
import { useHerdTopBarLayout } from './topBarLayout';

const MACHINE_POPOVER_WIDTH = 280;
const CONNECTIONS_ROUTE = '/settings/connections';

export function machineLabel(machine: Machine): string {
    return machine.metadata?.displayName?.trim() || machine.metadata?.host || machine.id;
}

/** Online machines first, each group keeping the store's newest-first order. */
export function orderMachinesForMenu(machines: readonly Machine[]): Machine[] {
    return [...machines.filter(isMachineOnline), ...machines.filter((machine) => !isMachineOnline(machine))];
}

/** What the pill shows: the account's machines are still loading, there are none, or the current one. */
export type HerdMachinePillState = 'loading' | 'empty' | 'machine';

export function resolveMachinePillState(input: { ready: boolean; machineCount: number; hasCurrent: boolean }): HerdMachinePillState {
    if (!input.ready) return 'loading';
    // An account with no machines has nothing to start on, whatever a draft still remembers.
    return input.machineCount > 0 && input.hasCurrent ? 'machine' : 'empty';
}

/**
 * Top bar machine pill, always visible (owner decision, UI overhaul): while
 * machines load, "No machine" with a way to add one when the account has
 * none, and otherwise the current machine and whether it is online. Its menu
 * switches the machine New Session uses and opens Connections or the
 * machine's details. On phones the pill sits in a 44 px touch target, and
 * `nameHidden` leaves only its dot when the bar runs out of room (a narrow
 * screen, or the Focus countdown).
 */
export function HerdMachineMenu({ nameHidden = false }: { nameHidden?: boolean }) {
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
    // The session list and the machines arrive together; null means not synced yet.
    const ready = useSessionListViewData() !== null;
    const state = resolveMachinePillState({ ready, machineCount: machines.length, hasCurrent: !!current });

    const toggle = React.useCallback(async () => {
        if (anchor) {
            setAnchor(null);
            return;
        }
        setAnchor(await measureHerdAnchor(triggerRef.current));
    }, [anchor]);
    const close = React.useCallback(() => setAnchor(null), []);
    const openConnections = React.useCallback(() => {
        setAnchor(null);
        router.push(CONNECTIONS_ROUTE as any);
    }, [router]);

    // A removed daemon stays selected (New Session fails in place) and reads as offline.
    const online = !!current?.machine && isMachineOnline(current.machine);
    const statusLabel = state === 'loading'
        ? t('common.loading')
        : state === 'empty'
            ? t('topBar.noMachine')
            : online ? t('status.online') : t('status.offline');
    const currentLabel = state === 'machine' && current ? (current.machine ? machineLabel(current.machine) : current.id) : statusLabel;
    const accessibilityLabel = state === 'machine'
        ? `${t('settings.machines')}: ${currentLabel}, ${statusLabel}`
        : `${t('settings.machines')}: ${statusLabel}`;

    return (
        <>
            {/* Phones: every level may shrink, so a long name ellipsizes instead of pushing the bar offscreen. */}
            <View ref={triggerRef} collapsable={false} style={phone ? styles.phoneShrink : undefined}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    aria-expanded={!!anchor}
                    aria-busy={state === 'loading' ? true : undefined}
                    disabled={state === 'loading'}
                    onPress={toggle}
                    testID="herd-machine-menu"
                    style={phone ? [styles.phoneTarget, styles.phoneShrink] : undefined}
                >
                    {({ hovered, pressed }: any) => {
                        const lit = (hovered || pressed || !!anchor) && state !== 'loading';
                        const ink = lit ? theme.colors.text : theme.colors.textSecondary;
                        return (
                            <View testID={`herd-machine-pill-${state}`} style={[styles.pill, phone && styles.phoneShrink, lit && styles.pillHovered]}>
                                {!(phone && state === 'machine') && <HerdShellIcon name="monitor" size={14} color={ink} />}
                                {state === 'machine' ? (
                                    <>
                                        {!nameHidden && <Text numberOfLines={1} style={[styles.pillName, lit && styles.pillTextLit]}>{currentLabel}</Text>}
                                        <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
                                        {/* The desktop mock keeps the status at every width; the phone mock draws the dot alone. */}
                                        {!phone && <Text style={[styles.pillStatus, lit && styles.pillTextLit]}>{statusLabel}</Text>}
                                    </>
                                ) : (
                                    !nameHidden && <Text numberOfLines={1} style={[styles.pillName, lit && styles.pillTextLit]}>{statusLabel}</Text>
                                )}
                                {state !== 'loading' && <HerdShellIcon name="chevronDown" size={13} color={ink} />}
                            </View>
                        );
                    }}
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
                {state === 'empty' && <Text style={styles.empty} testID="herd-machine-empty">{t('topBar.noMachinesYet')}</Text>}
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
                            selected={machine.id === current?.id}
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
                    leading={<HerdShellIcon name={state === 'empty' ? 'plus' : 'link'} size={16} color={theme.colors.textSecondary} />}
                    label={state === 'empty' ? t('topBar.addMachine') : t('devicePairing.title')}
                    onPress={openConnections}
                    testID="herd-machine-connections"
                />
                {state === 'machine' && current && (
                    <HerdMenuItem
                        leading={<HerdShellIcon name="monitor" size={16} color={theme.colors.textSecondary} />}
                        label={t('sessionInfo.viewMachine')}
                        onPress={() => {
                            close();
                            router.push(`/machine/${current.id}` as any);
                        }}
                    />
                )}
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
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        _web: { _classNames: ['herd-transition'] },
    },
    // The mock's `button.top-pill:hover`: the rim line and full ink.
    pillHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    pillTextLit: {
        color: theme.colors.text,
    },
    pillName: {
        flexShrink: 1,
        minWidth: 0,
        fontSize: 12.5,
        color: theme.colors.textSecondary,
        ...Typography.mono(),
    },
    empty: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
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
