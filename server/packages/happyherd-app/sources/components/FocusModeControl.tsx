import * as React from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProjects, useSettingMutable } from '@/sync/storage';
import { FOCUS_DURATIONS, formatFocusRemaining, getFocusRemainingSeconds } from '@/sync/focusMode';
import { useFocusMode } from '@/hooks/useFocusMode';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { HerdSegmentedControl } from '@/components/herd/SegmentedControl';
import { HerdButton, HerdChip, HerdSectionLabel } from '@/components/herd/pages/HerdPage';
import { herdWebClasses } from '@/components/herd/motion';
import { focusModeProgress } from '@/components/herd/pages/focusProgress';
import { HerdMenuSeparator, HerdMenuItem, HerdMenuTitle, HerdPopover, measureHerdAnchor, type HerdAnchorRect } from '@/components/herd/HerdPopover';
import { HerdShellIcon } from '@/components/herd/shell/HerdShellIcon';
import { HerdTopBarIconButton } from '@/components/herd/shell/HerdTopBarIconButton';
import { useHerdTopBarLayout } from '@/components/herd/shell/topBarLayout';

// App-only adaptation of React Bits Pixel Swap's staggered, growing windows.
// The incoming content is solid amber, so tiles need no cloned DOM or native snapshots.
// Copyright (c) 2026 David Haz. MIT + Commons Clause; see docs/licenses/react-bits-pixel-swap.txt.
// https://github.com/DavidHDev/react-bits/blob/c5df8610c0b47d7cd805cda480baba402f7267c1/src/ts-default/Animations/PixelSwap/PixelSwap.tsx
function PixelTile({ index, size, columns, color }: {
    index: number; size: number; columns: number; color: string;
}) {
    const progress = React.useRef(new Animated.Value(0)).current;
    const delay = React.useRef(Math.random() * 950).current;
    React.useEffect(() => {
        const animation = Animated.timing(progress, {
            toValue: 1, duration: 450, delay,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => animation.stop();
    }, [delay, progress]);
    return <Animated.View style={{
        position: 'absolute', left: (index % columns) * size, top: Math.floor(index / columns) * size,
        width: size + 1, height: size + 1, backgroundColor: color, opacity: progress,
        transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }],
    }} />;
}

function FocusModeSetup({ onClose }: { onClose: () => void }) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const dimensions = useWindowDimensions();
    const reducedMotion = useReducedMotion();
    const [revealed, setRevealed] = React.useState(reducedMotion);
    const [minutes, setMinutes] = React.useState<number>(30);
    const [projectId, setProjectId] = React.useState('');
    const projectsById = useProjects();
    const [, setFocusMode] = useSettingMutable('focusMode');
    const projects = React.useMemo(() => Object.values(projectsById)
        .filter(project => project.kind === 'personal')
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [projectsById]);
    const canStart = projects.some(project => project.id === projectId);
    const amber = theme.colors.kilv.molten;
    const ink = theme.colors.kilv.steel;
    const size = Math.max(64, Math.ceil(Math.sqrt(dimensions.width * dimensions.height / 200)));
    const columns = Math.ceil(dimensions.width / size);
    const tileCount = columns * Math.ceil(dimensions.height / size);

    React.useEffect(() => {
        if (reducedMotion) { setRevealed(true); return; }
        const timeout = setTimeout(() => setRevealed(true), 1400);
        return () => clearTimeout(timeout);
    }, [reducedMotion]);

    return (
        <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
            <View testID="focus-mode-setup" style={{ flex: 1, backgroundColor: revealed ? amber : 'transparent' }}>
                {!revealed && <View testID="focus-mode-pixel-swap" pointerEvents="none" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                    {Array.from({ length: tileCount }, (_, index) => <PixelTile key={index} index={index} size={size} columns={columns} color={amber} />)}
                </View>}
                {revealed && <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: safeArea.top + 40, paddingBottom: safeArea.bottom + 40 }}>
                    <View style={{ width: '100%', maxWidth: 540, alignSelf: 'center', gap: 24 }}>
                        <Text accessibilityRole="header" style={{ fontSize: dimensions.width < 600 ? 36 : 56, lineHeight: dimensions.width < 600 ? 44 : 64, ...Typography.header(), color: ink }}>
                            {t('focusMode.title')}
                        </Text>
                        <View style={styles.card}>
                            <View style={styles.focusMark}><HerdShellIcon name="focus" size={28} color={theme.colors.textLink} /></View>
                            <View>
                                <HerdSectionLabel first>{t('focusMode.duration')}</HerdSectionLabel>
                                <HerdSegmentedControl
                                    accessibilityLabel={t('focusMode.duration')}
                                    options={FOCUS_DURATIONS.map((value) => ({
                                        value,
                                        label: t('focusMode.durationOption', { minutes: String(value) }),
                                    }))}
                                    value={minutes}
                                    onChange={setMinutes}
                                />
                            </View>
                            <View>
                                <HerdSectionLabel first>{t('focusMode.project')}</HerdSectionLabel>
                                {projects.length === 0 ? (
                                    <Text style={styles.hint}>{t('focusMode.noProjects')}</Text>
                                ) : (
                                    <View accessibilityRole="radiogroup" accessibilityLabel={t('focusMode.project')} style={styles.chips}>
                                        {projects.map((project) => (
                                            <HerdChip
                                                key={project.id}
                                                label={project.name}
                                                selected={project.id === projectId}
                                                onPress={() => setProjectId(project.id)}
                                            />
                                        ))}
                                    </View>
                                )}
                                {projects.length > 0 && !canStart && (
                                    <Text style={[styles.hint, styles.hintBelow]}>{t('focusMode.selectProject')}</Text>
                                )}
                            </View>
                            <View style={styles.actions}>
                                <HerdButton label={t('focusMode.cancel')} onPress={onClose} />
                                <HerdButton variant="primary" icon="play" label={t('focusMode.start')} disabled={!canStart} onPress={() => {
                                    if (!canStart) return;
                                    const startedAt = Date.now();
                                    setFocusMode({ projectId, endsAt: startedAt + minutes * 60_000, startedAt });
                                    onClose();
                                }} />
                            </View>
                        </View>
                    </View>
                </ScrollView>}
            </View>
        </Modal>
    );
}

function FocusRing({ progress }: { progress: number }) {
    const { theme } = useUnistyles();
    const size = 16;
    const stroke = 2.5;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.min(1, Math.max(0, progress));
    return (
        <Svg testID="focus-mode-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
            {...(Platform.OS === 'web' ? { 'aria-hidden': true } : { accessible: false })}>
            <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.colors.selection.background} strokeWidth={stroke} fill="none" />
            <Circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={theme.colors.textLink}
                strokeWidth={stroke}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={`${circumference} ${circumference}`}
                strokeDashoffset={circumference * (1 - clamped)}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
        </Svg>
    );
}

/**
 * The top bar's Focus mode control (UI overhaul, as the approved mock draws
 * it). Desktop: a "Focus mode" pill, then the live countdown pill with its
 * ring, time, project and exit. Phones: an icon button, then a compact
 * ring-and-time pill whose menu shows the project, the time left and Exit.
 */
export function FocusModeControl() {
    const { theme } = useUnistyles();
    const dimensions = useWindowDimensions();
    const phone = useHerdTopBarLayout() === 'phone';
    const focus = useFocusMode();
    const projectsById = useProjects();
    const [, setFocusMode] = useSettingMutable('focusMode');
    const [setupOpen, setSetupOpen] = React.useState(false);
    const [now, setNow] = React.useState(Date.now);
    const menuTrigger = React.useRef<View>(null);
    const [menuAnchor, setMenuAnchor] = React.useState<HerdAnchorRect | null>(null);
    React.useEffect(() => {
        if (!focus) return;
        setNow(Date.now());
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [focus]);
    React.useEffect(() => {
        if (!focus) setMenuAnchor(null);
    }, [focus]);
    const remaining = getFocusRemainingSeconds(focus, now);
    const time = formatFocusRemaining(remaining);
    const progress = focus ? focusModeProgress(focus, remaining) : 0;
    const projectName = focus ? projectsById[focus.projectId]?.name : undefined;
    const remainingLabel = t('focusMode.remaining', { time });
    const openMenu = React.useCallback(async () => {
        if (menuAnchor) {
            setMenuAnchor(null);
            return;
        }
        setMenuAnchor(await measureHerdAnchor(menuTrigger.current));
    }, [menuAnchor]);
    const exit = React.useCallback(() => {
        setMenuAnchor(null);
        setFocusMode(null);
    }, [setFocusMode]);

    let control: React.ReactNode;
    if (focus && phone) {
        control = <>
            <View ref={menuTrigger} collapsable={false}>
                <Pressable testID="focus-mode-pill" accessibilityRole="button"
                    accessibilityLabel={projectName ? `${remainingLabel} · ${projectName}` : remainingLabel}
                    aria-haspopup="menu" aria-expanded={!!menuAnchor} onPress={openMenu}
                    style={({ pressed }) => [styles.phoneTarget, pressed && styles.pressed]}>
                    <View style={[styles.pill, styles.pillPhone]}>
                        <FocusRing progress={progress} />
                        <Text testID="focus-mode-timer" style={styles.pillTime}>{time}</Text>
                    </View>
                </Pressable>
            </View>
            <HerdPopover visible={!!menuAnchor} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={290}
                accessibilityLabel={t('focusMode.enter')} testID="focus-mode-menu">
                <HerdMenuTitle>{t('focusMode.enter')}</HerdMenuTitle>
                <View testID="focus-mode-menu-info" accessibilityLabel={remainingLabel} style={styles.menuInfo}>
                    <HerdShellIcon name="folders" size={17} color={theme.colors.textSecondary} />
                    <Text numberOfLines={1} style={styles.menuProject}>{projectName ?? ''}</Text>
                    <Text style={styles.menuTime}>{time}</Text>
                </View>
                <HerdMenuSeparator />
                <HerdMenuItem testID="focus-mode-exit" icon="close" label={t('focusMode.exit')} onPress={exit} />
            </HerdPopover>
        </>;
    } else if (focus) {
        control = <View testID="focus-mode-pill" style={styles.pill}>
            <FocusRing progress={progress} />
            <Text testID="focus-mode-timer" accessibilityLabel={remainingLabel} style={styles.pillTime}>{time}</Text>
            {projectName && dimensions.width >= 600 ? <Text numberOfLines={1} style={styles.pillProject}>{projectName}</Text> : null}
            <Pressable testID="focus-mode-exit" accessibilityRole="button" accessibilityLabel={t('focusMode.exit')}
                onPress={exit} hitSlop={8} style={({ pressed }) => [styles.pillExit, pressed && styles.pressed]}>
                <HerdShellIcon name="x" size={13} color={theme.colors.textLink} />
            </Pressable>
        </View>;
    } else if (phone) {
        control = <HerdTopBarIconButton testID="focus-mode-enter" label={t('focusMode.enter')} onPress={() => setSetupOpen(true)}>
            <HerdShellIcon name="focus" size={19} color={theme.colors.header.tint} />
        </HerdTopBarIconButton>;
    } else {
        control = <Pressable testID="focus-mode-enter" accessibilityRole="button" accessibilityLabel={t('focusMode.enter')}
            onPress={() => setSetupOpen(true)}
            style={({ pressed, hovered }: any) => [styles.enter, (hovered || pressed) && styles.enterHovered]}>
            {({ pressed, hovered }: any) => <>
                <HerdShellIcon name="focus" size={14} color={hovered || pressed ? theme.colors.text : theme.colors.textSecondary} />
                <Text style={[styles.enterLabel, (hovered || pressed) && styles.enterLabelHovered]}>{t('focusMode.enter')}</Text>
            </>}
        </Pressable>;
    }

    return <>
        {control}
        {setupOpen && <FocusModeSetup onClose={() => setSetupOpen(false)} />}
    </>;
}

const styles = StyleSheet.create((theme) => ({
    card: {
        gap: 20,
        padding: 24,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.kilv.radiusSheet,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        _web: { _classNames: herdWebClasses('herd-sheet'), boxShadow: theme.kilv.shadow },
    },
    focusMark: {
        alignSelf: 'center',
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    hint: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.textSecondary,
    },
    hintBelow: {
        marginTop: 8,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: 8,
    },
    // The mock's `.top-pill`: a hairline mono pill with the focus icon.
    enter: {
        height: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingHorizontal: 10,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        _web: { cursor: 'pointer', _classNames: ['herd-transition', 'herd-press'] },
    },
    enterHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    enterLabel: {
        ...Typography.mono(),
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    enterLabelHovered: {
        color: theme.colors.text,
    },
    phoneTarget: {
        height: 44,
        justifyContent: 'center',
        paddingHorizontal: 2,
    },
    pillPhone: {
        paddingRight: 10,
    },
    menuInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        paddingHorizontal: 8,
    },
    menuProject: {
        ...Typography.default(),
        flex: 1,
        fontSize: 15,
        color: theme.colors.text,
    },
    menuTime: {
        ...Typography.mono(),
        fontSize: 13,
        color: theme.colors.textLink,
        fontVariant: ['tabular-nums'],
    },
    pill: {
        height: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 10,
        paddingRight: 4,
        borderWidth: 1,
        borderColor: theme.colors.selection.border,
        borderRadius: theme.kilv.radiusPill,
        backgroundColor: theme.colors.selection.background,
        _web: { _classNames: herdWebClasses('herd-pop') },
    },
    pillTime: {
        ...Typography.mono(),
        fontSize: 13,
        color: theme.colors.textLink,
        fontVariant: ['tabular-nums'],
    },
    pillProject: {
        ...Typography.default(),
        maxWidth: 120,
        fontSize: 12.5,
        color: theme.colors.textSecondary,
    },
    pillExit: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        _web: { cursor: 'pointer', _hover: { backgroundColor: theme.colors.surfacePressedOverlay } },
    },
    pressed: {
        opacity: 0.7,
    },
}));
