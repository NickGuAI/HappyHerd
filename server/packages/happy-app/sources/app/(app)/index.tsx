import { RoundButton } from "@/components/RoundButton";
import { useAuth } from "@/auth/AuthContext";
import { Text, View, ScrollView, useWindowDimensions } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as React from 'react';
import { encodeBase64 } from "@/encryption/base64";
import { authGetToken } from "@/auth/authGetToken";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import { getRandomBytesAsync } from "expo-crypto";
import { Typography } from "@/constants/Typography";
import { trackAccountCreated, trackAccountRestored } from '@/track';
import { HomeHeaderNotAuth } from "@/components/HomeHeader";
import { MainView } from "@/components/MainView";
import { t } from '@/text';
import { accountAccessRoutes } from '@/auth/accountKeyLifecycle';

// Expo Image needs the Unistyles adapter to receive compiled styles on Web.
const Image = withUnistyles(ExpoImage);

export default function Home() {
    const auth = useAuth();
    if (!auth.isAuthenticated) {
        return <NotAuthenticated />;
    }
    return (
        <Authenticated />
    )
}

function Authenticated() {
    return <MainView variant="phone" />;
}

function NotAuthenticated() {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const router = useRouter();
    const { width } = useWindowDimensions();
    const wide = width >= 800;
    const insets = useSafeAreaInsets();

    const createAccount = async () => {
        try {
            const secret = await getRandomBytesAsync(32);
            const token = await authGetToken(secret);
            if (token && secret) {
                await auth.login(token, encodeBase64(secret, 'base64url'), 'new-account');
                trackAccountCreated();
            }
        } catch (error) {
            console.error('Error creating account', error);
        }
    }

    return (
        <>
            <HomeHeaderNotAuth />
            <ScrollView
                style={styles.page}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
            >
                <View style={[styles.hero, wide && styles.heroWide]}>
                    <Image
                        testID="kilv-landing-art"
                        accessible={false}
                        source={wide
                            ? theme.dark ? require('@/assets/images/kilv-band.webp') : require('@/assets/images/kilv-band-light.webp')
                            : theme.dark ? require('@/assets/images/kilv-mark-dark.webp') : require('@/assets/images/kilv-mark-light.webp')}
                        contentFit="cover"
                        style={wide ? styles.wideArtwork : styles.compactArtwork}
                    />
                    <View style={[styles.content, wide && styles.contentWide]}>
                        <Image
                            accessible={false}
                            source={require('@/assets/images/logo-black.png')}
                            contentFit="contain"
                            tintColor={theme.colors.kilv.stoneInk}
                            style={styles.logo}
                        />
                        <Text style={[styles.title, wide && styles.titleWide]}>
                            {t('welcome.title')}
                        </Text>
                        <Text style={styles.subtitle}>
                            {t('welcome.subtitle')}
                        </Text>
                        <View style={styles.seam} />
                        <View style={styles.actions}>
                            <RoundButton title={t('welcome.createAccount')} action={createAccount} />
                            <RoundButton
                                size="normal"
                                numberOfLines={2}
                                title={t('navigation.restoreWithSecretKey')}
                                onPress={() => {
                                    trackAccountRestored();
                                    router.push(accountAccessRoutes.accountKey);
                                }}
                                display="inverted"
                                style={styles.secondaryButton}
                                textStyle={styles.secondaryButtonText}
                            />
                            <RoundButton
                                size="normal"
                                numberOfLines={2}
                                title={t('welcome.loginWithMobileApp')}
                                onPress={() => {
                                    trackAccountRestored();
                                    router.push(accountAccessRoutes.linkedDevice);
                                }}
                                display="inverted"
                                style={styles.secondaryButton}
                                textStyle={styles.secondaryButtonText}
                            />
                        </View>
                    </View>
                </View>
            </ScrollView>
        </>
    );
}

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.kilv.bg,
    },
    scrollContent: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    hero: {
        width: '100%',
        maxWidth: 1200,
        borderRadius: 6,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        backgroundColor: theme.colors.kilv.stone,
    },
    heroWide: {
        minHeight: 600,
        justifyContent: 'center',
        padding: 40,
    },
    wideArtwork: {
        ...StyleSheet.absoluteFillObject,
        width: '100%',
        height: '100%',
    },
    compactArtwork: {
        width: '100%',
        height: 192,
    },
    content: {
        padding: 24,
        backgroundColor: theme.colors.kilv.scrimStrong,
    },
    contentWide: {
        maxWidth: 460,
        padding: 32,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.kilv.islandBorder,
    },
    logo: {
        width: 32,
        height: 32,
        marginBottom: 20,
    },
    title: {
        fontSize: 30,
        lineHeight: 36,
        ...Typography.default('semiBold'),
        color: theme.colors.kilv.stoneInk,
    },
    titleWide: {
        fontSize: 42,
        lineHeight: 46,
    },
    subtitle: {
        marginTop: 16,
        fontSize: 16,
        lineHeight: 24,
        ...Typography.default(),
        color: theme.colors.kilv.stoneInk,
    },
    seam: {
        height: 1,
        width: 64,
        marginVertical: 24,
        backgroundColor: theme.colors.kilv.molten,
    },
    actions: {
        gap: 10,
        width: '100%',
    },
    secondaryButton: {
        backgroundColor: theme.colors.kilv.scrim,
        minHeight: 44,
        justifyContent: 'center',
        borderColor: theme.colors.kilv.islandBorder,
    },
    secondaryButtonText: {
        color: theme.colors.kilv.stoneInk,
    },
}));
