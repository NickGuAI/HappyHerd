import * as React from 'react';
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useUnistyles } from 'react-native-unistyles';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProjects, useSettingMutable } from '@/sync/storage';
import { FOCUS_DURATIONS, formatFocusRemaining, getFocusRemainingSeconds } from '@/sync/focusMode';
import { useFocusMode } from '@/hooks/useFocusMode';
import { t } from '@/text';

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
                        <Text accessibilityRole="header" style={{ fontSize: dimensions.width < 600 ? 36 : 56, lineHeight: dimensions.width < 600 ? 44 : 64, fontWeight: '600', color: ink }}>
                            {t('focusMode.title')}
                        </Text>
                        <View style={{ gap: 8 }}>
                            <Text style={{ fontSize: 16, color: ink }}>{t('focusMode.duration')}</Text>
                            <Picker accessibilityLabel={t('focusMode.duration')} selectedValue={minutes} onValueChange={value => setMinutes(Number(value))}
                                style={{ color: ink, backgroundColor: theme.colors.kilv.moltenCore, fontSize: 16, minHeight: 48 }} itemStyle={{ color: ink, fontSize: 18 }}>
                                {FOCUS_DURATIONS.map(value => <Picker.Item key={value} value={value} label={t('focusMode.durationOption', { minutes: String(value) })} />)}
                            </Picker>
                        </View>
                        <View style={{ gap: 8 }}>
                            <Text style={{ fontSize: 16, color: ink }}>{t('focusMode.project')}</Text>
                            <Picker accessibilityLabel={t('focusMode.project')} selectedValue={projectId} onValueChange={value => setProjectId(String(value))}
                                style={{ color: ink, backgroundColor: theme.colors.kilv.moltenCore, fontSize: 16, minHeight: 48 }} itemStyle={{ color: ink, fontSize: 18 }}>
                                <Picker.Item value="" label={t('focusMode.selectProject')} />
                                {projects.map(project => <Picker.Item key={project.id} value={project.id} label={project.name} />)}
                            </Picker>
                            {projects.length === 0 && <Text style={{ fontSize: 16, color: ink }}>{t('focusMode.noProjects')}</Text>}
                        </View>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('focusMode.start')} disabled={!canStart}
                            onPress={() => {
                                if (!canStart) return;
                                setFocusMode({ projectId, endsAt: Date.now() + minutes * 60_000 });
                                onClose();
                            }}
                            style={{ minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ink, borderRadius: 6, opacity: canStart ? 1 : 0.4 }}>
                            <Text style={{ fontSize: 18, fontWeight: '600', color: theme.colors.kilv.moltenCore }}>{t('focusMode.start')}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={t('focusMode.cancel')} onPress={onClose}
                            style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 16, color: ink }}>{t('focusMode.cancel')}</Text>
                        </Pressable>
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
                style={{ color: theme.colors.header.tint, fontSize: 16, fontVariant: ['tabular-nums'] }}>{time}</Text>
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
