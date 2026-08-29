import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Typography } from '@/constants/Typography';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useAllMachines } from '@/sync/storage';
import { useRouter } from 'expo-router';
import { collectMachineChoices } from '@/sync/machineChoices';
import { useOfflineMachineTroubleshooting } from '@/hooks/useOfflineMachineTroubleshooting';

import { t } from '@/text';
const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 48,
    },
    iconContainer: {
        marginBottom: 24,
    },
    titleText: {
        fontSize: 20,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 8,
        ...Typography.default('regular'),
    },
    descriptionText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginBottom: 24,
        ...Typography.default(),
    },
    button: {
        backgroundColor: theme.colors.button.primary.background,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    buttonDisabled: {
        backgroundColor: theme.colors.textSecondary,
        opacity: 0.6,
    },
    buttonIcon: {
        marginRight: 8,
    },
    buttonText: {
        fontSize: 16,
        color: theme.colors.button.primary.tint,
        fontWeight: '600',
        ...Typography.default('semiBold'),
    },
}));

export function EmptySessionsTablet() {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const router = useRouter();
    const machines = useAllMachines({ includeOffline: true });
    const machineChoices = React.useMemo(() => collectMachineChoices(machines), [machines]);
    const hasOnlineMachines = machineChoices.some((machine) => machine.online);
    const hasOfflineMachines = machineChoices.length > 0 && !hasOnlineMachines;
    const troubleshoot = useOfflineMachineTroubleshooting(machineChoices);
    
    const handleStartNewSession = () => {
        router.navigate('/new');
    };
    
    return (
        <View style={styles.container}>
            <Ionicons
                name={hasOfflineMachines ? 'cloud-offline-outline' : 'terminal-outline'}
                size={64} 
                color={theme.colors.textSecondary}
                style={styles.iconContainer}
            />
            
            <Text style={styles.titleText}>
                {hasOfflineMachines
                    ? machineChoices.length === 1
                        ? t('offlineMachines.singleUnreachable', { name: machineChoices[0].name })
                        : t('offlineMachines.noneReachable')
                    : t('uiCopy.noActiveSessions')}
            </Text>
            
            {hasOnlineMachines ? (
                <>
                    <Text style={styles.descriptionText}>
                        {t("uiCopy.startANewSessionOnAnyOfYourConnectedMachines")}
                    </Text>
                    <Pressable
                        style={styles.button}
                        onPress={handleStartNewSession}
                    >
                        <Ionicons
                            name="add"
                            size={20}
                            color={theme.colors.button.primary.tint}
                            style={styles.buttonIcon}
                        />
                        <Text style={styles.buttonText}>
                            {t("newSession.title")}
                        </Text>
                    </Pressable>
                </>
            ) : hasOfflineMachines ? (
                <>
                    <Text style={styles.descriptionText}>
                        {t('offlineMachines.bringOnline')}
                    </Text>
                    <Pressable style={styles.button} onPress={troubleshoot}>
                        <Ionicons
                            name="help-circle-outline"
                            size={20}
                            color={theme.colors.button.primary.tint}
                            style={styles.buttonIcon}
                        />
                        <Text style={styles.buttonText}>{t('offlineMachines.troubleshoot')}</Text>
                    </Pressable>
                </>
            ) : (
                <Text style={styles.descriptionText}>
                    {t("uiCopy.openANewTerminalOnYourComputerToStartSession")}
                </Text>
            )}
        </View>
    );
}
