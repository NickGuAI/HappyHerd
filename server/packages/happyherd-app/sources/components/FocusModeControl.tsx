import * as React from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProjects, useSettingMutable } from '@/sync/storage';
import { FOCUS_DURATIONS, formatFocusRemaining, getFocusRemainingSeconds } from '@/sync/focusMode';
import { useFocusMode } from '@/hooks/useFocusMode';
import { t } from '@/text';
import { Typography } from '@/constants/Typography';
import { Item } from './Item';
import { RoundButton } from './RoundButton';

function TomatoIcon() {
    const { theme } = useUnistyles();
    return (
        <Svg width={24} height={24} viewBox="0 0 24 24"
            {...(Platform.OS === 'web' ? { 'aria-hidden': true } : { accessible: false })}>
            <Path d="M12 7C5 3 1 9 3 16c2 7 16 7 18 0 2-7-2-13-9-9Z" fill={theme.colors.textDestructive} />
            <Path d="m12 9-6-3 5 1-1-4 3 3 4-2-2 4 4 2-6-1-2 3Z" fill={theme.colors.kilv.olive} />
        </Svg>
    );
}

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

function FocusChoice({ label, value, options, onSelect }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onSelect: (value: string) => void;
}) {
    const { theme } = useUnistyles();
    const safeArea = useSafeAreaInsets();
    const dimensions = useWindowDimensions();
    const trigger = React.useRef<View>(null);
    const [anchor, setAnchor] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
    React.useEffect(() => setAnchor(null), [dimensions.width, dimensions.height]);
    const menuHeight = Math.min(options.length * 56 + 2, dimensions.height * 0.45);
    const surface = { backgroundColor: theme.colors.surface, borderColor: theme.colors.kilv.rimLine, borderWidth: 1, borderRadius: 6, overflow: 'hidden' as const };
    const close = () => setAnchor(null);

    return <View style={{ gap: 8 }}>
        <Text style={{ ...Typography.default(), fontSize: 16, color: theme.colors.textSecondary }}>{label}</Text>
        <View ref={trigger} collapsable={false} style={surface}>
            <Item title={options.find(option => option.value === value)?.label ?? t('focusMode.selectProject')}
                accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ expanded: anchor !== null, disabled: options.length === 0 }}
                disabled={options.length === 0} showDivider={false}
                rightElement={<Ionicons name="chevron-down" size={18} color={theme.colors.textSecondary} />}
                onPress={() => trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }))} />
        </View>
        {anchor && <Modal transparent animationType="none" onRequestClose={close}>
            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('focusMode.cancel')} onPress={close}
                    style={{ position: 'absolute', inset: 0, backgroundColor: Platform.OS === 'web' ? 'transparent' : theme.colors.kilv.scrim }} />
                <View testID="focus-mode-choices" style={[surface, Platform.OS === 'web' ? {
                    position: 'absolute', width: anchor.width, left: anchor.x,
                    top: anchor.y + anchor.height + menuHeight + 4 <= dimensions.height - 12
                        ? anchor.y + anchor.height + 4 : Math.max(12, anchor.y - menuHeight - 4),
                    shadowColor: theme.colors.shadow.color, shadowOpacity: theme.colors.shadow.opacity,
                    shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
                } : { marginHorizontal: 16, marginBottom: Math.max(safeArea.bottom, 16) }]}>
                    <ScrollView style={{ maxHeight: menuHeight }} keyboardShouldPersistTaps="handled">
                        {options.map((option, index) => <Item key={option.value} title={option.label}
                            accessibilityLabel={option.label} accessibilityRole="button" accessibilityState={{ selected: value === option.value }}
                            selected={value === option.value} showChevron={false} showDivider={index < options.length - 1}
                            rightElement={value === option.value ? <Ionicons name="checkmark" size={18} color={theme.colors.text} /> : undefined}
                            onPress={() => { onSelect(option.value); close(); }} />)}
                    </ScrollView>
                </View>
            </View>
        </Modal>}
    </View>;
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
                        <View style={{ gap: 20, padding: 20, backgroundColor: theme.colors.surface, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.kilv.rimLine }}>
                            <FocusChoice label={t('focusMode.duration')} value={String(minutes)}
                                options={FOCUS_DURATIONS.map(value => ({ value: String(value), label: t('focusMode.durationOption', { minutes: String(value) }) }))}
                                onSelect={value => setMinutes(Number(value))} />
                            <FocusChoice label={t('focusMode.project')} value={projectId}
                                options={projects.map(project => ({ value: project.id, label: project.name }))}
                                onSelect={setProjectId} />
                            {projects.length === 0 && <Text style={{ ...Typography.default(), fontSize: 16, color: theme.colors.textSecondary }}>{t('focusMode.noProjects')}</Text>}
                            <View style={{ gap: 12 }}>
                                <RoundButton title={t('focusMode.start')} disabled={!canStart} onPress={() => {
                                    if (!canStart) return;
                                    setFocusMode({ projectId, endsAt: Date.now() + minutes * 60_000 });
                                    onClose();
                                }} />
                                <RoundButton title={t('focusMode.cancel')} display="inverted" onPress={onClose} />
                            </View>
                        </View>
                    </View>
                </ScrollView>}
            </View>
        </Modal>
    );
}

export function FocusModeControl() {
    const { theme } = useUnistyles();
    const focus = useFocusMode();
    const [, setFocusMode] = useSettingMutable('focusMode');
    const [setupOpen, setSetupOpen] = React.useState(false);
    const [now, setNow] = React.useState(Date.now);
    React.useEffect(() => {
        if (!focus) return;
        setNow(Date.now());
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [focus]);
    const time = formatFocusRemaining(getFocusRemainingSeconds(focus, now));

    return <>
        {focus ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text testID="focus-mode-timer" accessibilityLabel={t('focusMode.remaining', { time })}
                style={{ ...Typography.mono(), color: theme.colors.header.tint, fontSize: 16, fontVariant: ['tabular-nums'] }}>{time}</Text>
            <Pressable testID="focus-mode-exit" accessibilityRole="button" accessibilityLabel={t('focusMode.exit')}
                onPress={() => setFocusMode(null)} style={{ minWidth: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={22} color={theme.colors.header.tint} />
            </Pressable>
        </View> : <Pressable testID="focus-mode-enter" accessibilityRole="button" accessibilityLabel={t('focusMode.enter')}
            onPress={() => setSetupOpen(true)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <TomatoIcon />
        </Pressable>}
        {setupOpen && <FocusModeSetup onClose={() => setSetupOpen(false)} />}
    </>;
}
