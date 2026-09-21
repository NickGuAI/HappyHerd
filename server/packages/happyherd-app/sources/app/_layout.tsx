import 'react-native-quick-base64';
import '../theme.css';
import * as React from 'react';
import * as SplashScreen from 'expo-splash-screen';
import * as Fonts from 'expo-font';
import * as Notifications from 'expo-notifications';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuthCredentials, TokenStorage } from '@/auth/tokenStorage';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SidebarNavigator } from '@/components/SidebarNavigator';
import sodium from '@/encryption/libsodium.lib';
import { View, Platform, AppState, LogBox } from 'react-native';
import { ModalProvider } from '@/modal';
import { PostHogProvider } from 'posthog-react-native';
import { tracking } from '@/track/tracking';
import { syncRestore } from '@/sync/sync';
import { useTrackScreens } from '@/track/useTrackScreens';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { FaviconPermissionIndicator } from '@/components/web/FaviconPermissionIndicator';
import { CommandPaletteProvider } from '@/components/CommandPalette/CommandPaletteProvider';
import { StatusBarProvider } from '@/components/StatusBarProvider';
// import * as SystemUI from 'expo-system-ui';
import { initConsoleLogging, setConsoleOutputEnabled } from '@/utils/consoleLogging';
import { useLocalSetting, useSetting } from '@/sync/storage';
import { loadAppConfig } from '@/sync/appConfig';
import { useUnistyles } from 'react-native-unistyles';
import { AsyncLock } from '@/utils/lock';
import { getSessionRouteFromNotificationResponse } from '@/utils/notificationRouting';
import { navigateToSession } from '@/hooks/useNavigateToSession';
import { applyVoiceUpsellOverride } from '@/realtime/voiceExperiment';
import { useTauriZoom } from '@/hooks/useTauriZoom';
import { useTauriDrag } from '@/hooks/useTauriDrag';
import { BrowserNavigationShortcuts } from '@/hooks/useBrowserNavigationShortcuts';
import { AccountKeyBackupGate } from '@/components/AccountKeyBackupGate';
import { setCurrentLanguage } from '@/text';

// The RevenueCat SDK logs its failures through console.error, which LogBox
// turns into a red error overlay. Dev builds have no App Store products, so
// "Error fetching offerings" fires on every launch; purchases are optional
// and the failure is already handled in syncPurchases.
if (__DEV__) LogBox.ignoreLogs([/\[RevenueCat\]/]);

// Configure notification handler — suppress push display when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async () => {
        const isForeground = AppState.currentState === 'active';
        return {
            shouldShowAlert: !isForeground,
            shouldPlaySound: !isForeground,
            shouldSetBadge: true,
            shouldShowBanner: !isForeground,
            shouldShowList: true,
        };
    },
});

// Setup Android notification channels (required for Android 8.0+)
if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
    });
    Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
    });
}

export {
    // Catch any errors thrown by the Layout component.
    ErrorBoundary,
} from 'expo-router';

// Configure splash screen
SplashScreen.setOptions({
    fade: true,
    duration: 300,
})
SplashScreen.preventAutoHideAsync();

// Set window background color - now handled by Unistyles
// SystemUI.setBackgroundColorAsync('white');

// Remote logging to local log server (configured via Dev > Log Server setting)
initConsoleLogging()

// Component to apply horizontal safe area padding
function HorizontalSafeAreaWrapper({ children }: { children: React.ReactNode }) {
    const insets = useSafeAreaInsets();
    return (
        <View style={{
            flex: 1,
            paddingLeft: insets.left,
            paddingRight: insets.right
        }}>
            {children}
        </View>
    );
}

let lock = new AsyncLock();
let loaded = false;

function stringifyNotificationPayload(value: unknown): string {
    try {
        const serialized = JSON.stringify(value, null, 2);
        return serialized ?? String(value);
    } catch (error) {
        return `[unserializable notification payload: ${error instanceof Error ? error.message : 'Unknown error'}]`;
    }
}

// Static faces are built from the exact self-hosted KILV sources. One font map
// is shared by native, browser and Tauri so the typography cannot drift.
const appFonts = {
    'SpaceGrotesk-Regular': require('@/assets/fonts/SpaceGrotesk-Regular.ttf'),
    'SpaceGrotesk-Medium': require('@/assets/fonts/SpaceGrotesk-Medium.ttf'),
    'SpaceGrotesk-SemiBold': require('@/assets/fonts/SpaceGrotesk-SemiBold.ttf'),
    'JetBrainsMono-Regular': require('@/assets/fonts/JetBrainsMono-Regular.ttf'),
    'JetBrainsMono-SemiBold': require('@/assets/fonts/JetBrainsMono-SemiBold.ttf'),
    ...FontAwesome.font,
};

async function loadFonts() {
    await lock.inLock(async () => {
        if (loaded) return;
        loaded = true;
        const isTauri = Platform.OS === 'web' &&
            typeof window !== 'undefined' &&
            (window as any).__TAURI_INTERNALS__ !== undefined;

        if (!isTauri) {
            await Fonts.loadAsync(appFonts);
        } else {
            // Preserve the existing Tauri startup boundary: do not block the
            // shell on Font Face Observer in its custom-protocol webview.
            void Fonts.loadAsync(appFonts).catch(() => {});
        }
    });
}

function getDevEnvironmentCredentials(): AuthCredentials | null {
    if (!__DEV__) {
        return null;
    }

    const token = process.env.EXPO_PUBLIC_DEV_TOKEN;
    const secret = process.env.EXPO_PUBLIC_DEV_SECRET;
    if (!token || !secret) {
        return null;
    }

    return { token, secret };
}

function getDevWebQueryCredentials(): AuthCredentials | null {
    if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') {
        return null;
    }

    const params = new URLSearchParams(window.location.search);
    const token = params.get('dev_token');
    const secret = params.get('dev_secret');
    if (!token || !secret) {
        return null;
    }

    return { token, secret };
}

function AccountKeyAccessGate({ children }: { children: React.ReactNode }) {
    const auth = useAuth();
    if (auth.isAuthenticated && auth.accountKeyBackupRequired) {
        return <AccountKeyBackupGate />;
    }
    return children;
}

export default function RootLayout() {
    useTauriZoom();
    useTauriDrag();
    const router = useRouter();
    const { theme } = useUnistyles();
    const preferredLanguage = useSetting('preferredLanguage');
    const activeLanguage = setCurrentLanguage(preferredLanguage);
    const navigationTheme = React.useMemo(() => ({
        ...(theme.dark ? DarkTheme : DefaultTheme),
        colors: {
            ...(theme.dark ? DarkTheme.colors : DefaultTheme.colors),
            primary: theme.colors.textLink,
            background: theme.colors.groupped.background,
            card: theme.colors.surface,
            text: theme.colors.text,
            border: theme.colors.kilv.rimLine,
            notification: theme.colors.warningCritical,
        },
    }), [theme]);

    //
    // Init sequence
    //
    const [initState, setInitState] = React.useState<{
        credentials: AuthCredentials | null;
        accountKeyBackupRequired: boolean;
    } | null>(null);
    React.useEffect(() => {
        (async () => {
            try {
                await loadFonts();
                await sodium.ready;

                let credentials = await TokenStorage.getCredentials();
                let accountKeyBackupRequired = await TokenStorage.getAccountKeyBackupRequired();
                const devCredentials = getDevWebQueryCredentials() ?? getDevEnvironmentCredentials();

                if (devCredentials) {
                    const credentialsChanged = credentials?.token !== devCredentials.token
                        || credentials?.secret !== devCredentials.secret;

                    if (credentialsChanged) {
                        const saved = await TokenStorage.setCredentials(devCredentials);
                        if (saved) {
                            credentials = devCredentials;
                            await TokenStorage.setAccountKeyBackupRequired(false);
                            accountKeyBackupRequired = false;
                        }
                    }

                    if (Platform.OS === 'web' && typeof window !== 'undefined') {
                        window.history.replaceState({}, '', window.location.pathname);
                    }
                }

                if (credentials) {
                    await syncRestore(credentials);
                }

                setInitState({ credentials, accountKeyBackupRequired });
            } catch (error) {
                console.error('Error initializing:', error);
            }
        })();
    }, []);

    React.useEffect(() => {
        if (initState) {
            setTimeout(() => {
                SplashScreen.hideAsync();
            }, 100);
        }
    }, [initState]);

    const handledNotificationIds = React.useRef<Set<string>>(new Set());
    const handleNotificationResponse = React.useCallback(async (response: Notifications.NotificationResponse | null) => {
        if (!response) {
            console.log('[PUSH ROUTING] Notification response is null');
            return;
        }

        console.log('[PUSH ROUTING] Full notification response:\n' + stringifyNotificationPayload(response));

        const responseId = response.notification.request.identifier;
        if (handledNotificationIds.current.has(responseId)) {
            console.log(`[PUSH ROUTING] Duplicate notification response ignored: ${responseId}`);
            return;
        }

        handledNotificationIds.current.add(responseId);

        try {
            if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
                console.log(`[PUSH ROUTING] Ignoring non-default action: ${response.actionIdentifier}`);
                return;
            }

            console.log(
                '[PUSH ROUTING] notification.request.content.data:\n' +
                stringifyNotificationPayload(response.notification.request.content.data)
            );
            const route = getSessionRouteFromNotificationResponse(response);
            console.log(`[PUSH ROUTING] Computed route: ${route ?? 'null'}`);
            if (!route) {
                console.log('[PUSH ROUTING] No session route found in notification.request.content.data');
                return;
            }

            const encodedSessionId = route.replace(/^\/session\//, '');
            const sessionId = (() => {
                try {
                    return decodeURIComponent(encodedSessionId);
                } catch {
                    return encodedSessionId;
                }
            })();
            console.log(`[PUSH ROUTING] Navigating to session: ${sessionId}`);
            navigateToSession(router, sessionId);
        } finally {
            try {
                await Notifications.clearLastNotificationResponseAsync();
            } catch (error) {
                console.log('Failed to clear last notification response:', error);
            }
        }
    }, [router]);

    React.useEffect(() => {
        if (!initState) {
            return;
        }

        let active = true;
        const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
            void handleNotificationResponse(response);
        });

        void (async () => {
            try {
                const response = await Notifications.getLastNotificationResponseAsync();
                if (active) {
                    await handleNotificationResponse(response);
                }
            } catch (error) {
                console.log('Failed to read last notification response:', error);
            }
        })();

        return () => {
            active = false;
            subscription.remove();
        };
    }, [handleNotificationResponse, initState]);


    // Track the screens
    useTrackScreens()

    // Sync console output toggle from Dev screen. Same precedence as
    // initConsoleLogging: user setting OR build-variant default — otherwise
    // the untouched (false) setting silently mutes console.log in dev builds
    // the moment this layout mounts.
    const consoleLoggingEnabled = useLocalSetting('consoleLoggingEnabled');
    const devModeEnabled = __DEV__ || useLocalSetting('devModeEnabled');
    const voiceUpsellOverride = useLocalSetting('voiceUpsellOverride');
    React.useEffect(() => {
        setConsoleOutputEnabled(consoleLoggingEnabled || (loadAppConfig().consoleLoggingDefault ?? false));
    }, [consoleLoggingEnabled]);

    React.useEffect(() => {
        if (!devModeEnabled || !voiceUpsellOverride) {
            return;
        }
        applyVoiceUpsellOverride(voiceUpsellOverride);
    }, [devModeEnabled, voiceUpsellOverride]);

    //
    // Not inited
    //

    if (!initState) {
        return null;
    }

    //
    // Boot
    //

    let providers = (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <KeyboardProvider preload={false}>
                <GestureHandlerRootView
                    style={Platform.OS === 'web'
                        ? { flex: 1 }
                        : { flex: 1, backgroundColor: theme.colors.groupped.background }}
                >
                    <AuthProvider
                        initialCredentials={initState.credentials}
                        initialAccountKeyBackupRequired={initState.accountKeyBackupRequired}
                    >
                        <ThemeProvider value={navigationTheme}>
                            <StatusBarProvider />
                            <ModalProvider>
                                <BrowserNavigationShortcuts />
                                <AccountKeyAccessGate>
                                    <CommandPaletteProvider>
                                        <RealtimeProvider>
                                            <HorizontalSafeAreaWrapper key={activeLanguage}>
                                                <SidebarNavigator />
                                            </HorizontalSafeAreaWrapper>
                                        </RealtimeProvider>
                                    </CommandPaletteProvider>
                                </AccountKeyAccessGate>
                            </ModalProvider>
                        </ThemeProvider>
                    </AuthProvider>
                </GestureHandlerRootView>
            </KeyboardProvider>
        </SafeAreaProvider>
    );
    if (tracking) {
        providers = (
            <PostHogProvider client={tracking}>
                {providers}
            </PostHogProvider>
        );
    }

    return (
        <>
            <FaviconPermissionIndicator />
            {providers}
        </>
    );
}
