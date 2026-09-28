import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons, Octicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { getLatestTitle } from '@/changelog/parser';
import { Typography } from '@/constants/Typography';
import { herdStaggerClass, herdWebClasses } from '@/components/herd/motion';
import { herdAlpha } from '@/components/herd/session/color';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';
import { HerdBrandMark, HerdHorizon } from './HerdLandingArt';

type LandingAction = {
    key: string;
    label: string;
    icon: 'pencil' | 'zap' | 'columns';
    primary?: boolean;
    onPress: () => void;
};

/**
 * The signed-in landing (UI overhaul, from the approved mock): the desktop and
 * tablet main area while no session is open. The brush mark, the product name
 * and a line on what to do rise in over the horizon, followed by the three
 * starting points and the latest What's New entry. Phones show the session
 * list instead (herd/mobile/PhoneHome).
 */
export const HerdLanding = React.memo(function HerdLanding() {
    const { theme } = useUnistyles();
    const router = useRouter();
    // Workspace keeps the gate the left panel's Workspace entry has.
    const machineWorkspace = useSetting('machineWorkspace');
    const latestTitle = React.useMemo(() => getLatestTitle(), []);

    const actions: LandingAction[] = [
        { key: 'new', label: t('newSession.title'), icon: 'pencil', primary: true, onPress: () => router.navigate('/new') },
        { key: 'automations', label: t('happyHerd.automations.title'), icon: 'zap', onPress: () => router.push('/automations') },
        ...(machineWorkspace
            ? [{ key: 'workspace', label: t('workspace.title'), icon: 'columns' as const, onPress: () => router.push('/workspace') }]
            : []),
    ];

    return (
        <View style={styles.root} testID="herd-landing">
            <HerdHorizon />
            <View style={styles.rise(0)}>
                <HerdBrandMark size={88} />
            </View>
            <View style={styles.rise(1)}>
                <Text accessibilityRole="header" style={styles.title}>{t('sidebar.sessionsTitle')}</Text>
            </View>
            <View style={styles.rise(2)}>
                <Text style={styles.subtitle}>{t('uiCopy.startANewSessionOnAnyOfYourConnectedMachines')}</Text>
            </View>
            <View style={styles.actions(3)}>
                {actions.map((action) => (
                    <Pressable
                        key={action.key}
                        accessibilityRole="button"
                        accessibilityLabel={action.label}
                        onPress={action.onPress}
                        testID={`herd-landing-${action.key}`}
                        style={({ hovered, pressed }: any) => [
                            styles.button,
                            action.primary && styles.buttonPrimary,
                            hovered && (action.primary ? styles.buttonPrimaryHovered : styles.buttonHovered),
                            pressed && styles.buttonPressed,
                        ]}
                    >
                        {({ hovered }: any) => {
                            const color = action.primary
                                ? theme.colors.kilv.accentInk
                                : hovered ? theme.colors.kilv.ink : theme.colors.kilv.inkDim;
                            return (
                                <>
                                    <Octicons name={action.icon} size={17} color={color} />
                                    <Text style={[styles.buttonText, action.primary && styles.buttonTextPrimary, { color }]}>
                                        {action.label}
                                    </Text>
                                </>
                            );
                        }}
                    </Pressable>
                ))}
            </View>
            {latestTitle ? (
                <View style={styles.rise(4)}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${t('updateBanner.whatsNew')}: ${latestTitle}`}
                        onPress={() => router.push('/changelog')}
                        testID="herd-landing-whats-new"
                        style={({ hovered, pressed }: any) => [
                            styles.whatsNew,
                            hovered && styles.whatsNewHovered,
                            pressed && styles.buttonPressed,
                        ]}
                    >
                        <Ionicons name="sparkles-outline" size={16} color={theme.colors.kilv.accent} />
                        <Text numberOfLines={1} style={styles.whatsNewText}>
                            {t('updateBanner.whatsNew')}
                            {' · '}
                            <Text style={styles.whatsNewTitle}>{latestTitle}</Text>
                        </Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 40,
        backgroundColor: theme.colors.kilv.bg,
    },
    // Each block rises in with the shared motion, one stagger step after the last.
    rise: (index: number) => ({
        alignItems: 'center',
        _web: { _classNames: herdWebClasses('herd-rise', herdStaggerClass(index)) },
    }),
    title: {
        marginTop: 8,
        fontSize: 28,
        // The mock's normal line height for 28 px Space Grotesk.
        lineHeight: 41,
        letterSpacing: -0.56,
        textAlign: 'center',
        color: theme.colors.kilv.ink,
        ...Typography.logo(),
    },
    subtitle: {
        maxWidth: 460,
        fontSize: 15,
        lineHeight: 22,
        textAlign: 'center',
        color: theme.colors.kilv.inkDim,
        ...Typography.default(),
    },
    actions: (index: number) => ({
        marginTop: 10,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
        _web: { _classNames: herdWebClasses('herd-rise', herdStaggerClass(index)) },
    }),
    button: {
        height: 46,
        paddingHorizontal: 20,
        borderRadius: 9,
        borderWidth: 1,
        borderColor: herdAlpha(theme.colors.kilv.hair, 0.55),
        backgroundColor: theme.colors.kilv.bgRaised,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        _web: { cursor: 'pointer', transitionProperty: 'background-color, border-color, box-shadow, transform', transitionDuration: '140ms' },
    },
    buttonPrimary: {
        backgroundColor: theme.colors.kilv.accent,
        borderColor: theme.colors.kilv.accent,
    },
    buttonHovered: {
        borderColor: theme.colors.kilv.rimLine,
    },
    buttonPrimaryHovered: {
        backgroundColor: theme.colors.kilv.accentHot,
        borderColor: theme.colors.kilv.accentHot,
        _web: { boxShadow: `0 0 22px ${herdAlpha(theme.colors.kilv.accent, 0.18)}` },
    },
    buttonPressed: {
        transform: [{ scale: 0.97 }],
    },
    buttonText: {
        fontSize: 16,
        ...Typography.logo(),
    },
    buttonTextPrimary: {
        ...Typography.default('semiBold'),
    },
    whatsNew: {
        // The mock's 18 px on top of the 14 px gap.
        marginTop: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: herdAlpha(theme.colors.kilv.accent, theme.dark ? 0.35 : 0.32),
        backgroundColor: theme.colors.kilv.bgRaised,
        maxWidth: '100%',
        _web: { cursor: 'pointer', transitionProperty: 'border-color, transform', transitionDuration: '140ms' },
    },
    whatsNewHovered: {
        borderColor: theme.colors.kilv.accent,
    },
    whatsNewText: {
        flexShrink: 1,
        fontSize: 15,
        lineHeight: 22,
        color: theme.colors.kilv.ink,
        ...Typography.default(),
    },
    whatsNewTitle: {
        color: theme.colors.kilv.inkFaint,
    },
}));
