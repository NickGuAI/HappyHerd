import { Text } from '@/components/StyledText';
import React, { useState, useMemo, useRef } from 'react';
import { View, ActivityIndicator, RefreshControl, Pressable, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { HerdItem as Item, HerdItemGroup as ItemGroup, HerdListHeader, HerdValueItem } from '@/components/herd/pages/HerdList';
import { HerdButton, HerdChip, HerdDot, HerdPageHeader, useHerdWideLayout } from '@/components/herd/pages/HerdPage';
import { ItemList } from '@/components/ItemList';
import { Typography } from '@/constants/Typography';
import { useSessions, useMachine, useSetting } from '@/sync/storage';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@/sync/storageTypes';
import { machineStopDaemon, machineUpdateMetadata, machineDelete, machineSpawnNewSession } from '@/sync/ops';
import { Modal } from '@/modal';
import { formatOSPlatform, formatPathRelativeToHome, getSessionName, getSessionSubtitle } from '@/utils/sessionUtils';
import { isMachineOnline } from '@/utils/machineUtils';
import { sync } from '@/sync/sync';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { MOBILE_GLASS_HEADER_HEIGHT } from '@/components/navigation/headerMetrics';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { getHarnessName } from '@/utils/harnessCatalog';
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
        borderRadius: theme.borderRadius.md,
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
        borderRadius: theme.borderRadius.xl,
        justifyContent: 'center',
        alignItems: 'center',
    },
    inlineSendActive: {
        backgroundColor: theme.colors.button.primary.background,
    },
    headerTile: {
        width: 52,
        height: 52,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surfaceHighest,
        borderWidth: 1,
        borderColor: theme.colors.kilv.rimLine,
    },
    pathChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        paddingHorizontal: 16,
        paddingBottom: 14,
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
    // Wide web draws the title in the page, so the stack header steps aside (UI overhaul).
    const wide = useHerdWideLayout();
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
                    <Text style={[Typography.default(), { fontSize: 16, color: theme.colors.textSecondary }]}>
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
    const machineSummary = [
        machineOnline ? t('status.online') : t('status.offline'),
        metadata?.platform ? formatOSPlatform(metadata.platform) : null,
        metadata?.host || null,
    ].filter(Boolean).join(' · ');
    const cliAvailability = metadata?.cliAvailability;
    // The active harnesses in pick order, then the retired Gemini CLI the daemon still reports.
    const cliRows = cliAvailability ? ([
        ['claude', t('agentInput.agent.claude'), cliAvailability.claude],
        ['codex', t('agentInput.agent.codex'), cliAvailability.codex],
        ['grok', t('agentInput.agent.grok'), cliAvailability.grok],
        ['dsh', t('agentInput.agent.dsh'), cliAvailability.dsh],
        ['agy', getHarnessName('agy'), cliAvailability.agy],
        ['rig', t('uiCopy.rig'), cliAvailability.rig],
        ['gemini', t('agentInput.agent.gemini'), cliAvailability.gemini],
    ] as const).filter(([, , available]) => available !== undefined) : [];

    return (
        <>
            <Stack.Screen
                options={{
                    headerShown: !wide,
                    headerTitle: machineName,
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
                {/* The machine's title row: its tile, name, state and Rename (the mock's page head). */}
                <HerdListHeader testID="machine-page-header">
                    <HerdPageHeader
                        compact={!wide}
                        title={wide ? machineName : undefined}
                        titleStyle={{ ...Typography.mono('semiBold'), fontSize: 24, lineHeight: 30, letterSpacing: 0 }}
                        subtitle={machineSummary}
                        subtitlePrefix={<HerdDot tone={machineOnline ? 'ok' : 'off'} />}
                        leading={(
                            <View style={styles.headerTile}>
                                <Ionicons
                                    name={metadata?.platform === 'darwin' ? 'laptop-outline' : 'server-outline'}
                                    size={24}
                                    color={theme.colors.textLink}
                                />
                            </View>
                        )}
                        actions={(
                            <HerdButton
                                icon="pencil-outline"
                                // Narrow layouts keep the machine's state line on one row.
                                label={wide ? t('uiCopy.renameMachine') : undefined}
                                accessibilityLabel={t('uiCopy.renameMachine')}
                                loading={isRenamingMachine}
                                disabled={isRenamingMachine}
                                onPress={handleRenameMachine}
                                testID="machine-rename"
                            />
                        )}
                    />
                </HerdListHeader>
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
                            {recentPaths.length > 0 && (
                                <View style={styles.pathChips} testID="machine-recent-paths">
                                    {pathsToShow.map((path) => {
                                        const display = formatPathRelativeToHome(path, machine.metadata?.homeDir);
                                        return (
                                            <HerdChip
                                                key={path}
                                                label={display}
                                                mono
                                                accessibilityRole="button"
                                                selected={customPath.trim() === display}
                                                disabled={!machineOnline}
                                                onPress={() => {
                                                    setCustomPath(display);
                                                    setTimeout(() => inputRef.current?.focus(), 50);
                                                }}
                                            />
                                        );
                                    })}
                                    {recentPaths.length > 5 && (
                                        <HerdChip
                                            label={showAllPaths ? t('machineLauncher.showLess') : t('machineLauncher.showAll', { count: recentPaths.length })}
                                            mono
                                            accessibilityRole="button"
                                            onPress={() => setShowAllPaths(!showAllPaths)}
                                            testID="machine-paths-show-all"
                                        />
                                    )}
                                </View>
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
                <ItemGroup title={t('machine.daemon')}>
                        <HerdValueItem
                            title={t('machine.status')}
                            value={machineOnline ? t('status.online') : t('status.offline')}
                            prefix={<HerdDot tone={machineOnline ? 'ok' : 'off'} />}
                            testID="machine-daemon-status"
                        />
                        {machine.daemonState?.pid ? (
                            <HerdValueItem title={t('sessionInfo.processId')} value={String(machine.daemonState.pid)} mono testID="machine-daemon-pid" />
                        ) : null}
                        {machine.daemonState?.httpPort ? (
                            <HerdValueItem title={t('machine.lastKnownHttpPort')} value={String(machine.daemonState.httpPort)} mono testID="machine-daemon-port" />
                        ) : null}
                        {machine.daemonState?.startedWithCliVersion ? (
                            <HerdValueItem title={t('machine.cliVersion')} value={machine.daemonState.startedWithCliVersion} mono testID="machine-daemon-cli-version" />
                        ) : null}
                        {machine.daemonState?.startTime ? (
                            <HerdValueItem title={t('machine.startedAt')} value={new Date(machine.daemonState.startTime).toLocaleString()} />
                        ) : null}
                        <HerdValueItem title={t('machine.daemonStateVersion')} value={String(machine.daemonStateVersion)} mono />
                        <Item
                            title={t('machine.stopDaemon')}
                            titleStyle={{
                                color: machineOnline ? theme.colors.textDestructive : theme.colors.textSecondary
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
                                        color={machineOnline ? theme.colors.textDestructive : theme.colors.textSecondary}
                                    />
                                )
                            }
                        />
                </ItemGroup>

                {/* CLI Availability */}
                {cliAvailability && (
                    <ItemGroup title={t('machine.cliAvailability')}>
                        {cliRows.map(([key, label, available]) => (
                            <HerdValueItem
                                key={key}
                                title={label}
                                testID={`machine-cli-${key}`}
                                trailing={(
                                    <Ionicons
                                        name={available ? 'checkmark' : 'remove'}
                                        size={16}
                                        accessibilityLabel={available ? t('machine.cliInstalled') : t('machine.cliNotFound')}
                                        color={available ? theme.colors.success : theme.colors.textSecondary}
                                    />
                                )}
                            />
                        ))}
                        <HerdValueItem
                            title={t('machine.lastDetected')}
                            value={new Date(cliAvailability.detectedAt).toLocaleString()}
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
                                rightElement={<Ionicons name="chevron-forward" size={20} color={theme.colors.groupped.chevron} />}
                            />
                        ))}
                    </ItemGroup>
                )}

                {/* Machine */}
                <ItemGroup title={t('machine.machineGroup')}>
                        <HerdValueItem title={t('machine.host')} value={metadata?.host || machineId} mono />
                        <HerdValueItem title={t('machine.machineId')} value={machineId} mono copyText={machineId} testID="machine-id" />
                        {metadata?.username ? <HerdValueItem title={t('machine.username')} value={metadata.username} mono /> : null}
                        {metadata?.homeDir ? <HerdValueItem title={t('machine.homeDirectory')} value={metadata.homeDir} mono /> : null}
                        {metadata?.platform ? <HerdValueItem title={t('machine.platform')} value={metadata.platform} mono /> : null}
                        {metadata?.arch ? <HerdValueItem title={t('machine.architecture')} value={metadata.arch} mono /> : null}
                        <HerdValueItem
                            title={t('machine.lastSeen')}
                            value={machine.activeAt ? new Date(machine.activeAt).toLocaleString() : t('machine.never')}
                        />
                        <HerdValueItem title={t('machine.metadataVersion')} value={String(machine.metadataVersion)} mono />
                </ItemGroup>

                {/* Danger zone */}
                <ItemGroup title={t('machine.dangerZone')} footer={t('machine.deleteFooter')}>
                    <Item
                        title={t('machine.delete')}
                        titleStyle={{ color: theme.colors.textDestructive }}
                        onPress={handleDeleteMachine}
                        disabled={isDeletingMachine}
                        showChevron={false}
                        rightElement={
                            isDeletingMachine ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : (
                                <Ionicons name="trash-outline" size={20} color={theme.colors.textDestructive} />
                            )
                        }
                    />
                </ItemGroup>
            </ItemList>
        </>
    );
}
