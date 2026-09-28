import { Text } from '@/components/StyledText';
import React, { useCallback } from 'react';
import { View, Platform, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { CommonActions, StackActions, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { Typography } from '@/constants/Typography';
import { HerdItem as Item, HerdItemGroup as ItemGroup, HerdListHeader, HerdValueItem } from '@/components/herd/pages/HerdList';
import { HerdButton, HerdDot, HerdPageHeader, useHerdWideLayout } from '@/components/herd/pages/HerdPage';
import { SessionStatusAvatar } from '@/components/SessionStatusAvatar';
import { ItemList } from '@/components/ItemList';
import { storage, useMachine, useProjects, useSession, useIsDataReady } from '@/sync/storage';
import { getSessionName, useSessionStatus, formatOSPlatform, formatPathRelativeToHome, getResumeCommand } from '@/utils/sessionUtils';
import * as Clipboard from 'expo-clipboard';
import { Modal } from '@/modal';
import { machineControlHeartbeat, sessionArchive, sessionKill, sessionDelete } from '@/sync/ops';
import { maybeCleanupWorktree } from '@/hooks/useWorktreeCleanup';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';
import { isVersionSupported, MINIMUM_CLI_VERSION } from '@/utils/versionUtils';
import { CodeView } from '@/components/CodeView';
import { Session } from '@/sync/storageTypes';
import { useHappyHerdAction } from '@/hooks/useHappyHerdAction';
import { useSessionQuickActions } from '@/hooks/useSessionQuickActions';
import { copySessionMetadataToClipboard, copySessionMetadataAndLogsToClipboard } from '@/utils/copySessionMetadataToClipboard';
import { HappyHerdError } from '@/utils/errors';
import { getRigIdentity, isRigMetadata, rigCanBrowseFiles, rigCanUseShell } from '@/sync/rig';
import { MOBILE_GLASS_HEADER_HEIGHT } from '@/components/navigation/headerMetrics';
import { isRunningOnMac } from '@/utils/platform';
import {
    HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION,
    type HappyHerdHeartbeatControlResponse,
} from '@happyherd/wire';
import { formatHeartbeatStatusPresentation } from '@/utils/heartbeatCommand';
import { formatDangerouslySkipPermissionsMetadata } from '@/utils/sessionPermissionMetadata';
import { findMountedSessionRouteTarget } from '@/utils/sessionInfoChangesNavigation';

const DEFAULT_RIG_NAME = 'Rig';

function formatSandboxMetadata(sandbox: unknown, homeDir?: string): string {
    if (sandbox === null || sandbox === undefined) {
        return 'Disabled';
    }

    if (typeof sandbox === 'string') {
        return sandbox;
    }

    if (typeof sandbox !== 'object') {
        return String(sandbox);
    }

    const value = sandbox as Record<string, unknown>;
    if (value.enabled === false) {
        return 'Disabled';
    }

    const parts: string[] = ['Enabled'];
    const isolation = typeof value.sessionIsolation === 'string' ? value.sessionIsolation : undefined;
    const networkMode = typeof value.networkMode === 'string' ? value.networkMode : undefined;
    const workspaceRoot = typeof value.workspaceRoot === 'string' ? value.workspaceRoot : undefined;

    if (isolation) {
        parts.push(`isolation=${isolation}`);
    }
    if (networkMode) {
        parts.push(`network=${networkMode}`);
    }
    if (workspaceRoot) {
        parts.push(`workspace=${formatPathRelativeToHome(workspaceRoot, homeDir)}`);
    }

    return parts.join(' | ');
}

/** The session's provider as the page names it (the AI Provider row and the header line). */
function sessionProviderName(metadata: NonNullable<Session['metadata']>): string {
    const rigIdentity = getRigIdentity(metadata);
    if (rigIdentity) return rigIdentity.providerName;
    const flavor = metadata.flavor || 'claude';
    if (flavor === 'claude') return 'Claude';
    if (flavor === 'codex' || flavor === 'gpt' || flavor === 'openai') return 'Codex';
    if (flavor === 'gemini') return 'Gemini';
    if (flavor === 'grok') return t('agentInput.agent.grok');
    if (flavor === 'dsh') return t('agentInput.agent.dsh');
    return flavor;
}

function shortId(id: string): string {
    return `${id.substring(0, 8)}...${id.substring(id.length - 8)}`;
}

/** Copies `text`; reports a failure with `failureKey` and returns whether it copied. */
async function copyWithFailureAlert(text: string, failureMessage: string): Promise<boolean> {
    try {
        await Clipboard.setStringAsync(text);
        return true;
    } catch {
        Modal.alert(t('common.error'), failureMessage);
        return false;
    }
}

function SessionInfoContent({ session }: { session: Session }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const projects = useProjects();
    const projectText = t as (key: string, params?: Record<string, string | number>) => string;
    const projectName = session.projectId ? projects[session.projectId]?.name : null;
    const devModeEnabled = __DEV__;
    const sessionStatus = useSessionStatus(session);
    const wide = useHerdWideLayout();
    const machine = useMachine(session.metadata?.machineId ?? '');
    const machineLabel = machine?.metadata?.displayName || machine?.metadata?.host || session.metadata?.host || null;
    const headerLine = session.metadata ? [
        formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir),
        sessionProviderName(session.metadata),
        machineLabel,
    ].filter(Boolean).join(' · ') : null;
    const canOpenChanges = (Platform.OS === 'web' || isRunningOnMac())
        && rigCanBrowseFiles(session.metadata)
        && rigCanUseShell(session.metadata);
    const heartbeatSupported = Boolean(
        session.metadata?.machineId
        && ((session.metadata.flavor ?? 'claude') === 'claude' || session.metadata.flavor === 'codex')
        && ((session.metadata.flavor ?? 'claude') === 'codex'
            ? session.metadata.codexThreadId
            : session.metadata.claudeSessionId),
    );
    const [heartbeatResponse, setHeartbeatResponse] = React.useState<HappyHerdHeartbeatControlResponse | null>(null);
    const [heartbeatBusy, setHeartbeatBusy] = React.useState(false);
    const [heartbeatError, setHeartbeatError] = React.useState<string | null>(null);
    const [heartbeatInterval, setHeartbeatInterval] = React.useState('30');
    const [heartbeatUnit, setHeartbeatUnit] = React.useState<'s' | 'm' | 'h' | 'd'>('m');
    const [heartbeatInstruction, setHeartbeatInstruction] = React.useState('');
    const heartbeatPresentation = heartbeatResponse
        ? formatHeartbeatStatusPresentation(heartbeatResponse, (key, params) => (t as any)(key, params))
        : null;
    const {
        canShowResume,
        canFork,
        canContinueWithProvider,
        forking,
        forkSession,
        openDuplicateSheet,
        openProviderContinuationSheet,
        resumeSession,
        resumeSessionSubtitle,
    } = useSessionQuickActions(session);

    const applyHeartbeatResponse = useCallback((response: HappyHerdHeartbeatControlResponse) => {
        setHeartbeatResponse(response);
        const definition = response.heartbeat;
        if (!definition) return;
        const unit: 's' | 'm' | 'h' | 'd' = definition.intervalSeconds % 86_400 === 0
            ? 'd'
            : definition.intervalSeconds % 3_600 === 0
                ? 'h'
                : definition.intervalSeconds % 60 === 0
                    ? 'm'
                    : 's';
        const multiplier = unit === 'd' ? 86_400 : unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1;
        setHeartbeatInterval(String(definition.intervalSeconds / multiplier));
        setHeartbeatUnit(unit);
        setHeartbeatInstruction(definition.instruction === HAPPYHERD_HEARTBEAT_STANDARD_INSTRUCTION
            ? ''
            : definition.instruction);
    }, []);

    const runHeartbeatAction = useCallback(async (action: Parameters<typeof machineControlHeartbeat>[1]) => {
        const machineId = session.metadata?.machineId;
        if (!machineId) return;
        setHeartbeatBusy(true);
        setHeartbeatError(null);
        try {
            applyHeartbeatResponse(await machineControlHeartbeat(machineId, action));
        } catch (error) {
            setHeartbeatError(error instanceof Error ? error.message : t('happyHerd.heartbeat.unavailable'));
        } finally {
            setHeartbeatBusy(false);
        }
    }, [applyHeartbeatResponse, session.metadata?.machineId]);

    React.useEffect(() => {
        if (!heartbeatSupported || !session.metadata?.machineId) return;
        void runHeartbeatAction({ action: 'status', targetSessionId: session.id });
    }, [heartbeatSupported, runHeartbeatAction, session.id, session.metadata?.machineId]);

    const saveHeartbeat = useCallback(() => {
        const value = Number(heartbeatInterval);
        const multiplier = heartbeatUnit === 'd' ? 86_400 : heartbeatUnit === 'h' ? 3_600 : heartbeatUnit === 'm' ? 60 : 1;
        const intervalSeconds = value * multiplier;
        if (!Number.isInteger(value) || value <= 0 || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < 60) {
            setHeartbeatError(t('happyHerd.heartbeat.minimum'));
            return;
        }
        void runHeartbeatAction({
            action: 'set',
            targetSessionId: session.id,
            intervalSeconds,
            instruction: heartbeatInstruction.trim() || null,
        });
    }, [heartbeatInstruction, heartbeatInterval, heartbeatUnit, runHeartbeatAction, session.id]);

    // Check if CLI version is outdated
    const isCliOutdated = session.metadata?.version && !isVersionSupported(session.metadata.version, MINIMUM_CLI_VERSION);

    const handleCopyMetadata = useCallback(() => {
        void copySessionMetadataToClipboard(session);
    }, [session]);

    const handleCopyMetadataAndLogs = useCallback(() => {
        void copySessionMetadataAndLogsToClipboard(session);
    }, [session]);

    const handleOpenChanges = useCallback(() => {
        if (!canOpenChanges) return;
        const requestId = randomUUID();
        const mountedRoute = findMountedSessionRouteTarget(navigation.getState(), session.id);
        if (mountedRoute) {
            navigation.dispatch({
                ...CommonActions.setParams({ openChangesRequestId: requestId }),
                source: mountedRoute.routeKey,
            });
            navigation.dispatch(StackActions.pop(mountedRoute.popCount));
            return;
        }
        router.replace({
            pathname: '/session/[id]',
            params: {
                id: session.id,
                openChangesRequestId: requestId,
            },
        });
    }, [canOpenChanges, navigation, router, session.id]);

    // Use HappyHerdAction for archiving - it handles errors automatically
    const [archivingSession, performArchive] = useHappyHerdAction(async () => {
        const latestSession = storage.getState().sessions[session.id];
        const isBot = Boolean(latestSession?.metadata?.bot || session.metadata?.bot);
        // A bot's machine owns its single continuous conversation and archive state.
        if (!isBot) {
            await maybeCleanupWorktree(session.id, session.metadata?.path, session.metadata?.machineId);
        }

        // Ask the owning process to archive; ordinary sessions retain the server fallback.
        const killResult = await sessionKill(session.id);
        if (!killResult.success) {
            if (isBot) {
                throw new HappyHerdError(t('sessionInfo.botArchiveRequiresMachine'), false);
            }
            await sessionArchive(session.id);
        }
        // Success - navigate back
        router.back();
        router.back();
    });

    const handleArchiveSession = useCallback(() => {
        performArchive();
    }, [performArchive]);

    // Use HappyHerdAction for deletion - kills session first if needed, then deletes
    const [deletingSession, performDelete] = useHappyHerdAction(async () => {
        const latestSession = storage.getState().sessions[session.id];
        if (latestSession?.metadata?.bot || session.metadata?.bot) {
            throw new HappyHerdError(t('sessionInfo.botDeleteUnavailable'), false);
        }
        // Prompt for worktree cleanup before killing (needs an active machine connection)
        await maybeCleanupWorktree(session.id, session.metadata?.path, session.metadata?.machineId);

        // Navigate back optimistically
        router.back();
        router.back();

        // Kill session first if it's still active (best-effort)
        if (sessionStatus.isConnected || session.active) {
            await sessionKill(session.id).catch(() => {});
        }

        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyHerdError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
    });

    const handleDeleteSession = useCallback(() => {
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    const formatDate = useCallback((timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    }, []);

    const handleCopyUpdateCommand = useCallback(async () => {
        const updateCommand = 'npm install -g @happyherd/cli@latest';
        try {
            await Clipboard.setStringAsync(updateCommand);
            Modal.alert(t('common.success'), updateCommand);
        } catch (error) {
            Modal.alert(t('common.error'), t('common.error'));
        }
    }, []);

    return (
        <>
            <ItemList
                containerStyle={{
                    paddingTop: Platform.OS === 'ios' ? MOBILE_GLASS_HEADER_HEIGHT : 0,
                }}
            >
                {/* The session's title row: back on wide layouts, its status avatar, name and "path · provider · machine" (the mock's page head). */}
                <HerdListHeader testID="session-info-header">
                    <HerdPageHeader
                        compact={!wide}
                        title={wide ? getSessionName(session) : undefined}
                        titleStyle={{ fontSize: 22, lineHeight: 28 }}
                        subtitle={headerLine}
                        subtitleMono
                        leading={(
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                {wide ? (
                                    <HerdButton
                                        icon="arrow-back"
                                        variant="ghost"
                                        accessibilityLabel={t('common.back')}
                                        onPress={() => (router.canGoBack() ? router.back() : router.replace(`/session/${session.id}`))}
                                        testID="session-info-back"
                                    />
                                ) : null}
                                <SessionStatusAvatar
                                    active={session.active}
                                    botId={session.metadata?.bot ? session.metadata.bot.id ?? null : null}
                                    clientId={session.metadata?.client?.id ?? null}
                                    commanderId={session.metadata?.commanderId ?? null}
                                    commanderName={session.metadata?.commanderName ?? null}
                                    flavor={session.metadata?.flavor ?? null}
                                    hasDraft={false}
                                    hasUnread={false}
                                    machineId={session.metadata?.machineId ?? null}
                                    size={52}
                                    state={sessionStatus.state}
                                />
                            </View>
                        )}
                    />
                </HerdListHeader>
                {/* Quick Actions */}
                <ItemGroup title={t('sessionInfo.quickActions')}>
                    <Item
                        title={t('files.changes')}
                        icon={<Ionicons name="git-compare-outline" size={29} color={theme.colors.textLink} />}
                        onPress={canOpenChanges ? handleOpenChanges : undefined}
                        disabled={!canOpenChanges}
                        showChevron={canOpenChanges}
                    />
                    {session.metadata?.machineId && (
                        <Item
                            title={t('sessionInfo.viewMachine')}
                            subtitle={t('sessionInfo.viewMachineSubtitle')}
                            icon={<Ionicons name="server-outline" size={29} color={theme.colors.textLink} />}
                            onPress={() => router.push(`/machine/${session.metadata?.machineId}`)}
                        />
                    )}
                    {canShowResume && (
                        <Item
                            title={t('sessionInfo.resumeSession')}
                            subtitle={resumeSessionSubtitle}
                            icon={<Ionicons name="play-circle-outline" size={29} color={theme.colors.textLink} />}
                            onPress={resumeSession}
                        />
                    )}
                    {canFork && (
                        <Item
                            title={t('session.forkAction')}
                            subtitle={t('session.forkSubtitle')}
                            icon={<Ionicons name="git-branch-outline" size={29} color={theme.colors.textLink} />}
                            onPress={forkSession}
                            loading={forking}
                        />
                    )}
                    {canFork && (
                        <Item
                            title={t('session.duplicateAction')}
                            subtitle={t('session.duplicateSubtitle')}
                            icon={<Ionicons name="time-outline" size={29} color={theme.colors.textLink} />}
                            onPress={openDuplicateSheet}
                        />
                    )}
                    {canContinueWithProvider && (
                        <Item
                            title={t('session.providerContinuationAction')}
                            subtitle={t('session.providerContinuationFreshSession')}
                            icon={<Ionicons name="swap-horizontal-outline" size={29} color={theme.colors.textLink} />}
                            onPress={openProviderContinuationSheet}
                        />
                    )}
                    {session.metadata?.parentSessionId && (
                        <Item
                            title={t('session.forkedFromLabel')}
                            subtitle={t('session.forkedFromSubtitle')}
                            icon={<Ionicons name="return-up-back-outline" size={29} color={theme.colors.textLink} />}
                            onPress={() => router.push(`/session/${session.metadata!.parentSessionId}`)}
                        />
                    )}
                    <Item
                        title={t('sessionInfo.archiveSession')}
                        subtitle={t('sessionInfo.archiveSessionSubtitle')}
                        destructive
                        icon={<Ionicons name="archive-outline" size={29} color={theme.colors.textDestructive} />}
                        onPress={handleArchiveSession}
                        loading={archivingSession}
                    />
                    {!session.metadata?.bot && (
                        <Item
                            title={t('sessionInfo.deleteSession')}
                            subtitle={t('sessionInfo.deleteSessionSubtitle')}
                            destructive
                            icon={<Ionicons name="trash-outline" size={29} color={theme.colors.textDestructive} />}
                            onPress={handleDeleteSession}
                        />
                    )}
                </ItemGroup>

                {/* CLI Version Warning */}
                {isCliOutdated && (
                    <ItemGroup>
                        <Item
                            title={t('sessionInfo.cliVersionOutdated')}
                            subtitle={t('sessionInfo.updateCliInstructions')}
                            icon={<Ionicons name="warning-outline" size={29} color={theme.colors.warning} />}
                            showChevron={false}
                            onPress={handleCopyUpdateCommand}
                        />
                    </ItemGroup>
                )}

                {/* Session Details */}
                <ItemGroup>
                    <Item
                        title={projectText('projects.project')}
                        detail={projectName ?? (session.projectId
                            ? projectText('projects.project')
                            : projectText('projects.noProject'))}
                        icon={<Ionicons name="albums-outline" size={29} color={theme.colors.textLink} />}
                        onPress={() => router.push(`/session/${session.id}/project` as any)}
                    />
                    <HerdValueItem
                        title={t('sessionInfo.happySessionId')}
                        value={shortId(session.id)}
                        mono
                        onCopy={() => copyWithFailureAlert(session.id, t('sessionInfo.failedToCopySessionId'))}
                        testID="session-info-happyherd-id"
                    />
                    {session.metadata?.claudeSessionId && (
                        <HerdValueItem
                            title={t('sessionInfo.claudeCodeSessionId')}
                            value={shortId(session.metadata.claudeSessionId)}
                            mono
                            onCopy={() => copyWithFailureAlert(session.metadata!.claudeSessionId!, t('sessionInfo.failedToCopyClaudeCodeSessionId'))}
                            testID="session-info-claude-id"
                        />
                    )}
                    {session.metadata?.codexThreadId && (
                        <HerdValueItem
                            title={t('sessionInfo.codexThreadId')}
                            value={shortId(session.metadata.codexThreadId)}
                            mono
                            onCopy={() => copyWithFailureAlert(session.metadata!.codexThreadId!, t('sessionInfo.failedToCopyCodexThreadId'))}
                            testID="session-info-codex-id"
                        />
                    )}
                    {/* Resume command — shown for disconnected sessions with a backend session ID */}
                    {/* TODO: migrate to `happyherd resume <happyherd-session-id>` once it works without happyherd-control-agent auth */}
                    {!sessionStatus.isConnected && getResumeCommand(session) && (
                        <HerdValueItem
                            title={t("uiCopy.resumeCommand")}
                            value={getResumeCommand(session)!}
                            mono
                            copyText={getResumeCommand(session)!}
                            testID="session-info-resume-command"
                        />
                    )}
                    <HerdValueItem
                        title={t('sessionInfo.connectionStatus')}
                        value={sessionStatus.isConnected ? t('status.online') : t('status.offline')}
                        prefix={<HerdDot tone={sessionStatus.isConnected ? 'ok' : 'off'} />}
                        testID="session-info-connection"
                    />
                    <HerdValueItem title={t('sessionInfo.created')} value={formatDate(session.createdAt)} />
                    <HerdValueItem title={t('sessionInfo.lastUpdated')} value={formatDate(session.updatedAt)} />
                    <HerdValueItem title={t('sessionInfo.sequence')} value={session.seq.toString()} mono />
                </ItemGroup>

                {heartbeatSupported && (
                    <ItemGroup title={t('happyHerd.heartbeat.title')}>
                        <Item
                            title={heartbeatPresentation
                                ? heartbeatPresentation.summary
                                : t('happyHerd.heartbeat.notConfigured')}
                            subtitle={heartbeatPresentation?.details.join('\n')}
                            icon={<Ionicons name="heart-outline" size={29} color={theme.colors.textDestructive} />}
                            showChevron={false}
                        />
                        <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
                            <Text style={{ color: theme.colors.textSecondary }}>{t('happyHerd.heartbeat.every')}</Text>
                            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                <TextInput
                                    value={heartbeatInterval}
                                    onChangeText={setHeartbeatInterval}
                                    keyboardType="number-pad"
                                    accessibilityLabel={t('happyHerd.heartbeat.interval')}
                                    style={{
                                        flex: 1,
                                        minHeight: 42,
                                        borderWidth: 1,
                                        borderColor: theme.colors.divider,
                                        borderRadius: theme.borderRadius.md,
                                        color: theme.colors.text,
                                        paddingHorizontal: 12,
                                    }}
                                />
                                {(['s', 'm', 'h', 'd'] as const).map((unit) => (
                                    <Pressable
                                        key={unit}
                                        onPress={() => setHeartbeatUnit(unit)}
                                        style={{
                                            paddingHorizontal: 12,
                                            paddingVertical: 10,
                                            borderRadius: theme.borderRadius.md,
                                            backgroundColor: heartbeatUnit === unit ? theme.colors.textLink : theme.colors.surfaceHigh,
                                        }}
                                    >
                                        <Text style={{ color: heartbeatUnit === unit ? theme.colors.surface : theme.colors.text }}>{unit}</Text>
                                    </Pressable>
                                ))}
                            </View>
                            <TextInput
                                value={heartbeatInstruction}
                                onChangeText={setHeartbeatInstruction}
                                placeholder={t('happyHerd.heartbeat.instructionPlaceholder')}
                                placeholderTextColor={theme.colors.textSecondary}
                                multiline
                                style={{
                                    minHeight: 72,
                                    borderWidth: 1,
                                    borderColor: theme.colors.divider,
                                    borderRadius: theme.borderRadius.md,
                                    color: theme.colors.text,
                                    padding: 12,
                                }}
                            />
                            {heartbeatError && <Text style={{ color: theme.colors.textDestructive }}>{heartbeatError}</Text>}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                <Pressable onPress={saveHeartbeat} disabled={heartbeatBusy} style={{ padding: 10 }}>
                                    {heartbeatBusy
                                        ? <ActivityIndicator />
                                        : <Text style={{ color: theme.colors.textLink }}>{t('common.save')}</Text>}
                                </Pressable>
                                {heartbeatResponse?.heartbeat && (
                                    <Pressable
                                        onPress={() => void runHeartbeatAction({
                                            action: heartbeatResponse.heartbeat?.status === 'paused' ? 'resume' : 'pause',
                                            targetSessionId: session.id,
                                        })}
                                        disabled={heartbeatBusy}
                                        style={{ padding: 10 }}
                                    >
                                        <Text style={{ color: theme.colors.textLink }}>
                                            {heartbeatResponse.heartbeat.status === 'paused'
                                                ? t('happyHerd.heartbeat.resume')
                                                : t('happyHerd.heartbeat.pause')}
                                        </Text>
                                    </Pressable>
                                )}
                                {heartbeatResponse?.heartbeat && (
                                    <Pressable
                                        onPress={() => void runHeartbeatAction({ action: 'clear', targetSessionId: session.id })}
                                        disabled={heartbeatBusy}
                                        style={{ padding: 10 }}
                                    >
                                        <Text style={{ color: theme.colors.textDestructive }}>{t('happyHerd.heartbeat.clear')}</Text>
                                    </Pressable>
                                )}
                                <Pressable onPress={() => router.push('/automations')} style={{ padding: 10 }}>
                                    <Text style={{ color: theme.colors.textLink }}>{t('happyHerd.heartbeat.automation')}</Text>
                                </Pressable>
                            </View>
                        </View>
                    </ItemGroup>
                )}

                {/* Metadata */}
                {session.metadata && (
                    <ItemGroup title={t('sessionInfo.metadata')}>
                        <HerdValueItem title={t('sessionInfo.host')} value={session.metadata.host} mono />
                        <HerdValueItem
                            title={t('sessionInfo.path')}
                            value={formatPathRelativeToHome(session.metadata.path, session.metadata.homeDir)}
                            mono
                        />
                        {session.metadata.version && (
                            <HerdValueItem
                                title={t('sessionInfo.cliVersion')}
                                value={session.metadata.version}
                                mono
                                trailing={isCliOutdated ? <Ionicons name="warning-outline" size={15} color={theme.colors.warning} /> : undefined}
                                valueStyle={isCliOutdated ? { color: theme.colors.warning } : undefined}
                            />
                        )}
                        {session.metadata.os && (
                            <HerdValueItem title={t('sessionInfo.operatingSystem')} value={formatOSPlatform(session.metadata.os)} />
                        )}
                        {isRigMetadata(session.metadata) && (
                            <HerdValueItem
                                title={t("uiCopy.client")}
                                value={`${session.metadata.client?.name ?? DEFAULT_RIG_NAME}${session.metadata.client?.version ? ` ${session.metadata.client.version}` : ''}`}
                            />
                        )}
                        <HerdValueItem title={t('sessionInfo.aiProvider')} value={sessionProviderName(session.metadata)} />
                        {(getRigIdentity(session.metadata)?.modelName || (
                            (session.metadata.flavor === 'grok' || session.metadata.flavor === 'dsh')
                            && session.metadata.currentModelCode
                        )) && (
                            <HerdValueItem
                                title={t("uiCopy.model")}
                                value={getRigIdentity(session.metadata)?.modelName
                                    ?? session.metadata?.models?.find((model) => model.code === session.metadata?.currentModelCode)?.value
                                    ?? session.metadata?.currentModelCode}
                                mono
                            />
                        )}
                        {!isRigMetadata(session.metadata) && (
                            <HerdValueItem
                                title={t("uiCopy.sandbox")}
                                value={formatSandboxMetadata(session.metadata.sandbox, session.metadata.homeDir)}
                                mono
                                valueLines={2}
                            />
                        )}
                        {!isRigMetadata(session.metadata) && (
                            <HerdValueItem
                                title={t("uiCopy.dangerouslySkipPermissions")}
                                value={formatDangerouslySkipPermissionsMetadata(
                                    session.metadata.dangerouslySkipPermissions,
                                    session.permissionMode,
                                )}
                                valueLines={2}
                            />
                        )}
                        {session.metadata.hostPid && (
                            <HerdValueItem title={t('sessionInfo.processId')} value={session.metadata.hostPid.toString()} mono />
                        )}
                        {session.metadata.happyHomeDir && (
                            <HerdValueItem
                                title={t('sessionInfo.happyherdHome')}
                                value={formatPathRelativeToHome(session.metadata.happyHomeDir, session.metadata.homeDir)}
                                mono
                            />
                        )}
                        <Item
                            title={t('sessionInfo.copyMetadata')}
                            icon={<Ionicons name="copy-outline" size={29} color={theme.colors.textLink} />}
                            onPress={handleCopyMetadata}
                        />
                        <Item
                            title={t('uiCopy.copyMetadataAndClientLogs')}
                            icon={<Ionicons name="document-text-outline" size={29} color={theme.colors.textLink} />}
                            onPress={handleCopyMetadataAndLogs}
                        />
                    </ItemGroup>
                )}

                {/* Agent State */}
                {session.agentState && session.metadata?.client?.id !== 'rig' && (
                    <ItemGroup title={t('sessionInfo.agentState')}>
                        <HerdValueItem
                            title={t('sessionInfo.controlledByUser')}
                            value={session.agentState.controlledByUser ? t('common.yes') : t('common.no')}
                        />
                        {session.agentState.requests && Object.keys(session.agentState.requests).length > 0 && (
                            <HerdValueItem
                                title={t('sessionInfo.pendingRequests')}
                                value={Object.keys(session.agentState.requests).length.toString()}
                                mono
                            />
                        )}
                    </ItemGroup>
                )}

                {/* Activity */}
                <ItemGroup title={t('sessionInfo.activity')}>
                    <HerdValueItem
                        title={t('sessionInfo.thinking')}
                        value={session.thinking ? t('common.yes') : t('common.no')}
                    />
                    {session.thinking && (
                        <HerdValueItem title={t('sessionInfo.thinkingSince')} value={formatDate(session.thinkingAt)} />
                    )}
                    {(session.metadata?.activity?.subagents.running ?? 0) + (session.metadata?.activity?.subagents.queued ?? 0) > 0 && (
                        <HerdValueItem
                            title={t("uiCopy.subagents")}
                            value={t('uiCopy.runningAndQueued', {
                                value1: session.metadata!.activity!.subagents.running,
                                value2: session.metadata!.activity!.subagents.queued,
                            })}
                        />
                    )}
                    {(session.metadata?.activity?.workflows.running ?? 0) > 0 && (
                        <HerdValueItem title={t("uiCopy.workflows")} value={t('uiCopy.valueRunning', { value1: session.metadata!.activity!.workflows.running })} />
                    )}
                    {(session.metadata?.activity?.processes.running ?? 0) > 0 && (
                        <HerdValueItem title={t("uiCopy.backgroundProcesses")} value={t('uiCopy.valueRunning', { value1: session.metadata!.activity!.processes.running })} />
                    )}
                    {(session.metadata?.activity?.tasks.pending ?? 0) + (session.metadata?.activity?.tasks.inProgress ?? 0) > 0 && (
                        <HerdValueItem title={t("uiCopy.tasks")} value={t('uiCopy.inProgressAndPending', { value1: session.metadata!.activity!.tasks.inProgress, value2: session.metadata!.activity!.tasks.pending })} />
                    )}
                </ItemGroup>

                {/* Raw JSON (Dev Mode Only) */}
                {devModeEnabled && (
                    <ItemGroup title={t("tools.fullView.rawJsonDevMode")}>
                        {session.agentState && (
                            <>
                                <Item
                                    title={t("sessionInfo.agentState")}
                                    icon={<Ionicons name="code-working-outline" size={29} color={theme.colors.warning} />}
                                    showChevron={false}
                                />
                                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                                    <CodeView
                                        code={JSON.stringify(session.agentState, null, 2)}
                                        language="json"
                                    />
                                </View>
                            </>
                        )}
                        {session.metadata && (
                            <>
                                <Item
                                    title={t("sessionInfo.metadata")}
                                    icon={<Ionicons name="information-circle-outline" size={29} color={theme.colors.textLink} />}
                                    showChevron={false}
                                />
                                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                                    <CodeView
                                        code={JSON.stringify(session.metadata, null, 2)}
                                        language="json"
                                    />
                                </View>
                            </>
                        )}
                        {sessionStatus && (
                            <>
                                <Item
                                    title={t("uiCopy.sessionStatus")}
                                    icon={<Ionicons name="analytics-outline" size={29} color={theme.colors.textLink} />}
                                    showChevron={false}
                                />
                                <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                                    <CodeView
                                        code={JSON.stringify({
                                            isConnected: sessionStatus.isConnected,
                                            statusText: sessionStatus.statusText,
                                            statusColor: sessionStatus.statusColor,
                                            statusDotColor: sessionStatus.statusDotColor,
                                            isPulsing: sessionStatus.isPulsing
                                        }, null, 2)}
                                        language="json"
                                    />
                                </View>
                            </>
                        )}
                        {/* Full Session Object */}
                        <Item
                            title={t("uiCopy.fullSessionObject")}
                            icon={<Ionicons name="document-text-outline" size={29} color={theme.colors.success} />}
                            showChevron={false}
                        />
                        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
                            <CodeView
                                code={JSON.stringify(session, null, 2)}
                                language="json"
                            />
                        </View>
                    </ItemGroup>
                )}
            </ItemList>
        </>
    );
}

export default React.memo(() => {
    const { theme } = useUnistyles();
    const { id } = useLocalSearchParams<{ id: string }>();
    const session = useSession(id);
    const isDataReady = useIsDataReady();
    const screenTitle = session
        ? getSessionName(session)
        : isDataReady
            ? t('errors.sessionDeleted')
            : '';
    const wide = useHerdWideLayout();
    // With a session, wide web draws the title in the page, so the stack header steps aside.
    const screenOptions = <Stack.Screen options={{ headerTitle: screenTitle, headerShown: !(wide && session) }} />;

    // Handle three states: loading, deleted, and exists
    if (!isDataReady) {
        // Still loading data
        return (
            <>
                {screenOptions}
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.groupped.background }}>
                    <Ionicons name="hourglass-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 17, marginTop: 16, ...Typography.default('semiBold') }}>{t('common.loading')}</Text>
                </View>
            </>
        );
    }

    if (!session) {
        // Session has been deleted or doesn't exist
        return (
            <>
                {screenOptions}
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.groupped.background }}>
                    <Ionicons name="trash-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={{ color: theme.colors.text, fontSize: 20, marginTop: 16, ...Typography.default('semiBold') }}>{t('errors.sessionDeleted')}</Text>
                    <Text style={{ color: theme.colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', paddingHorizontal: 32, ...Typography.default() }}>{t('errors.sessionDeletedDescription')}</Text>
                </View>
            </>
        );
    }

    return (
        <>
            {screenOptions}
            <SessionInfoContent session={session} />
        </>
    );
});
