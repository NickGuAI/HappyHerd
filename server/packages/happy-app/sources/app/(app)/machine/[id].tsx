import React, { useState, useMemo, useRef } from 'react';
import { View, Text, ActivityIndicator, RefreshControl, Pressable, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { useSessions, useMachine, useSetting } from '@/sync/storage';
import { Ionicons, Octicons } from '@expo/vector-icons';
import type { Session } from '@/sync/storageTypes';
import { machineStopDaemon, machineUpdateMetadata, machineDelete, machineSpawnNewSession } from '@/sync/ops';
import { Modal } from '@/modal';
import { formatPathRelativeToHome, getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { sync } from '@/sync/sync';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { MOBILE_GLASS_HEADER_HEIGHT } from '@/components/navigation/headerMetrics';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { MultiTextInput, type MultiTextInputHandle } from '@/components/MultiTextInput';

const styles = StyleSheet.create((theme) => ({
    pathInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 16,
    },
    pathInput: {
        flex: 1,
        borderRadius: 8,
        backgroundColor: Platform.select({
            web: theme.colors.input?.background ?? theme.colors.groupped.background,
            default: theme.colors.glass.backgroundSubtle,
        }),
        borderWidth: 1,
        borderColor: theme.colors.divider,
        minHeight: 44,
        position: 'relative',
        paddingHorizontal: 12,
        paddingVertical: Platform.select({ web: 10, ios: 8, default: 10 }) as any,
    },
    inlineSendButton: {
        position: 'absolute',
        right: 8,
        bottom: 10,
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    inlineSendActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    inlineSendInactive: {
        backgroundColor: Platform.select({
            ios: theme.colors.permissionButton?.inactive?.background ?? theme.colors.surfaceHigh,
            android: theme.colors.permissionButton?.inactive?.background ?? theme.colors.surfaceHigh,
            default: theme.colors.permissionButton?.inactive?.background ?? theme.colors.surfaceHigh,
        }) as any,
    },
}));

export default function MachineDetailScreen() {
    const { theme } = useUnistyles();
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const sessions = useSessions();
    const machine = useMachine(machineId!);
    const machineWorkspaceEnabled = useSetting('machineWorkspace');
    const navigateToSession = useNavigateToSession();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isStoppingDaemon, setIsStoppingDaemon] = useState(false);
    const [isRenamingMachine, setIsRenamingMachine] = useState(false);
    const [isDeletingMachine, setIsDeletingMachine] = useState(false);
    const [customPath, setCustomPath] = useState('');
    const [isSpawning, setIsSpawning] = useState(false);
    const inputRef = useRef<MultiTextInputHandle>(null);
    const [showAllPaths, setShowAllPaths] = useState(false);

    const machineSessions = useMemo(() => {
        if (!sessions || !machineId) return [];

        return sessions.filter(item => {
            if (typeof item === 'string') return false;
            const session = item as Session;
            return session.metadata?.machineId === machineId;
        }) as Session[];
    }, [sessions, machineId]);

    const previousSessions = useMemo(() => {
        return [...machineSessions]
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, 5);
    }, [machineSessions]);

    const recentPaths = useMemo(() => {
        const paths = new Set<string>();
        machineSessions.forEach((session) => {
            if (session.metadata?.path) paths.add(session.metadata.path);
        });
        return Array.from(paths).sort();
    }, [machineSessions]);

    const pathsToShow = useMemo(() => (
        showAllPaths ? recentPaths : recentPaths.slice(0, 5)
    ), [recentPaths, showAllPaths]);

    const handleStopDaemon = async () => {
        // Show confirmation modal using alert with buttons
        Modal.alert(
            t("uiCopy.stopDaemon"),
            t("uiCopy.youWillNotBeAbleToSpawnNewSessionsOn"),
            [
                {
                    text: 'Cancel',
                    style: 'cancel'
                },
                {
                    text: 'Stop Daemon',
                    style: 'destructive',
                    onPress: async () => {
                        setIsStoppingDaemon(true);
                        try {
                            const result = await machineStopDaemon(machineId!);
                            Modal.alert(t("uiCopy.daemonStopped"), result.message);
                            // Refresh to get updated metadata
                            await sync.refreshMachines();
                        } catch (error) {
                            Modal.alert(t('common.error'), t("uiCopy.failedToStopDaemonItMayNotBeRunning"));
                        } finally {
                            setIsStoppingDaemon(false);
                        }
                    }
                }
            ]
        );
    };

    const handleRefresh = async () => {
        setIsRefreshing(true);
        await sync.refreshMachines();
        setIsRefreshing(false);
    };

    const handleDeleteMachine = async () => {
        if (!machineId) return;
        const confirmed = await Modal.confirm(
            t('machine.deleteConfirmTitle'),
            t('machine.deleteConfirmMessage'),
            { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true }
        );
        if (!confirmed) return;

        setIsDeletingMachine(true);
        try {
            const result = await machineDelete(machineId);
            if (result.success) {
                router.back();
            } else {
                Modal.alert(t('common.error'), result.message || t('machine.deleteFailed'));
            }
        } catch (error) {
            Modal.alert(
                t('common.error'),
                error instanceof Error ? error.message : t('machine.deleteFailed')
            );
        } finally {
            setIsDeletingMachine(false);
        }
    };

    const handleRenameMachine = async () => {
        if (!machine || !machineId) return;

        const newDisplayName = await Modal.prompt(
            t("uiCopy.renameMachine"),
            t("uiCopy.giveThisMachineACustomNameLeaveEmptyToUse"),
            {
                defaultValue: machine.metadata?.displayName || '',
                placeholder: machine.metadata?.host || t('uiCopy.machineNamePlaceholder'),
                cancelText: t('common.cancel'),
                confirmText: t('common.rename')
            }
        );

        if (newDisplayName !== null) {
            setIsRenamingMachine(true);
            try {
                const updatedMetadata = {
                    ...machine.metadata!,
                    displayName: newDisplayName.trim() || undefined
                };
                
                await machineUpdateMetadata(
                    machineId,
                    updatedMetadata,
                    machine.metadataVersion
                );
                
                Modal.alert(t('common.success'), t("uiCopy.machineRenamedSuccessfully"));
            } catch (error) {
                Modal.alert(
                    t("common.error"),
                    error instanceof Error ? error.message : t("uiCopy.failedToRenameMachine")
                );
                // Refresh to get latest state
                await sync.refreshMachines();
            } finally {
                setIsRenamingMachine(false);
            }
        }
    };

    const handleStartSession = async (approvedNewDirectoryCreation: boolean = false): Promise<void> => {
        if (!machine || !machineId) return;
        try {
            const pathToUse = (customPath.trim() || '~');
            if (!isMachineOnline(machine)) return;
            setIsSpawning(true);
            const absolutePath = resolveAbsolutePath(pathToUse, machine?.metadata?.homeDir);
            const result = await machineSpawnNewSession({
                machineId: machineId!,
                directory: absolutePath,
                approvedNewDirectoryCreation
            });
            switch (result.type) {
                case 'success':
                    // Dismiss machine picker & machine detail screen
                    router.back();
                    router.back();
                    navigateToSession(result.sessionId);
                    break;
                case 'requestToApproveDirectoryCreation': {
                    const approved = await Modal.confirm(t("uiCopy.createDirectory"), t("uiCopy.theDirectoryValueDoesNotExistWouldYouLikeTo", { value1: result.directory }), { cancelText: t('common.cancel'), confirmText: t('common.create') });
                    if (approved) {
                        await handleStartSession(true);
                    }
                    break;
                }
                case 'error':
                    Modal.alert(t('common.error'), result.errorMessage);
                    break;
            }
        } catch (error) {
            let errorMessage = t('uiCopy.failedToStartSessionDaemon');
            if (error instanceof Error && !error.message.includes('Failed to spawn session')) {
                errorMessage = error.message;
            }
            Modal.alert(t('common.error'), errorMessage);
        } finally {
            setIsSpawning(false);
        }
    };

    if (!machine) {
        return (
            <>
                <Stack.Screen
                    options={{
                        headerShown: true,
                        headerTitle: '',
                        headerBackTitle: t('machine.back')
                    }}
                />
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.groupped.background }}>
                    <Text style={[Typography.default(), { fontSize: 16, color: '#666' }]}>
                        {t("uiCopy.machineNotFound")}
                    </Text>
                </View>
            </>
        );
    }

    const metadata = machine.metadata;
    const machineName = metadata?.displayName || metadata?.host || 'unknown machine';
    const machineOnline = isMachineOnline(machine);
    const spawnButtonDisabled = !customPath.trim() || isSpawning || !machineOnline;

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: true,
                    headerTitle: machineName,
                    headerRight: () => (
                        <Pressable
                            onPress={handleRenameMachine}
                            hitSlop={10}
                            style={{
                                opacity: isRenamingMachine ? 0.5 : 1
                            }}
                            disabled={isRenamingMachine}
                        >
                            <Octicons
                                name="pencil"
                                size={24}
                                color={theme.colors.text}
                            />
                        </Pressable>
                    ),
                    headerBackTitle: t('machine.back')
                }}
            />
            <ItemList
                containerStyle={{
                    paddingTop: Platform.OS === 'ios' ? MOBILE_GLASS_HEADER_HEIGHT : 0,
                }}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={handleRefresh}
                    />
                }
                keyboardShouldPersistTaps="handled"
            >
                {/* Launch section */}
                {machine && (
                    <>
                        {!isMachineOnline(machine) && (
                            <ItemGroup>
                                <Item
                                    title={t('machine.offlineUnableToSpawn')}
                                    subtitle={t('machine.offlineHelp')}
                                    subtitleLines={0}
                                    showChevron={false}
                                />
                            </ItemGroup>
                        )}
                        <ItemGroup title={t('machine.launchNewSessionInDirectory')}>
                        <View style={{ opacity: isMachineOnline(machine) ? 1 : 0.5 }}>
                            <View style={styles.pathInputContainer}>
                                <View style={[styles.pathInput, { paddingVertical: 8 }]}>
                                    <MultiTextInput
                                        ref={inputRef}
                                        value={customPath}
                                        onChangeText={setCustomPath}
                                        placeholder={t("machineLauncher.enterCustomPath")}
                                        maxHeight={76}
                                        paddingTop={8}
                                        paddingBottom={8}
                                        paddingRight={48}
                                    />
                                    <Pressable
                                        onPress={() => handleStartSession()}
                                        disabled={spawnButtonDisabled}
                                        style={[
                                            styles.inlineSendButton,
                                            spawnButtonDisabled ? styles.inlineSendInactive : styles.inlineSendActive
                                        ]}
                                    >
                                        <Ionicons
                                            name="play"
                                            size={16}
                                            color={spawnButtonDisabled ? theme.colors.textSecondary : theme.colors.button.primary.tint}
                                            style={{ marginLeft: 1 }}
                                        />
                                    </Pressable>
                                </View>
                            </View>
                            <View style={{ paddingTop: 4 }} />
                            {pathsToShow.map((path, index) => {
                                const display = formatPathRelativeToHome(path, machine.metadata?.homeDir);
                                const isSelected = customPath.trim() === display;
                                const isLast = index === pathsToShow.length - 1;
                                const hideDivider = isLast && pathsToShow.length <= 5;
                                return (
                                    <Item
                                        key={path}
                                        title={display}
                                        leftElement={<Ionicons name="folder-outline" size={18} color={theme.colors.textSecondary} />}
                                        onPress={isMachineOnline(machine) ? () => {
                                            setCustomPath(display);
                                            setTimeout(() => inputRef.current?.focus(), 50);
                                        } : undefined}
                                        disabled={!isMachineOnline(machine)}
                                        selected={isSelected}
                                        showChevron={false}
                                        pressableStyle={isSelected ? {
                                            backgroundColor: Platform.select({
                                                web: theme.colors.surfaceSelected,
                                                default: theme.colors.glass.backgroundSubtle,
                                            }),
                                        } : undefined}
                                        showDivider={!hideDivider}
                                    />
                                );
                            })}
                            {recentPaths.length > 5 && (
                                <Item
                                    title={showAllPaths ? t('machineLauncher.showLess') : t('machineLauncher.showAll', { count: recentPaths.length })}
                                    onPress={() => setShowAllPaths(!showAllPaths)}
                                    showChevron={false}
                                    showDivider={false}
                                    titleStyle={{
                                        textAlign: 'center',
                                        color: (theme as any).dark ? theme.colors.button.primary.tint : theme.colors.button.primary.background
                                    }}
                                />
                            )}
                        </View>
                        </ItemGroup>
                    </>
                )}

                {machineWorkspaceEnabled && machine && (
                    <ItemGroup title={t('workspace.title')}>
                        <Item
                            title={t('workspace.browseMachine')}
                            subtitle={formatPathRelativeToHome(machine.metadata?.homeDir || '~', machine.metadata?.homeDir)}
                            leftElement={<Ionicons name="folder-open-outline" size={20} color={theme.colors.textLink} />}
                            onPress={() => router.push({
                                pathname: '/workspace',
                                params: {
                                    machineId: machine.id,
                                    path: machine.metadata?.homeDir || '~',
                                },
                            })}
                        />
                    </ItemGroup>
                )}
                {/* Daemon */}
                <ItemGroup>
                        <Item
                            title={t('machine.status')}
                            detail={machineOnline ? t('status.online') : t('status.offline')}
                            detailStyle={{
                                color: machineOnline ? '#34C759' : theme.colors.textSecondary
                            }}
                            showChevron={false}
                        />
                        <Item
                            title={t('machine.stopDaemon')}
                            titleStyle={{
                                color: machineOnline ? '#FF9500' : theme.colors.textSecondary
                            }}
                            onPress={machineOnline ? handleStopDaemon : undefined}
                            disabled={isStoppingDaemon || !machineOnline}
                            rightElement={
                                isStoppingDaemon ? (
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                ) : (
                                    <Ionicons 
                                        name="stop-circle" 
                                        size={20} 
                                        color={machineOnline ? '#FF9500' : theme.colors.textSecondary}
                                    />
                                )
                            }
                        />
                        {machine.daemonState && (
                            <>
                                {machine.daemonState.pid && (
                                    <Item
                                        title={t('machine.lastKnownPid')}
                                        subtitle={String(machine.daemonState.pid)}
                                        subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
                                    />
                                )}
                                {machine.daemonState.httpPort && (
                                    <Item
                                        title={t('machine.lastKnownHttpPort')}
                                        subtitle={String(machine.daemonState.httpPort)}
                                        subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
                                    />
                                )}
                                {machine.daemonState.startTime && (
                                    <Item
                                        title={t('machine.startedAt')}
                                        subtitle={new Date(machine.daemonState.startTime).toLocaleString()}
                                    />
                                )}
                                {machine.daemonState.startedWithCliVersion && (
                                    <Item
                                        title={t('machine.cliVersion')}
                                        subtitle={machine.daemonState.startedWithCliVersion}
                                        subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
                                    />
                                )}
                            </>
                        )}
                        <Item
                            title={t('machine.daemonStateVersion')}
                            subtitle={String(machine.daemonStateVersion)}
                        />
                </ItemGroup>

                {/* CLI Availability */}
                {metadata?.cliAvailability && (
                    <ItemGroup title={t('machine.cliAvailability')}>
                        <Item
                            title={t("agentInput.agent.claude")}
                            showChevron={false}
                            rightElement={
                                <Text style={{ color: metadata.cliAvailability.claude ? '#34C759' : theme.colors.textSecondary, fontSize: 14 }}>
                                    {metadata.cliAvailability.claude ? t('machine.cliInstalled') : t('machine.cliNotFound')}
                                </Text>
                            }
                        />
                        <Item
                            title={t("agentInput.agent.codex")}
                            showChevron={false}
                            rightElement={
                                <Text style={{ color: metadata.cliAvailability.codex ? '#34C759' : theme.colors.textSecondary, fontSize: 14 }}>
                                    {metadata.cliAvailability.codex ? t('machine.cliInstalled') : t('machine.cliNotFound')}
                                </Text>
                            }
                        />
                        <Item
                            title={t("agentInput.agent.gemini")}
                            showChevron={false}
                            rightElement={
                                <Text style={{ color: metadata.cliAvailability.gemini ? '#34C759' : theme.colors.textSecondary, fontSize: 14 }}>
                                    {metadata.cliAvailability.gemini ? t('machine.cliInstalled') : t('machine.cliNotFound')}
                                </Text>
                            }
                        />
                        {metadata.cliAvailability.rig !== undefined && (
                            <Item
                                title={t('uiCopy.rig')}
                                showChevron={false}
                                rightElement={
                                    <Text style={{ color: metadata.cliAvailability.rig ? '#34C759' : theme.colors.textSecondary, fontSize: 14 }}>
                                        {metadata.cliAvailability.rig ? t('machine.cliInstalled') : t('machine.cliNotFound')}
                                    </Text>
                                }
                            />
                        )}
                        <Item
                            title={t('machine.lastDetected')}
                            subtitle={new Date(metadata.cliAvailability.detectedAt).toLocaleString()}
                            showChevron={false}
                        />
                    </ItemGroup>
                )}

                {/* Recent sessions */}
                {previousSessions.length > 0 && (
                    <ItemGroup title={t("uiCopy.previousSessionsUpTo5MostRecent")}>
                        {previousSessions.map(session => (
                            <Item
                                key={session.id}
                                title={getSessionName(session)}
                                subtitle={getSessionSubtitle(session)}
                                onPress={() => navigateToSession(session.id)}
                                rightElement={<Ionicons name="chevron-forward" size={20} color="#C7C7CC" />}
                            />
                        ))}
                    </ItemGroup>
                )}

                {/* Machine */}
                <ItemGroup title={t('machine.machineGroup')}>
                        <Item
                            title={t('machine.host')}
                            subtitle={metadata?.host || machineId}
                        />
                        <Item
                            title={t('machine.machineId')}
                            subtitle={machineId}
                            subtitleStyle={{ fontFamily: 'Menlo', fontSize: 12 }}
                        />
                        {metadata?.username && (
                            <Item
                                title={t('machine.username')}
                                subtitle={metadata.username}
                            />
                        )}
                        {metadata?.homeDir && (
                            <Item
                                title={t('machine.homeDirectory')}
                                subtitle={metadata.homeDir}
                                subtitleStyle={{ fontFamily: 'Menlo', fontSize: 13 }}
                            />
                        )}
                        {metadata?.platform && (
                            <Item
                                title={t('machine.platform')}
                                subtitle={metadata.platform}
                            />
                        )}
                        {metadata?.arch && (
                            <Item
                                title={t('machine.architecture')}
                                subtitle={metadata.arch}
                            />
                        )}
                        <Item
                            title={t('machine.lastSeen')}
                            subtitle={machine.activeAt ? new Date(machine.activeAt).toLocaleString() : t('machine.never')}
                        />
                        <Item
                            title={t('machine.metadataVersion')}
                            subtitle={String(machine.metadataVersion)}
                        />
                </ItemGroup>

                {/* Danger zone */}
                <ItemGroup title={t('machine.dangerZone')} footer={t('machine.deleteFooter')}>
                    <Item
                        title={t('machine.delete')}
                        titleStyle={{ color: '#FF3B30' }}
                        onPress={handleDeleteMachine}
                        disabled={isDeletingMachine}
                        showChevron={false}
                        rightElement={
                            isDeletingMachine ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : (
                                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                            )
                        }
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
}
