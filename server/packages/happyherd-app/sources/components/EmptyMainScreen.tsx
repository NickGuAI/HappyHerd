import React from 'react';
import { Image as ExpoImage } from 'expo-image';
import { View, Text, Platform, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';
import { StyleSheet, useUnistyles, withUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { collectMachineChoices } from '@/sync/machineChoices';
import { useOfflineMachineTroubleshooting } from '@/hooks/useOfflineMachineTroubleshooting';
import { useRouter } from 'expo-router';
import { getServerUrl } from '@/sync/serverConfig';

const Image = withUnistyles(ExpoImage);

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 32,
    },
    onboardingScroll: {
        flex: 1,
    },
    onboardingContent: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 32,
    },
    artwork: {
        width: 128,
        height: 128,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        marginBottom: 24,
    },
    title: {
        marginBottom: 16,
        paddingHorizontal: 24,
        textAlign: 'center',
        fontSize: 24,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    stateIcon: {
        marginBottom: 20,
    },
    stateTitle: {
        marginBottom: 8,
        paddingHorizontal: 24,
        textAlign: 'center',
        fontSize: 24,
        color: theme.colors.text,
        ...Typography.default('semiBold'),
    },
    stateDescription: {
        maxWidth: 360,
        marginBottom: 24,
        paddingHorizontal: 24,
        textAlign: 'center',
        fontSize: 16,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    terminalBlock: {
        backgroundColor: theme.colors.kilv.bgSunken,
        borderRadius: 6,
        padding: 16,
        marginTop: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
    },
    terminalText: {
        ...Typography.mono(),
        fontSize: 16,
        color: theme.colors.terminal.prompt,
        ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {}),
    },
    stepsContainer: {
        width: '100%',
        maxWidth: 600,
        paddingHorizontal: 24,
        marginBottom: 24,
    },
    step: {
        marginBottom: 24,
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    stepNumber: {
        width: 24,
        height: 24,
        flexShrink: 0,
        borderRadius: 4,
        backgroundColor: Platform.select({ web: theme.colors.surfaceHigh, default: theme.colors.surfaceHighest }),
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    stepNumberText: {
        ...Typography.default('semiBold'),
        fontSize: 14,
        color: theme.colors.text,
    },
    stepText: {
        ...Typography.default('semiBold'),
        flex: 1,
        fontSize: 18,
        color: theme.colors.text,
    },
    stepDescription: {
        ...Typography.default(),
        fontSize: 16,
        color: theme.colors.textSecondary,
        ...(Platform.OS === 'web' ? { overflowWrap: 'anywhere' as const } : {}),
    },
    buttonsContainer: {
        alignItems: 'center',
        width: '100%',
    },
    buttonWrapper: {
        width: 240,
        marginBottom: 12,
    },
    manualUrlButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        minHeight: 40,
        marginHorizontal: 24,
        paddingHorizontal: 14,
        borderRadius: 4,
    },
    manualUrlButtonPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    manualUrlButtonText: {
        fontSize: 15,
        flexShrink: 1,
        textAlign: 'center',
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
    secondaryAction: {
        minHeight: 40,
        marginTop: 4,
        paddingHorizontal: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
    },
    secondaryActionPressed: {
        backgroundColor: theme.colors.surfacePressedOverlay,
    },
    secondaryActionText: {
        fontSize: 15,
        color: theme.colors.textSecondary,
        ...Typography.default('semiBold'),
    },
}));

export function EmptyMainScreen({
    hasArchivedSessions = false,
    onShowArchived,
    bottomContentInset = 0,
}: {
    hasArchivedSessions?: boolean;
    onShowArchived?: () => void;
    bottomContentInset?: number;
}) {
    const { connectTerminal, connectWithUrl, isLoading } = useConnectTerminal();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const machines = useAllMachines({ includeOffline: true });
    const machineChoices = React.useMemo(() => collectMachineChoices(machines), [machines]);
    const hasOnlineMachines = machineChoices.some((machine) => machine.online);
    const troubleshoot = useOfflineMachineTroubleshooting(machineChoices);
    const showArchivedAction = hasArchivedSessions && onShowArchived ? (
        <Pressable
            onPress={onShowArchived}
            accessibilityRole="button"
            style={({ pressed }) => [
                styles.secondaryAction,
                pressed && styles.secondaryActionPressed,
            ]}
        >
            <Text style={styles.secondaryActionText}>{t('sidebar.showArchived')}</Text>
        </Pressable>
    ) : null;
    const enterUrlManually = React.useCallback(async () => {
        const url = await Modal.prompt(
            t('modals.authenticateTerminal'),
            t('modals.pasteUrlFromTerminal'),
            {
                placeholder: t('uiCopy.happyherdTerminal'),
                cancelText: t('common.cancel'),
                confirmText: t('common.authenticate'),
            },
        );

        if (url?.trim()) {
            connectWithUrl(url.trim());
        }
    }, [connectWithUrl]);

    if (machineChoices.length > 0) {
        if (hasOnlineMachines) {
            return (
                <View style={styles.container}>
                    <Ionicons name="terminal-outline" size={56} color={theme.colors.textSecondary} style={styles.stateIcon} />
                    <Text style={styles.stateTitle}>{t('components.emptyMainScreen.noSessionsYet')}</Text>
                    <Text style={styles.stateDescription}>{t('components.emptyMainScreen.startOnConnectedMachine')}</Text>
                    <RoundButton title={t('newSession.title')} size="large" onPress={() => router.navigate('/new')} />
                    {showArchivedAction}
                </View>
            );
        }

        const title = machineChoices.length === 1
            ? t('components.emptyMainScreen.machineUnreachable', { machine: machineChoices[0].name })
            : t('components.emptyMainScreen.noMachinesReachable');
        return (
            <View style={styles.container}>
                <Ionicons name="cloud-offline-outline" size={56} color={theme.colors.textSecondary} style={styles.stateIcon} />
                <Text style={styles.stateTitle}>{title}</Text>
                <Text style={styles.stateDescription}>{t('components.emptyMainScreen.bringMachineOnline')}</Text>
                <RoundButton title={t('components.emptyMainScreen.troubleshoot')} size="large" onPress={troubleshoot} />
                {showArchivedAction}
            </View>
        );
    }

    return (
        <ScrollView
            testID="empty-main-onboarding"
            style={styles.onboardingScroll}
            contentContainerStyle={[styles.onboardingContent, { paddingBottom: Math.max(32, bottomContentInset) }]}
        >
            <Image
                accessible={false}
                source={theme.dark ? require('@/assets/images/kilv-mark-dark.webp') : require('@/assets/images/kilv-mark-light.webp')}
                contentFit="cover"
                style={styles.artwork}
            />
            <Text style={styles.title}>{t('components.emptyMainScreen.readyToCode')}</Text>
            <View style={styles.stepsContainer}>
                <View style={styles.step}>
                    <View style={styles.stepRow}>
                        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
                        <Text style={styles.stepText}>{t('components.emptyMainScreen.installCli')}</Text>
                    </View>
                    <Text style={styles.stepDescription}>{t('components.emptyMainScreen.installDescription')}</Text>
                    <View style={styles.terminalBlock}>
                        <Text selectable style={styles.terminalText}>{t('uiCopy.installHappyHerd')}</Text>
                    </View>
                    <Text selectable style={styles.stepDescription}>
                        {t('components.emptyMainScreen.serverSelection', { serverUrl: getServerUrl() })}
                    </Text>
                </View>
                <View style={styles.step}>
                    <View style={styles.stepRow}>
                        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
                        <Text style={styles.stepText}>{t('components.emptyMainScreen.authorizeTerminal')}</Text>
                    </View>
                    <Text style={styles.stepDescription}>{t('components.emptyMainScreen.authorizeDescription')}</Text>
                    <View style={styles.terminalBlock}>
                        <Text selectable style={styles.terminalText}>{t('uiCopy.authLogin')}</Text>
                    </View>
                    <View style={styles.buttonsContainer}>
                        {Platform.OS !== 'web' && (
                            <View style={styles.buttonWrapper}>
                                <RoundButton
                                    title={t('components.emptyMainScreen.openCamera')}
                                    size="large"
                                    loading={isLoading}
                                    onPress={connectTerminal}
                                />
                            </View>
                        )}
                        <Pressable
                            onPress={enterUrlManually}
                            accessibilityRole="button"
                            accessibilityLabel={t('connect.enterUrlManually')}
                            style={({ pressed }) => [styles.manualUrlButton, pressed && styles.manualUrlButtonPressed]}
                        >
                            <Ionicons name="link-outline" size={17} color={theme.colors.textSecondary} />
                            <Text style={styles.manualUrlButtonText}>{t('connect.enterUrlManually')}</Text>
                        </Pressable>
                    </View>
                </View>
                <View>
                    <View style={styles.stepRow}>
                        <View style={styles.stepNumber}><Text style={styles.stepNumberText}>3</Text></View>
                        <Text style={styles.stepText}>{t('components.emptyMainScreen.startDaemon')}</Text>
                    </View>
                    <Text style={styles.stepDescription}>{t('components.emptyMainScreen.daemonDescription')}</Text>
                    <View style={styles.terminalBlock}>
                        <Text selectable style={styles.terminalText}>{t('uiCopy.daemonStart')}</Text>
                    </View>
                    <Text style={styles.stepDescription}>{t('components.emptyMainScreen.discoveryDescription', { newSession: t('newSession.title') })}</Text>
                </View>
            </View>
            {showArchivedAction}
        </ScrollView>
    );
}
