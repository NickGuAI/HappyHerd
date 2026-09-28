import * as React from 'react';
import { Animated, View, Text, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { layout } from '../layout';
import { isRunningOnMac } from '@/utils/platform';
import { useHeaderHeight, useIsTablet } from '@/utils/responsive';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { MobileGlassSurface } from '../MobileGlass';
import {
    MobileHeaderScrim,
    MOBILE_HOME_SCRIM_OVERLAY_OPACITY,
    MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY,
    MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY,
    type MobileHeaderScrimVariant,
} from './MobileHeaderScrim';
import {
    MOBILE_GLASS_CONTROL_SIZE,
    MOBILE_GLASS_HEADER_HEIGHT,
} from './headerMetrics';
import { HerdWindowInsetsContext } from '../herd/shell/windowInsets';
import { useHerdPhoneLayout } from '../herd/mobile/useHerdPhone';

interface HeaderProps {
    title?: React.ReactNode;
    subtitle?: string;
    headerLeft?: (() => React.ReactNode) | null;
    headerLeftGlass?: boolean;
    headerRight?: (() => React.ReactNode) | null;
    headerRightGlass?: boolean;
    headerStyle?: any;
    headerTitleStyle?: any;
    headerSubtitleStyle?: any;
    headerTintColor?: string;
    headerBackgroundColor?: string;
    headerShadowVisible?: boolean;
    headerTransparent?: boolean;
    headerBackdropVisible?: boolean;
    headerBackdropAlwaysVisible?: boolean;
    headerBackdropVariant?: MobileHeaderScrimVariant;
    mobileTitleSurface?: 'glass' | 'plain';
    mobileTitleAlignment?: 'start' | 'center';
    /** Navigation's explicit alignment applies on phones, tablets and desktop. */
    titleAlignment?: 'start' | 'center';
    safeAreaEnabled?: boolean;
}

export const Header = React.memo((props: HeaderProps) => {
    const styles = stylesheet;

    const {
        title,
        subtitle,
        headerLeft,
        headerLeftGlass = false,
        headerRight,
        headerRightGlass = true,
        headerStyle,
        headerTitleStyle,
        headerSubtitleStyle,
        headerTintColor, // Accept but ignore - using theme instead
        headerBackgroundColor, // Accept but ignore - using theme instead
        headerShadowVisible = true,
        headerTransparent = false,
        headerBackdropVisible = false,
        headerBackdropAlwaysVisible = false,
        headerBackdropVariant = 'subtle',
        mobileTitleSurface = 'glass',
        mobileTitleAlignment = 'start',
        titleAlignment,
        safeAreaEnabled = true,
    } = props;

    const insets = useSafeAreaInsets();
    const paddingTop = safeAreaEnabled ? insets.top : 0;
    const headerHeight = useHeaderHeight();
    const isTablet = useIsTablet();
    const phoneLayout = useHerdPhoneLayout();
    const isDesktop = Platform.OS === 'web' || isRunningOnMac();
    const isNativePhone = !isDesktop && !isTablet;
    // UI overhaul: Web at phone size gets the full-width back bar (56 px, hairline).
    const isWebPhone = Platform.OS === 'web' && phoneLayout;
    // Signed in, a phone header sits under the HappyHerd top bar: it reads as the
    // page's title row, with Back on the 16 px gutter and no glass or hairline.
    const underTopBar = React.useContext(HerdWindowInsetsContext) !== null;
    const phoneShellHeader = phoneLayout && underTopBar;
    const glassControlsEnabled = isNativePhone && Platform.OS === 'ios' && !phoneShellHeader;
    const isAndroidHeader = isNativePhone && Platform.OS === 'android';
    const headerLeftUsesGlass = headerLeftGlass && glassControlsEnabled;
    const headerRightUsesGlass = headerRightGlass && glassControlsEnabled;
    const contentHeight = glassControlsEnabled ? Math.max(headerHeight, MOBILE_GLASS_HEADER_HEIGHT) : headerHeight;
    const centerTitle = (titleAlignment ?? (isNativePhone ? mobileTitleAlignment : 'start')) === 'center';
    const homeBackdrop = headerBackdropVariant === 'home';
    const strongBackdrop = headerBackdropVariant !== 'subtle';
    // Mount/unmount fade only - it must land on exactly 1, because a
    // translucent ancestor kills the native blur underneath it. How heavy the
    // scrim reads is carried by backdropStrength, which the scrim applies to
    // its dim gradient alone.
    const backdropShouldBeVisible = glassControlsEnabled && (
        headerBackdropAlwaysVisible || (!homeBackdrop && headerBackdropVisible)
    );
    const backdropStrengthTarget = homeBackdrop
        ? MOBILE_HOME_SCRIM_OVERLAY_OPACITY
        : strongBackdrop
            ? headerBackdropVisible
                ? MOBILE_STRONG_HEADER_SCRIM_UNDERLAP_OPACITY
                : MOBILE_STRONG_HEADER_SCRIM_RESTING_OPACITY
            : 1;
    const backdropOpacity = React.useRef(new Animated.Value(backdropShouldBeVisible ? 1 : 0)).current;
    const backdropStrength = React.useRef(new Animated.Value(backdropStrengthTarget)).current;
    const [backdropMounted, setBackdropMounted] = React.useState(backdropShouldBeVisible);

    React.useEffect(() => {
        if (!glassControlsEnabled) {
            setBackdropMounted(false);
            return;
        }

        if (backdropShouldBeVisible) {
            setBackdropMounted(true);
        }
        Animated.timing(backdropStrength, {
            toValue: backdropStrengthTarget,
            duration: 200,
            useNativeDriver: true,
        }).start();
        Animated.timing(backdropOpacity, {
            toValue: backdropShouldBeVisible ? 1 : 0,
            duration: 200,
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished && !backdropShouldBeVisible) {
                setBackdropMounted(false);
            }
        });
    }, [backdropOpacity, backdropShouldBeVisible, backdropStrength, backdropStrengthTarget, glassControlsEnabled]);

    const containerStyle = [
        styles.container,
        headerTransparent && !isAndroidHeader && styles.containerTransparent,
        (!headerTransparent || isAndroidHeader) && styles.containerNormal,
        isAndroidHeader && headerBackdropVisible && styles.containerAndroidScrolled,
        {
            paddingTop,
        },
        headerShadowVisible && !isWebPhone && styles.shadow,
        headerStyle,
        isAndroidHeader && (headerBackdropVisible ? styles.containerAndroidScrolled : styles.containerNormal),
        glassControlsEnabled && styles.containerTransparent,
        isWebPhone && styles.webPhoneContainer,
        phoneShellHeader && styles.phoneShellContainer,
    ];

    const subtitleStyle = [
        styles.subtitle,
        isDesktop && styles.desktopSubtitle,
        isWebPhone && styles.webPhoneSubtitle,
        headerSubtitleStyle,
    ];
    const titleContent = (
        <>
            {title}
            {subtitle && <Text style={subtitleStyle} numberOfLines={1}>{subtitle}</Text>}
        </>
    );

    return (
        <View style={containerStyle}>
            {glassControlsEnabled && backdropMounted && (
                <Animated.View
                    pointerEvents="none"
                    style={[
                        styles.headerBackdrop,
                        homeBackdrop
                            ? styles.headerBackdropHome
                            : strongBackdrop && styles.headerBackdropStrong,
                        { opacity: backdropOpacity },
                    ]}
                >
                    <MobileHeaderScrim
                        variant={headerBackdropVariant}
                        overlayOpacity={backdropStrength}
                    />
                </Animated.View>
            )}
            <View style={styles.contentWrapper}>
                <View style={[
                    styles.content,
                    isDesktop && styles.desktopContent,
                    isWebPhone && styles.webPhoneContent,
                    phoneShellHeader && styles.phoneShellContent,
                    centerTitle && styles.centeredContent,
                    { height: isWebPhone ? WEB_PHONE_HEADER_HEIGHT : contentHeight },
                ]}>
                    <View style={styles.leftContainer}>
                        {headerLeft && headerLeftUsesGlass && (
                            <MobileGlassSurface
                                enabled={glassControlsEnabled}
                                interactive
                                material="static"
                                intensity={76}
                                style={styles.leftControlGlass}
                            >
                                <View style={styles.leftControlContent}>
                                    {headerLeft()}
                                </View>
                            </MobileGlassSurface>
                        )}
                        {headerLeft && !headerLeftUsesGlass && (
                            isAndroidHeader
                                ? <View style={styles.androidControlSlot}>{headerLeft()}</View>
                                : headerLeft()
                        )}
                    </View>

                    <View style={[
                        styles.centerContainer,
                        isDesktop && styles.desktopCenterContainer,
                        isWebPhone && styles.webPhoneCenterContainer,
                        phoneShellHeader && styles.phoneShellCenterContainer,
                        centerTitle && styles.centeredTitleContainer,
                    ]}>
                        {glassControlsEnabled && mobileTitleSurface === 'glass' ? (
                            <MobileGlassSurface
                                enabled={glassControlsEnabled}
                                nativeEffect
                                material="static"
                                intensity={76}
                                style={styles.mobileTitlePill}
                            >
                                {titleContent}
                            </MobileGlassSurface>
                        ) : titleContent}
                    </View>

                    <View style={styles.rightContainer}>
                        {headerRight && headerRightUsesGlass && (
                            // `interactive`, not `nativeEffect`: it puts this on
                            // the exact same surface path as the left control,
                            // press feedback included.
                            <MobileGlassSurface
                                enabled={glassControlsEnabled}
                                interactive
                                material="static"
                                intensity={76}
                                style={styles.rightControlGlass}
                            >
                                <View style={styles.rightControlContent}>
                                    {headerRight()}
                                </View>
                            </MobileGlassSurface>
                        )}
                        {headerRight && !headerRightUsesGlass && (
                            isAndroidHeader
                                ? <View style={styles.androidControlSlot}>{headerRight()}</View>
                                : headerRight()
                        )}
                    </View>
                </View>
            </View>
        </View>
    );
});

// Extended navigation options to support subtitle
interface ExtendedNavigationOptions extends Partial<NativeStackHeaderProps['options']> {
    headerSubtitle?: string;
    headerSubtitleStyle?: any;
}

// Default back button component
const DefaultBackButton: React.FC<{ tintColor?: string; onPress: () => void }> = ({ tintColor = '#000', onPress }) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const phoneLayout = useHerdPhoneLayout();
    const underTopBar = React.useContext(HerdWindowInsetsContext) !== null;
    if (phoneLayout && underTopBar) {
        // Phones under the top bar (UI overhaul), web and native: the mock's
        // arrow in a 44 px square, its icon on the 16 px gutter.
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onPress}
                hitSlop={4}
                testID="header-back"
                style={({ pressed, hovered }: any) => [
                    styles.webPhoneBackButton,
                    styles.phoneShellBackButton,
                    (pressed || hovered) && styles.webPhoneBackButtonActive,
                ]}
            >
                <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
            </Pressable>
        );
    }
    if (Platform.OS === 'web' && phoneLayout) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.back')}
                onPress={onPress}
                hitSlop={4}
                testID="header-back"
                style={({ pressed, hovered }: any) => [
                    styles.webPhoneBackButton,
                    (pressed || hovered) && styles.webPhoneBackButtonActive,
                ]}
            >
                <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
            </Pressable>
        );
    }
    if (Platform.OS === 'web' || isRunningOnMac()) {
        return (
            <Pressable onPress={onPress} hitSlop={15}>
                <Ionicons name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'} size={24} color={tintColor} />
            </Pressable>
        );
    }

    if (Platform.OS === 'android') {
        return (
            <Pressable
                onPress={onPress}
                hitSlop={8}
                style={({ pressed }) => [styles.androidBackButton, pressed && styles.controlPressed]}
            >
                <Ionicons name="arrow-back" size={24} color={tintColor} />
            </Pressable>
        );
    }

    return (
        <Pressable
            onPress={onPress}
            hitSlop={10}
            style={({ pressed }) => [styles.backButton, pressed && styles.controlPressed]}
        >
            <MobileGlassSurface
                interactive
                material="static"
                intensity={76}
                style={styles.backButtonGlass}
            >
                <Ionicons
                    name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                    size={24}
                    color={tintColor}
                />
            </MobileGlassSurface>
        </Pressable>
    );
};

// Component wrapper for navigation header
type NavigationHeaderComponentProps = NativeStackHeaderProps & {
    mobileTitleSurfaceOverride?: HeaderProps['mobileTitleSurface'];
};

const NavigationHeaderComponent: React.FC<NavigationHeaderComponentProps> = React.memo((props) => {
    const { options, route, back, navigation } = props;
    const extendedOptions = options as ExtendedNavigationOptions;
    const phoneLayout = useHerdPhoneLayout();
    const isDesktop = Platform.OS === 'web' || isRunningOnMac();
    const isWebPhone = Platform.OS === 'web' && phoneLayout;
    const underTopBar = React.useContext(HerdWindowInsetsContext) !== null;
    // Phones under the top bar (UI overhaul): the title row carries the page's
    // title, left-aligned at 24 px, or 22 px beside Back.
    const phoneShell = phoneLayout && underTopBar;

    // The web hides Back from 700 px wide: the browser keeps history. Native tablets,
    // the iOS app on a Mac included, show it (owner decision, 2026-09-27). Phones
    // hide it on the drawer's own destinations through `headerBackVisible` ((app)/_layout).
    const shouldHideBackButton = Platform.OS === 'web' && !phoneLayout;
    const showsBack = !!options.headerLeft || (!!back && options.headerBackVisible !== false && !shouldHideBackButton);
    const titleFontSize = phoneShell ? (showsBack ? 22 : 24) : isDesktop && !isWebPhone ? 17 : 16;
    const titleAlign = phoneShell ? 'left' : options.headerTitleAlign ?? (Platform.OS === 'ios' ? 'center' : 'left');

    // Extract title - handle both string and function types
    let title: React.ReactNode | null = null;
    if (options.headerTitle) {
        if (typeof options.headerTitle === 'string') {
            title = (
                <Text
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[
                        {
                            fontSize: titleFontSize,
                            fontWeight: '600',
                            textAlign: titleAlign,
                            color: options.headerTintColor || '#000',
                            maxWidth: '100%',
                            flexShrink: 1,
                        },
                        Typography.default('semiBold'),
                        options.headerTitleStyle
                    ]}
                >
                    {options.headerTitle}
                </Text>
            );
        } else if (typeof options.headerTitle === 'function') {
            // Handle function type headerTitle
            title = options.headerTitle({ children: route.name, tintColor: options.headerTintColor });
        }
    } else if (typeof options.title === 'string') {
        title = (
            <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                    { fontSize: phoneShell ? titleFontSize : isWebPhone ? 16 : 17, fontWeight: '600', textAlign: titleAlign, color: options.headerTintColor || '#000', maxWidth: '100%', flexShrink: 1 },
                    Typography.default('semiBold'),
                    options.headerTitleStyle
                ]}
            >
                {options.title}
            </Text>
        );
    }

    // Determine header left content
    let headerLeftContent: (() => React.ReactNode) | undefined | null = null;
    if (options.headerLeft) {
        // Use custom headerLeft if provided
        headerLeftContent = () => options.headerLeft!({ canGoBack: !!back, tintColor: options.headerTintColor });
    } else if (back && options.headerBackVisible !== false && !shouldHideBackButton) {
        // Show default back button if can go back and not explicitly hidden
        // Also hide on tablet when at first or second screen
        headerLeftContent = () => (
            <DefaultBackButton
                tintColor={options.headerTintColor}
                onPress={() => navigation.goBack()}
            />
        );
    }

    return (
        <Header
            title={title}
            subtitle={extendedOptions.headerSubtitle}
            headerLeft={headerLeftContent}
            headerRight={options.headerRight ?
                () => options.headerRight!({ canGoBack: !!back, tintColor: options.headerTintColor }) :
                undefined
            }
            headerStyle={options.headerStyle}
            headerTitleStyle={options.headerTitleStyle}
            headerSubtitleStyle={extendedOptions.headerSubtitleStyle}
            headerShadowVisible={options.headerShadowVisible}
            headerTransparent={options.headerTransparent}
            headerBackdropAlwaysVisible={Platform.OS === 'ios'}
            headerBackdropVariant="strong"
            mobileTitleSurface={props.mobileTitleSurfaceOverride}
            mobileTitleAlignment={titleAlign === 'center' ? 'center' : 'start'}
            titleAlignment={titleAlign === 'center' ? 'center' : 'start'}
        />
    );
});

// Export a render function for React Navigation
export const createHeader = (props: NativeStackHeaderProps) => {
    if (props.options.headerShown === false) {
        return null;
    }
    return <NavigationHeaderComponent {...props} />;
};

// Detail screens keep the same centered geometry as Home, but the title is
// ordinary text rather than another control.
export const createPlainHeader = (props: NativeStackHeaderProps) => {
    if (props.options.headerShown === false) {
        return null;
    }
    return <NavigationHeaderComponent {...props} mobileTitleSurfaceOverride="plain" />;
};

/** Web at phone size: the mock's back bar height. */
const WEB_PHONE_HEADER_HEIGHT = 56;

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        position: 'relative',
        zIndex: 100,
    },
    // UI overhaul, Web at phone size: an opaque raised bar with a hairline, no shadow.
    webPhoneContainer: {
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    webPhoneContent: {
        gap: 6,
        paddingLeft: 10,
        paddingRight: 8,
    },
    webPhoneCenterContainer: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingHorizontal: 4,
    },
    webPhoneSubtitle: {
        marginTop: 1,
        fontSize: 12,
        lineHeight: 16,
        color: theme.colors.kilv.inkFaint,
    },
    webPhoneBackButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: theme.kilv.radius,
        _web: { cursor: 'pointer' },
    },
    webPhoneBackButtonActive: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    // Signed-in phones: the title row under the top bar. Back is a 44 px square
    // whose chevron lands on the 16 px gutter; a title without Back starts there too.
    // Opaque, in the page's own colour: without glass, content must not show through when it scrolls under.
    phoneShellContainer: {
        borderBottomWidth: 0,
        backgroundColor: Platform.OS === 'web' ? theme.colors.surface : theme.colors.groupped.background,
    },
    phoneShellBackButton: {
        width: 44,
        height: 44,
    },
    // The row ends 4 px from the edge, so a 44 px control's icon lands on the gutter.
    phoneShellContent: {
        paddingLeft: 5,
        paddingRight: 4,
    },
    phoneShellCenterContainer: {
        paddingHorizontal: 5,
    },
    containerTransparent: {
        backgroundColor: 'transparent',
    },
    containerNormal: {
        backgroundColor: theme.colors.header.background,
    },
    containerAndroidScrolled: {
        backgroundColor: theme.colors.surfaceHigh,
    },
    // Backdrops are material layers behind floating controls. The Home variant
    // stays stable while content scrolls; other headers may still opt into a
    // stronger underlap state.
    headerBackdrop: {
        ...StyleSheet.absoluteFillObject,
    },
    headerBackdropStrong: {
        bottom: -8,
    },
    headerBackdropHome: {
        bottom: -8,
    },
    contentWrapper: {
        width: '100%',
        alignItems: 'center',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Platform.OS === 'web' ? 0 : 8,
        paddingHorizontal: 16,
        width: '100%',
        maxWidth: layout.headerMaxWidth,
    },
    centeredContent: {
        justifyContent: 'space-between',
    },
    desktopContent: {
        gap: 0,
        paddingHorizontal: Platform.select({ ios: 8, default: 16 }),
    },
    leftContainer: {
        flexGrow: 0,
        flexShrink: 0,
        alignItems: 'flex-start',
    },
    centerContainer: {
        flexGrow: 1,
        flexBasis: 0,
        alignSelf: 'stretch',
        flexDirection: Platform.OS === 'web' ? 'row' : 'column',
        alignItems: Platform.OS === 'web' ? 'center' : 'flex-start',
        justifyContent: Platform.OS === 'web' ? 'flex-start' : 'center',
        paddingHorizontal: Platform.OS === 'web' ? 12 : 0,
        minWidth: Platform.OS === 'web' ? undefined : 0,
    },
    centeredTitleContainer: {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 64,
        right: 64,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 0,
    },
    desktopCenterContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: Platform.OS === 'ios' ? 'center' : 'flex-start',
        paddingHorizontal: 12,
        minWidth: undefined,
    },
    mobileTitlePill: {
        maxWidth: '100%',
        height: MOBILE_GLASS_CONTROL_SIZE,
        minWidth: 0,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        borderRadius: 4,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: theme.dark ? 0.24 : 0.06,
        shadowRadius: 20,
    },
    rightContainer: {
        flexGrow: 0,
        flexShrink: 0,
        alignItems: 'flex-end',
    },
    rightControlGlass: {
        minWidth: Platform.select({ web: 0, default: MOBILE_GLASS_CONTROL_SIZE }),
        minHeight: Platform.select({ web: 0, default: MOBILE_GLASS_CONTROL_SIZE }),
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: Platform.select({
            web: 'transparent',
            ios: 'transparent',
            android: theme.colors.glass.backgroundStrong,
            default: 'transparent',
        }),
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: Platform.select({ ios: theme.dark ? 0.24 : 0.06, default: 0 }),
        shadowRadius: 20,
        elevation: 0,
    },
    leftControlGlass: {
        width: Platform.select({ web: 36, default: MOBILE_GLASS_CONTROL_SIZE }),
        height: Platform.select({ web: 36, default: MOBILE_GLASS_CONTROL_SIZE }),
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: Platform.select({
            web: 'transparent',
            ios: 'transparent',
            android: theme.colors.glass.backgroundStrong,
            default: 'transparent',
        }),
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: Platform.select({ ios: theme.dark ? 0.24 : 0.06, default: 0 }),
        shadowRadius: 20,
        elevation: 0,
    },
    leftControlContent: {
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    rightControlContent: {
        minHeight: Platform.select({ web: 0, default: MOBILE_GLASS_CONTROL_SIZE }),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 0,
    },
    androidControlSlot: {
        minWidth: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    title: {
        fontSize: Platform.OS === 'web' ? 17 : 16,
        fontWeight: '600',
        textAlign: 'center',
        color: theme.colors.header.tint,
        ...Typography.default('semiBold'),
    },
    subtitle: {
        fontSize: Platform.OS === 'web' ? 13 : 12,
        fontWeight: '400',
        textAlign: 'left',
        marginTop: Platform.OS === 'web' ? 2 : 1,
        color: theme.colors.header.tint,
        ...Typography.default('regular'),
    },
    desktopSubtitle: {
        fontSize: 13,
        textAlign: Platform.OS === 'ios' ? 'center' : 'left',
        marginTop: 2,
    },
    shadow: {
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: theme.colors.shadow.opacity,
        shadowRadius: 3,
        elevation: 4,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.kilv.rimLine,
    },
    backButton: {
        width: Platform.select({ web: 36, default: MOBILE_GLASS_CONTROL_SIZE }),
        height: Platform.select({ web: 36, default: MOBILE_GLASS_CONTROL_SIZE }),
        borderRadius: 4,
    },
    androidBackButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backButtonGlass: {
        width: '100%',
        height: '100%',
        borderRadius: 4,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: Platform.select({
            web: 'transparent',
            ios: 'transparent',
            android: theme.colors.glass.backgroundStrong,
            default: 'transparent',
        }),
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        shadowColor: theme.colors.shadow.color,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: Platform.select({ ios: theme.dark ? 0.24 : 0.06, default: 0 }),
        shadowRadius: 20,
        elevation: 0,
    },
    controlPressed: {
        opacity: 0.68,
        transform: [{ scale: 0.97 }],
    },
}));
