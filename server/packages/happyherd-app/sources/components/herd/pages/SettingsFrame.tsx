import * as React from 'react';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { herdWebClasses } from '@/components/herd/motion';
import { layout } from '@/components/layout';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';
import { trackWhatsNewClicked } from '@/track';

/**
 * Desktop Settings layout (UI overhaul): a left-hand section list with the
 * selected page beside it, headed by the page's large title as the mock
 * draws it. Each settings route keeps its own screen and URL; phones and
 * narrow windows keep the stacked navigation and its header, and open
 * Settings on the same list (SettingsSectionList). There is no separate
 * Settings home: every option lives on one of these pages.
 */

export type SettingsSectionId =
    | 'account'
    | 'streamline'
    | 'appearance'
    | 'agents'
    | 'credentials'
    | 'connections'
    | 'features'
    | 'usage'
    | 'voice'
    | 'language'
    | 'about';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type SettingsNavEntry = {
    id: string;
    route: string;
    icon: IconName;
    title: () => string;
    /** Shown only when experiments are on (matches the Settings list). */
    experimental?: boolean;
};

/** Section order of the list, on desktop and in the narrow layouts' Settings page. */
export const SETTINGS_SECTIONS: readonly SettingsNavEntry[] = [
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

/** The ABOUT group: the About page, then two pages outside Settings. */
export const SETTINGS_ABOUT_LINKS: readonly SettingsNavEntry[] = [
    { id: 'about', route: '/settings/about', icon: 'information-circle-outline', title: () => t('settings.about') },
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

/** Settings' What's New entry reports its open, as the old Settings home's row did. */
function trackSettingsEntry(entry: SettingsNavEntry) {
    if (entry.id === 'whatsNew') trackWhatsNewClicked();
}

export function SettingsNav({ active }: { active: SettingsSectionId }) {
    const router = useRouter();
    const pathname = usePathname();
    const experiments = useSetting('experiments');
    const sections = SETTINGS_SECTIONS.filter((entry) => !entry.experimental || experiments);
    // A nested page (Voice language, Claude sign-in) highlights its section;
    // choosing that section still returns to the section's own page.
    const open = (entry: SettingsNavEntry) => {
        trackSettingsEntry(entry);
        if (pathname !== entry.route) router.navigate(entry.route as never);
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
                <NavItem key={entry.id} entry={entry} active={entry.id === active} onPress={() => open(entry)} />
            ))}
        </ScrollView>
    );
}

/**
 * Phones and narrow windows (UI overhaul): Settings opens on the desktop
 * section list as a card, one 48 px row per section and then the ABOUT
 * group's About, Commanders and What's New, each opening its page.
 */
export function SettingsSectionList() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const experiments = useSetting('experiments');
    const entries = [
        ...SETTINGS_SECTIONS.filter((entry) => !entry.experimental || experiments),
        ...SETTINGS_ABOUT_LINKS,
    ];
    return (
        <View role="navigation" accessibilityLabel={t('settings.sectionsLabel')} style={styles.phoneList} testID="settings-section-list">
            {entries.map((entry) => (
                <Pressable
                    key={entry.id}
                    testID={`settings-section-${entry.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={entry.title()}
                    onPress={() => {
                        trackSettingsEntry(entry);
                        router.push(entry.route as never);
                    }}
                    style={({ pressed, hovered }: any) => [styles.phoneRow, (pressed || hovered) && styles.phoneRowPressed]}
                >
                    <Ionicons name={entry.icon} size={18} color={theme.colors.textLink} />
                    <Text numberOfLines={1} style={styles.phoneRowText}>{entry.title()}</Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.colors.kilv.inkFaint} />
                </Pressable>
            ))}
        </View>
    );
}

/**
 * A settings page's control for the right of its title (UI overhaul). Where
 * the frame draws the title, the page's `headerRight` has no header to sit in,
 * so the page hands the frame a component to show beside the title instead.
 */
const SettingsFrameActionContext = React.createContext<React.Dispatch<React.SetStateAction<React.ComponentType | null>> | null>(null);

/** Shows `action` beside the framed page's title; pass a stable component, or null for none. */
export function useSettingsFrameAction(action: React.ComponentType | null) {
    const setAction = React.useContext(SettingsFrameActionContext);
    React.useLayoutEffect(() => {
        if (!setAction) return undefined;
        setAction(() => action);
        return () => setAction(null);
    }, [action, setAction]);
}

function sectionTitle(section: SettingsSectionId): string {
    return ([...SETTINGS_SECTIONS, ...SETTINGS_ABOUT_LINKS].find((entry) => entry.id === section) ?? SETTINGS_SECTIONS[0]).title();
}

export function SettingsFrame({ section, title, children }: { section: SettingsSectionId; title?: () => string; children: React.ReactNode }) {
    const visible = useSettingsFrameVisible();
    const [Action, setAction] = React.useState<React.ComponentType | null>(null);
    if (Platform.OS !== 'web' && Platform.OS !== 'macos') return <>{children}</>;
    // The page keeps the same two parent Views at every width, so crossing the
    // frame width never remounts it and unsaved input survives a resize.
    return (
        <SettingsFrameActionContext.Provider value={setAction}>
            {/* The frame draws the title in the page, so the stack header steps aside while it shows. */}
            <Stack.Screen options={{ headerShown: !visible }} />
            <View testID={visible ? 'settings-frame' : undefined} style={visible ? styles.frame : styles.stack}>
                {visible ? <SettingsNav active={section} /> : null}
                <View style={visible ? styles.body : styles.stack}>
                    {visible ? (
                        <View style={styles.titleRow}>
                            <View style={styles.titleInner}>
                                <Text testID="settings-page-title" role="heading" aria-level={1} accessibilityRole="header" numberOfLines={1} style={styles.title}>
                                    {(title ?? (() => sectionTitle(section)))()}
                                </Text>
                                {Action ? <View style={styles.titleAction}><Action /></View> : null}
                            </View>
                        </View>
                    ) : null}
                    {children}
                </View>
            </View>
        </SettingsFrameActionContext.Provider>
    );
}

/**
 * Wraps a settings route's screen in the desktop frame without touching its
 * body. A nested page passes its own `title`; others take their section's.
 */
export function withSettingsFrame<P extends object>(
    section: SettingsSectionId,
    Screen: React.ComponentType<P>,
    options: { title?: () => string } = {},
) {
    function SettingsFramedScreen(props: P) {
        return (
            <SettingsFrame section={section} title={options.title}>
                <Screen {...props} />
            </SettingsFrame>
        );
    }
    SettingsFramedScreen.displayName = `withSettingsFrame(${section})`;
    return SettingsFramedScreen;
}

const styles = StyleSheet.create((theme) => ({
    stack: {
        flex: 1,
    },
    // Phones: the section list card, its rows' content on the 16 px gutter inside it.
    phoneList: {
        marginHorizontal: 16,
        marginTop: 20,
        padding: 8,
        borderRadius: theme.kilv.radiusCard,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    phoneRow: {
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 8,
        borderRadius: theme.kilv.radius,
        _web: { _classNames: herdWebClasses('herd-transition'), cursor: 'pointer' },
    },
    phoneRowPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    phoneRowText: {
        flex: 1,
        minWidth: 0,
        fontSize: 15,
        lineHeight: 20,
        color: theme.colors.text,
        ...Typography.default(),
    },
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
    // The mock's page title, over the page and on the left edge of its cards.
    titleRow: {
        flexShrink: 0,
        alignItems: 'center',
        backgroundColor: theme.colors.groupped.background,
    },
    titleInner: {
        width: '100%',
        maxWidth: layout.maxWidth,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingTop: 28,
        paddingHorizontal: 16,
    },
    title: {
        ...Typography.default('semiBold'),
        flex: 1,
        minWidth: 0,
        fontSize: 28,
        lineHeight: 34,
        letterSpacing: -0.4,
        color: theme.colors.text,
    },
    titleAction: {
        flexShrink: 0,
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
