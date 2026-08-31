import * as React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useHappyAction } from '@/hooks/useHappyAction';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { HappyError } from '@/utils/errors';
import { isMachineOnline } from '@/utils/machineUtils';
import { getDuplicateSheetFrame } from '@/utils/duplicateSheetLayout';
import {
    buildProviderContinuationPrompt,
    getProviderContinuationLabel,
    getProviderContinuationSource,
    getProviderContinuationTarget,
    type ProviderContinuationProvider,
} from '@/utils/providerContinuation';
import { machineSpawnNewSession } from '@/sync/ops';
import { sync } from '@/sync/sync';
import { useMachine, useSession, useSessionMessages } from '@/sync/storage';
import { t } from '@/text';
import { MobileGlassSurface } from './MobileGlass';

export interface ProviderContinuationSheetProps {
    sessionId: string;
    onClose?: () => void;
}

export const ProviderContinuationSheet = React.memo(function ProviderContinuationSheet({
    sessionId,
    onClose,
}: ProviderContinuationSheetProps) {
    const session = useSession(sessionId);
    const machine = useMachine(session?.metadata?.machineId ?? '');
    const { messages, isLoaded: messagesLoaded } = useSessionMessages(sessionId);
    const navigateToSession = useNavigateToSession();
    const { theme } = useUnistyles();
    const windowSize = useWindowDimensions();
    const sheetFrame = React.useMemo(() => getDuplicateSheetFrame(windowSize), [windowSize.width, windowSize.height]);
    const sourceProvider = session ? getProviderContinuationSource(session.metadata?.flavor) : null;
    const targetProvider = session ? getProviderContinuationTarget(session.metadata?.flavor) : null;
    const canContinue = Boolean(
        session
        && sourceProvider
        && targetProvider
        && session.metadata?.machineId
        && session.metadata.path
        && machine
        && isMachineOnline(machine)
        && machine.metadata?.cliAvailability?.[targetProvider] === true
    );

    const [loading, continueWithProvider] = useHappyAction(async () => {
        if (!session || !sourceProvider || !targetProvider || !canContinue) {
            throw new HappyError(t('session.providerContinuationUnavailable'), false);
        }

        let sourceMessages = messages;
        if (!messagesLoaded) {
            try {
                const loadedMessages = await sync.ensureSessionMessagesLoaded(session.id);
                if (!loadedMessages) {
                    throw new Error('source messages did not load');
                }
                sourceMessages = loadedMessages;
            } catch {
                throw new HappyError(t('session.providerContinuationHandoffFailed'), false);
            }
        }

        const result = await machineSpawnNewSession({
            machineId: session.metadata!.machineId!,
            directory: session.metadata!.path,
            approvedNewDirectoryCreation: false,
            agent: targetProvider,
            commanderId: session.metadata?.commanderId,
            continuedFromSessionId: session.id,
        });
        if (result.type !== 'success') {
            throw new HappyError(
                result.type === 'error'
                    ? result.errorMessage
                    : t('session.providerContinuationUnavailable'),
                false,
            );
        }

        let receipt;
        try {
            receipt = await sync.sendMessage(
                result.sessionId,
                buildProviderContinuationPrompt({ messages: sourceMessages, sourceProvider, targetProvider }),
                {
                    source: 'new_session',
                    displayText: t('session.providerContinuationHandoff', {
                        provider: getProviderContinuationLabel(sourceProvider),
                    }),
                    providerContinuationHandoff: true,
                    awaitDelivery: true,
                },
            );
        } catch {
            throw new HappyError(t('session.providerContinuationHandoffFailed'), false);
        }
        if (!receipt) {
            throw new HappyError(t('session.providerContinuationHandoffFailed'), false);
        }

        onClose?.();
        navigateToSession(result.sessionId);
    });

    return (
        <MobileGlassSurface
            enabled={Platform.OS !== 'web'}
            nativeEffect
            glassEffectStyle="regular"
            intensity={88}
            tintColor={theme.colors.glass.overlayTint}
            style={[styles.sheet, sheetFrame]}
        >
            <View style={styles.header}>
                <Text style={styles.title}>{t('session.providerContinuationTitle')}</Text>
                <Text style={styles.subtitle}>{t('session.providerContinuationSubtitle')}</Text>
            </View>

            <View style={styles.providers}>
                {sourceProvider && (
                    <ProviderRow
                        provider={sourceProvider}
                        detail={t('session.providerContinuationCurrent')}
                        disabled
                    />
                )}
                {targetProvider && (
                    <ProviderRow
                        provider={targetProvider}
                        detail={canContinue
                            ? t('session.providerContinuationFreshSession')
                            : t('session.providerContinuationNotAvailable')}
                        disabled={!canContinue || loading}
                        loading={loading}
                        onPress={continueWithProvider}
                    />
                )}
            </View>

            <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
        </MobileGlassSurface>
    );
});

function ProviderRow({
    provider,
    detail,
    disabled,
    loading = false,
    onPress,
}: {
    provider: ProviderContinuationProvider;
    detail: string;
    disabled: boolean;
    loading?: boolean;
    onPress?: () => void;
}) {
    const { theme } = useUnistyles();
    const label = getProviderContinuationLabel(provider);
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={disabled}
            onPress={onPress}
            testID={`provider-continuation-${provider}`}
            style={({ pressed }) => [
                styles.provider,
                disabled && styles.disabled,
                pressed && !disabled && styles.pressed,
            ]}
        >
            <View style={[styles.providerIcon, { backgroundColor: theme.colors.surfaceHigh }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={19} color={theme.colors.text} />
            </View>
            <View style={styles.providerCopy}>
                <Text style={styles.providerName}>{label}</Text>
                <Text style={styles.providerDetail}>{detail}</Text>
            </View>
            {loading ? (
                <ActivityIndicator size="small" />
            ) : !disabled ? (
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    sheet: {
        alignSelf: 'center',
        backgroundColor: Platform.select({
            web: theme.colors.surface,
            ios: theme.colors.glass.overlay,
            android: theme.colors.glass.backgroundStrong,
            default: theme.colors.surface,
        }),
        borderColor: theme.colors.glass.border,
        borderRadius: 16,
        borderWidth: Platform.OS === 'web' ? 0 : StyleSheet.hairlineWidth,
        minWidth: 0,
        overflow: 'hidden',
    },
    header: {
        borderBottomColor: theme.colors.divider,
        borderBottomWidth: StyleSheet.hairlineWidth,
        paddingBottom: 14,
        paddingHorizontal: 20,
        paddingTop: 20,
    },
    title: {
        color: theme.colors.text,
        fontSize: 17,
        fontWeight: '600' as const,
    },
    subtitle: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
        marginTop: 4,
    },
    providers: {
        paddingVertical: 8,
    },
    provider: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 12,
        minHeight: 64,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    providerIcon: {
        alignItems: 'center',
        borderRadius: 12,
        height: 40,
        justifyContent: 'center',
        width: 40,
    },
    providerCopy: {
        flex: 1,
    },
    providerName: {
        color: theme.colors.text,
        fontSize: 15,
        fontWeight: '600' as const,
    },
    providerDetail: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        marginTop: 2,
    },
    disabled: {
        opacity: 0.55,
    },
    pressed: {
        opacity: 0.7,
    },
    cancel: {
        alignItems: 'center',
        backgroundColor: theme.colors.surfaceHigh,
        borderTopColor: theme.colors.divider,
        borderTopWidth: StyleSheet.hairlineWidth,
        justifyContent: 'center',
        minHeight: 48,
    },
    cancelText: {
        color: theme.colors.text,
        fontSize: 15,
        fontWeight: '500' as const,
    },
}));
