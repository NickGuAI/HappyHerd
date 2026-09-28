import * as React from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useReducedMotion } from 'react-native-reanimated';
import { useProjects, useSettingMutable } from '@/sync/storage';
import { FOCUS_DURATIONS, formatFocusRemaining, getFocusRemainingSeconds } from '@/sync/focusMode';
import { useFocusMode } from '@/hooks/useFocusMode';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { HerdSegmentedControl } from '@/components/herd/SegmentedControl';
import { HerdButton, HerdChip, HerdSectionLabel } from '@/components/herd/pages/HerdPage';
import { useSheetEscapeKeydown } from '@/components/herd/pages/HerdSheet';
import { HerdExitLayer } from '@/components/herd/HerdExitLayer';
import { HERD_EXIT, useHerdExit } from '@/components/herd/presence';
import { herdWebClasses } from '@/components/herd/motion';
import { focusModeProgress } from '@/components/herd/pages/focusProgress';
import { HerdMenuSeparator, HerdMenuItem, HerdMenuTitle, HerdPopover, measureHerdAnchor, type HerdAnchorRect } from '@/components/herd/HerdPopover';
import { HERD_PHONE_FLOAT_MARGIN, useHerdPhoneLayout } from '@/components/herd/mobile/useHerdPhone';
import { HerdShellIcon } from '@/components/herd/shell/HerdShellIcon';
import { HerdTopBarIconButton } from '@/components/herd/shell/HerdTopBarIconButton';
import { HERD_PHONE_TOP_BAR_HEIGHT, useHerdTopBarLayout } from '@/components/herd/shell/topBarLayout';
import { useWindowSafeAreaInsets } from '@/components/herd/shell/windowInsets';
import { closeFocusSetup, openFocusSetup, useFocusSetupRequest, type FocusSetupRequest } from './focusSetup';

export { openFocusSetup } from './focusSetup';

/**
 * The mock's Focus sheet (UI overhaul): a centered dialog over the dimmed app
 * with the focus glyph in a ring, the title inside the card and centered
 * section labels. Phones rest the same card on the bottom edge, as HerdSheet
 * does. The web scales it in and out through the sheet classes, which reduced
 * motion turns off; native fades unless motion is reduced.
 */
function FocusModeSetup({ request, exiting, onClose }: {
    request: FocusSetupRequest;
    exiting: boolean;
    onClose: () => void;
}) {
    const { theme } = useUnistyles();
    const phone = useHerdPhoneLayout();
    const windowInsets = useWindowSafeAreaInsets();
    const reducedMotion = useReducedMotion();
    const [minutes, setMinutes] = React.useState<number>(30);
    const [projectId, setProjectId] = React.useState(request.projectId ?? '');
    const projectsById = useProjects();
    const [, setFocusMode] = useSettingMutable('focusMode');
    const projects = React.useMemo(() => Object.values(projectsById)
        .filter(project => project.kind === 'personal')
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)), [projectsById]);
    const canStart = projects.some(project => project.id === projectId);
    useSheetEscapeKeydown(!exiting);

    const layer = (
        <View style={[
            styles.setupRoot,
            // Phones keep the top bar in view, as the mock's 20 px of it does.
            phone && [styles.setupRootPhone, {
                paddingTop: windowInsets.top + HERD_PHONE_TOP_BAR_HEIGHT + 20,
                paddingBottom: HERD_PHONE_FLOAT_MARGIN + windowInsets.bottom,
            }],
        ]}>
            {/* Like the mock's scrim, a pointer target only; Escape and Cancel dismiss for everyone. */}
            <Pressable
                testID="focus-mode-scrim"
                aria-hidden
                accessible={false}
                importantForAccessibility="no"
                onPress={onClose}
                style={styles.setupScrim(exiting)}
            />
            <View
                testID="focus-mode-setup"
                role="dialog"
                aria-modal
                accessibilityLabel={t('focusMode.title')}
                style={styles.setupCard(exiting)}
            >
                <ScrollView
                    contentContainerStyle={[styles.setupContent, phone && styles.setupContentPhone]}
                    keyboardShouldPersistTaps="handled"
                >
                    <View style={styles.setupHead}>
                        <View testID="focus-mode-mark" style={styles.focusMark}>
                            <HerdShellIcon name="focus" size={28} color={theme.colors.textLink} />
                        </View>
                        <Text accessibilityRole="header" style={styles.setupTitle}>{t('focusMode.title')}</Text>
                    </View>
                    <View style={styles.centered}>
                        <HerdSectionLabel>{t('focusMode.duration')}</HerdSectionLabel>
                    </View>
                    <HerdSegmentedControl
                        accessibilityLabel={t('focusMode.duration')}
                        options={FOCUS_DURATIONS.map((value) => ({
                            value,
                            label: t('focusMode.durationOption', { minutes: String(value) }),
                        }))}
                        value={minutes}
                        onChange={setMinutes}
                    />
                    <View style={styles.centered}>
                        <HerdSectionLabel>{t('focusMode.project')}</HerdSectionLabel>
                    </View>
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
                        <Text style={styles.hint}>{t('focusMode.selectProject')}</Text>
                    )}
                    <View style={[styles.actions, phone && styles.actionsPhone]}>
                        <HerdButton label={t('focusMode.cancel')} onPress={onClose} style={phone ? styles.actionPhone : undefined} />
                        <HerdButton variant="primary" icon="play" label={t('focusMode.start')} disabled={!canStart} style={phone ? styles.actionPhone : undefined} onPress={() => {
                            if (!canStart) return;
                            const startedAt = Date.now();
                            setFocusMode({ projectId, endsAt: startedAt + minutes * 60_000, startedAt });
                            onClose();
                        }} />
                    </View>
                </ScrollView>
            </View>
        </View>
    );
    // Closing ends the Modal at once; on the web the card leaves on an inert layer.
    if (exiting) return <HerdExitLayer>{layer}</HerdExitLayer>;
    return (
        <Modal
            visible
            transparent
            animationType={Platform.OS === 'web' || reducedMotion ? 'none' : 'fade'}
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {layer}
        </Modal>
    );
}

/** Hosts the one Focus setup that openFocusSetup() opens. */
function FocusModeSetupHost() {
    const request = useFocusSetupRequest((state) => state.request);
    const presence = useHerdExit(request, HERD_EXIT.sheet);
    if (!presence.value) return null;
    return <FocusModeSetup key={presence.value.id} request={presence.value} exiting={presence.exiting} onClose={closeFocusSetup} />;
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
        control = <HerdTopBarIconButton testID="focus-mode-enter" label={t('focusMode.enter')} onPress={() => openFocusSetup()}>
            <HerdShellIcon name="focus" size={19} color={theme.colors.header.tint} />
        </HerdTopBarIconButton>;
    } else {
        control = <Pressable testID="focus-mode-enter" accessibilityRole="button" accessibilityLabel={t('focusMode.enter')}
            onPress={() => openFocusSetup()}
            style={({ pressed, hovered }: any) => [styles.enter, (hovered || pressed) && styles.enterHovered]}>
            {({ pressed, hovered }: any) => <>
                <HerdShellIcon name="focus" size={14} color={hovered || pressed ? theme.colors.text : theme.colors.textSecondary} />
                <Text style={[styles.enterLabel, (hovered || pressed) && styles.enterLabelHovered]}>{t('focusMode.enter')}</Text>
            </>}
        </Pressable>;
    }

    return <>
        {control}
        <FocusModeSetupHost />
    </>;
}

const styles = StyleSheet.create((theme) => ({
    // The mock's `.sheet-wrap`, `.scrim` and `.sheet.focus-card`.
    setupRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
    },
    setupRootPhone: {
        justifyContent: 'flex-end',
        paddingHorizontal: HERD_PHONE_FLOAT_MARGIN,
    },
    setupScrim: (exiting: boolean) => ({
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: theme.colors.kilv.scrim,
        _web: { backdropFilter: 'blur(2px)', _classNames: herdWebClasses(exiting ? 'herd-fade-out' : 'herd-fade') },
    }),
    setupCard: (exiting: boolean) => ({
        width: '100%',
        maxWidth: 520,
        maxHeight: '100%',
        overflow: 'hidden',
        borderRadius: theme.kilv.radiusSheet,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.surface,
        shadowColor: theme.colors.shadow.color,
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 40,
        shadowOffset: { width: 0, height: 24 },
        elevation: 16,
        _web: { _classNames: herdWebClasses(exiting ? 'herd-sheet-out' : 'herd-sheet'), boxShadow: theme.kilv.shadow },
    }),
    setupContent: {
        paddingTop: 24,
        paddingHorizontal: 24,
        paddingBottom: 20,
    },
    setupContentPhone: {
        paddingTop: 20,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    setupHead: {
        alignItems: 'center',
    },
    // The mock's `.focus-card .tomato`: the glyph in a molten ring.
    focusMark: {
        width: 64,
        height: 64,
        marginTop: 6,
        marginBottom: 14,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.selection.background,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    setupTitle: {
        ...Typography.default('semiBold'),
        fontSize: 22,
        lineHeight: 28,
        letterSpacing: -0.22,
        textAlign: 'center',
        color: theme.colors.text,
    },
    centered: {
        alignItems: 'center',
    },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    // The mock's `.field-hint` and `.faint`, centered with the card.
    hint: {
        ...Typography.default(),
        marginTop: 6,
        fontSize: 12.5,
        lineHeight: 17,
        textAlign: 'center',
        color: theme.colors.kilv.inkFaint,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 20,
    },
    // The phone mock's `.sheet-actions`: two equal, taller buttons.
    actionsPhone: {
        gap: 8,
    },
    actionPhone: {
        flex: 1,
        height: 46,
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
