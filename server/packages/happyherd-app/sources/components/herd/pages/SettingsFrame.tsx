import * as React from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';

/**
 * Desktop Settings layout (UI overhaul): a left-hand section list with the
 * selected page beside it. Each settings route keeps its own screen and URL;
 * phones and narrow windows keep the stacked navigation unchanged.
 */

export type SettingsSectionId =
    | 'general'
    | 'account'
    | 'streamline'
    | 'appearance'
    | 'agents'
    | 'credentials'
    | 'connections'
    | 'features'
    | 'usage'
    | 'voice'
    | 'language';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type SettingsNavEntry = {
    id: string;
    route: string;
    icon: IconName;
    title: () => string;
    /** Shown only when experiments are on (matches the Settings list). */
    experimental?: boolean;
};

/**
 * Section order of the desktop list. The Streamline settings page, when it
 * lands, is inserted directly after Account.
 */
export const SETTINGS_SECTIONS: readonly SettingsNavEntry[] = [
    { id: 'general', route: '/settings', icon: 'settings-outline', title: () => t('settings.title') },
    { id: 'account', route: '/settings/account', icon: 'person-circle-outline', title: () => t('settings.account') },
    { id: 'streamline', route: '/settings/streamline', icon: 'flash-outline', title: () => t('newSession.streamline.modeStreamline') },
    { id: 'appearance', route: '/settings/appearance', icon: 'color-palette-outline', title: () => t('settings.appearance') },
    { id: 'agents', route: '/settings/agents', icon: 'options-outline', title: () => t('uiCopy.agentDefaults') },
    { id: 'credentials', route: '/settings/credentials', icon: 'key-outline', title: () => t('settingsCredentials.title') },
    { id: 'connections', route: '/settings/connections', icon: 'link-outline', title: () => t('devicePairing.title') },
    { id: 'features', route: '/settings/features', icon: 'flask-outline', title: () => t('settings.featuresTitle') },
    { id: 'usage', route: '/settings/usage', icon: 'analytics-outline', title: () => t('settings.usage'), experimental: true },
    { id: 'voice', route: '/settings/voice', icon: 'mic-outline', title: () => t('settings.voiceAssistant') },
    { id: 'language', route: '/settings/language', icon: 'language-outline', title: () => t('settingsLanguage.title') },
];

export const SETTINGS_ABOUT_LINKS: readonly SettingsNavEntry[] = [
    { id: 'commanders', route: '/commanders', icon: 'people-outline', title: () => t('happyHerd.commander.category') },
    { id: 'whatsNew', route: '/changelog', icon: 'sparkles-outline', title: () => t('settings.whatsNew') },
];

/** Window width from which Settings shows the section list beside the page. */
export const SETTINGS_FRAME_MIN_WIDTH = 1000;

export function useSettingsFrameVisible(): boolean {
    const { width } = useWindowDimensions();
    return (Platform.OS === 'web' || Platform.OS === 'macos') && width >= SETTINGS_FRAME_MIN_WIDTH;
}

function NavItem({ entry, active, onPress }: { entry: SettingsNavEntry; active: boolean; onPress: () => void }) {
    const { theme } = useUnistyles();
    const title = entry.title();
    return (
        <Pressable
            testID={`settings-nav-${entry.id}`}
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            onPress={onPress}
            style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && styles.itemPressed]}
        >
            {active ? <View style={styles.activeBar} /> : null}
            <Ionicons name={entry.icon} size={16} color={active ? theme.colors.textLink : theme.colors.textSecondary} />
            <Text numberOfLines={1} style={[styles.itemText, active && styles.itemTextActive]}>{title}</Text>
        </Pressable>
    );
}

export function SettingsNav({ active }: { active: SettingsSectionId }) {
    const router = useRouter();
    const experiments = useSetting('experiments');
    const sections = SETTINGS_SECTIONS.filter((entry) => !entry.experimental || experiments);
    const open = (entry: SettingsNavEntry) => {
        if (entry.id !== active) router.navigate(entry.route as never);
    };
    return (
        <ScrollView
            testID="settings-nav"
            role="navigation"
            accessibilityLabel={t('settings.sectionsLabel')}
            style={styles.nav}
            contentContainerStyle={styles.navContent}
        >
            <Text style={[styles.sectionLabel, styles.sectionLabelFirst]}>{t('settings.title')}</Text>
            {sections.map((entry) => (
                <NavItem key={entry.id} entry={entry} active={entry.id === active} onPress={() => open(entry)} />
            ))}
            <Text style={styles.sectionLabel}>{t('settings.about')}</Text>
            {SETTINGS_ABOUT_LINKS.map((entry) => (
                <NavItem key={entry.id} entry={entry} active={false} onPress={() => open(entry)} />
            ))}
        </ScrollView>
    );
}

export function SettingsFrame({ section, children }: { section: SettingsSectionId; children: React.ReactNode }) {
    const visible = useSettingsFrameVisible();
    if (!visible) return <>{children}</>;
    return (
        <View testID="settings-frame" style={styles.frame}>
            <SettingsNav active={section} />
            <View style={styles.body}>{children}</View>
        </View>
    );
}

/** Wraps a settings route's screen in the desktop frame without touching its body. */
export function withSettingsFrame<P extends object>(section: SettingsSectionId, Screen: React.ComponentType<P>) {
    function SettingsFramedScreen(props: P) {
        return (
            <SettingsFrame section={section}>
                <Screen {...props} />
            </SettingsFrame>
        );
    }
    SettingsFramedScreen.displayName = `withSettingsFrame(${section})`;
    return SettingsFramedScreen;
}

const styles = StyleSheet.create((theme) => ({
    frame: {
        flex: 1,
        flexDirection: 'row',
        backgroundColor: theme.colors.groupped.background,
    },
    nav: {
        width: 250,
        flexGrow: 0,
        flexShrink: 0,
        borderRightWidth: 1,
        borderRightColor: theme.colors.divider,
    },
    navContent: {
        paddingHorizontal: 10,
        paddingTop: 18,
        paddingBottom: 24,
    },
    body: {
        flex: 1,
        minWidth: 0,
        _web: { _classNames: herdWebClasses('herd-fade') },
    },
    sectionLabel: {
        ...Typography.mono('semiBold'),
        paddingHorizontal: 12,
        paddingTop: 14,
        paddingBottom: 6,
        fontSize: 10.5,
        lineHeight: 14,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: theme.colors.textLink,
    },
    sectionLabelFirst: {
        paddingTop: 0,
    },
    item: {
        height: 38,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingHorizontal: 12,
        borderRadius: theme.kilv.radius,
        _web: {
            _classNames: herdWebClasses('herd-transition'),
            cursor: 'pointer',
            _hover: { backgroundColor: theme.colors.surfacePressedOverlay },
        },
    },
    itemActive: {
        backgroundColor: theme.colors.surfaceHighest,
    },
    itemPressed: {
        opacity: 0.8,
    },
    activeBar: {
        position: 'absolute',
        left: 0,
        top: 9,
        bottom: 9,
        width: 2,
        borderRadius: 1,
        backgroundColor: theme.colors.kilv.accent,
        _web: { boxShadow: theme.kilv.glowMoltenSoft },
    },
    itemText: {
        ...Typography.default(),
        flex: 1,
        minWidth: 0,
        fontSize: 14.5,
        color: theme.colors.textSecondary,
    },
    itemTextActive: {
        color: theme.colors.text,
    },
}));
