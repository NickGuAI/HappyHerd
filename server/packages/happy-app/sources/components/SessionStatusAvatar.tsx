import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { getProviderIconKind } from '@/sync/rig';
import { useSetting } from '@/sync/storage';
import { t } from '@/text';
import { resolveAvatarHarness } from '@/utils/avatarHarness';
import type { SessionState } from '@/utils/sessionUtils';
import {
    identityInitials,
    resolveSessionStatusAvatar,
    type SessionStatusAvatarState,
} from '@/utils/sessionStatusAvatar';
import { CommanderSessionAvatar } from './CommanderSessionAvatar';
import { HarnessBadgeIcon } from './HarnessBadgeIcon';
import { ProviderIcon } from './ProviderIcon';
import { StatusPulse } from './StatusDot';

function statusLabel(state: SessionStatusAvatarState): string {
    switch (state) {
        case 'action-required': return t('happyHerd.sessionStatusAvatar.actionRequired');
        case 'unread': return t('happyHerd.sessionStatusAvatar.unread');
        case 'thinking': return t('happyHerd.sessionStatusAvatar.thinking');
        case 'waiting': return t('happyHerd.sessionStatusAvatar.waiting');
        case 'disconnected': return t('happyHerd.sessionStatusAvatar.disconnected');
        case 'idle': return t('happyHerd.sessionStatusAvatar.idle');
    }
}

export function SessionStatusAvatar({
    active,
    clientId,
    commanderId,
    commanderName,
    flavor,
    hasDraft,
    hasUnread,
    machineId,
    machineOffline,
    providerKind,
    providerLabel,
    size = 60,
    state,
}: {
    active: boolean;
    clientId?: string | null;
    commanderId?: string | null;
    commanderName?: string | null;
    flavor?: string | null;
    hasDraft: boolean;
    hasUnread: boolean;
    machineId: string | null;
    machineOffline?: boolean;
    providerKind?: string | null;
    providerLabel?: string | null;
    size?: number;
    state: SessionState;
}) {
    const { theme } = useUnistyles();
    const reduceMotion = useReducedMotion();
    const commanderProfilePictures = useSetting('commanderProfilePictures');
    const presentation = resolveSessionStatusAvatar({
        active,
        hasUnread,
        machineOffline,
        state,
    });
    const ringColor = presentation.state === 'action-required'
        ? theme.colors.permission.bypass
        : presentation.state === 'unread' || presentation.state === 'thinking'
            ? theme.colors.radio.active
            : presentation.state === 'waiting'
                ? theme.colors.status.connected
                : presentation.state === 'disconnected'
                    ? theme.colors.status.disconnected
                    : theme.colors.status.default;
    const innerSize = Math.max(12, size - 8);
    const badgeSize = Math.max(10, Math.round(size * 0.28));
    const badgeIconSize = Math.max(7, Math.round(badgeSize * 0.68));
    const providerIdentity = providerKind?.trim()
        || (flavor === 'claude' || flavor === 'codex' || flavor === 'grok' ? flavor : null);
    const mappedProvider = getProviderIconKind(providerIdentity);
    const providerDisplayLabel = providerLabel?.split(/\s+·\s+/).at(-1)?.trim();
    const fallbackProviderLabel = providerDisplayLabel
        || providerIdentity
        || clientId?.trim()
        || flavor?.trim()
        || t('status.unknown');
    const identityLabel = commanderId
        ? commanderName?.trim() || commanderId
        : fallbackProviderLabel;
    const harness = resolveAvatarHarness(flavor, clientId);
    const daemonIdentityLabel = machineId?.trim()
        ? `${t('machine.machineId')}: ${machineId.trim()}`
        : null;
    const accessibilityLabel = [
        identityLabel,
        daemonIdentityLabel,
        statusLabel(presentation.state),
    ].filter(Boolean).join(', ');

    const identity = commanderId ? (
        <CommanderSessionAvatar
            accessible={false}
            machineId={commanderProfilePictures ? machineId : null}
            commanderId={commanderId}
            commanderName={commanderName}
            size={innerSize}
        />
    ) : (
        <View
            accessible={false}
            style={[
                styles.providerIdentity,
                {
                    backgroundColor: theme.colors.surfaceHighest,
                    borderRadius: innerSize / 2,
                    height: innerSize,
                    width: innerSize,
                },
            ]}
        >
            {mappedProvider === 'generic' ? (
                <Text
                    allowFontScaling={false}
                    style={[
                        styles.providerInitials,
                        {
                            color: theme.colors.text,
                            fontSize: Math.max(8, Math.round(innerSize * 0.34)),
                            lineHeight: Math.max(10, Math.round(innerSize * 0.42)),
                        },
                    ]}
                >
                    {identityInitials(fallbackProviderLabel, 'agent')}
                </Text>
            ) : (
                <ProviderIcon kind={providerIdentity} size={Math.max(10, Math.round(innerSize * 0.52))} />
            )}
        </View>
    );

    return (
        <View
            accessible
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="image"
            accessibilityState={{ busy: presentation.pulsing }}
            style={[styles.container, { height: size, width: size }]}
        >
            <View style={[styles.identity, presentation.faded && styles.identityFaded]}>
                {identity}
            </View>
            <StatusPulse
                isPulsing={presentation.pulsing && !reduceMotion}
                style={[
                    styles.ring,
                    {
                        borderColor: ringColor,
                        borderRadius: size / 2,
                        borderWidth: presentation.ringWidth,
                        height: size,
                        width: size,
                    },
                ]}
            />
            {harness && (
                <View
                    accessible={false}
                    style={[
                        styles.badge,
                        styles.harnessBadge,
                        {
                            backgroundColor: theme.colors.surface,
                            borderRadius: badgeSize / 2,
                            height: badgeSize,
                            width: badgeSize,
                        },
                    ]}
                >
                    <HarnessBadgeIcon harness={harness} size={badgeIconSize} />
                </View>
            )}
            {hasDraft && (
                <View
                    accessible={false}
                    style={[
                        styles.badge,
                        styles.draftBadge,
                        {
                            backgroundColor: theme.colors.surface,
                            borderRadius: badgeSize / 2,
                            height: badgeSize,
                            width: badgeSize,
                        },
                    ]}
                >
                    <Ionicons
                        name="create-outline"
                        size={badgeIconSize}
                        color={theme.colors.textSecondary}
                    />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create(() => ({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    identity: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    identityFaded: {
        opacity: 0.55,
    },
    ring: {
        position: 'absolute',
    },
    providerIdentity: {
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    providerInitials: {
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    badge: {
        alignItems: 'center',
        justifyContent: 'center',
        position: 'absolute',
    },
    harnessBadge: {
        bottom: -1,
        left: -1,
    },
    draftBadge: {
        bottom: -1,
        right: -1,
    },
}));
