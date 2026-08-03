import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Text } from '@/components/StyledText';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Switch } from '@/components/Switch';
import { UsageBar } from '@/components/usage/UsageBar';
import { useSettingMutable, useEntitlement, useLocalSetting, useLocalSettingMutable, useSetting } from '@/sync/storage';
import { useAuth } from '@/auth/AuthContext';
import { findLanguageByCode, getLanguageDisplayName, LANGUAGES } from '@/constants/Languages';
import {
    configureVoiceTranscriptionKey,
    fetchVoiceTranscriptionKeyStatus,
    fetchVoiceUsage,
    removeVoiceTranscriptionKey,
    testVoiceTranscriptionKey,
    type VoiceTranscriptionKeyStatus,
    type VoiceUsageResponse,
} from '@/sync/apiVoice';
import { t } from '@/text';
import { Modal } from '@/modal';
import { sync } from '@/sync/sync';
import { trackPaywallButtonClicked } from '@/track';
import { getVoiceExperimentStatus, getVoiceUpsellVariantLabel } from '@/realtime/voiceExperiment';
import { getVoiceLocalCounters, resetVoiceLocalCounters } from '@/sync/persistence';

function formatVoiceTime(totalSeconds: number): string {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs}s`;
}

export default React.memo(function VoiceSettingsScreen() {
    const router = useRouter();
    const auth = useAuth();
    const [voiceAssistantLanguage] = useSettingMutable('voiceAssistantLanguage');
    const [voiceCustomAgentId, setVoiceCustomAgentId] = useSettingMutable('voiceCustomAgentId');
    const [voiceBypassToken, setVoiceBypassToken] = useSettingMutable('voiceBypassToken');
    const [voiceUpsellOverride, setVoiceUpsellOverride] = useLocalSettingMutable('voiceUpsellOverride');
    const experiments = useSetting('experiments');
    const devModeEnabled = __DEV__ || useLocalSetting('devModeEnabled');

    const hasPro = useEntitlement('pro');

    const [usage, setUsage] = React.useState<VoiceUsageResponse | null>(null);
    const [usageLoading, setUsageLoading] = React.useState(true);
    const [transcriptionKeyStatus, setTranscriptionKeyStatus] = React.useState<VoiceTranscriptionKeyStatus | null>(null);
    const [transcriptionKeyLoading, setTranscriptionKeyLoading] = React.useState(true);
    const [transcriptionKeyAction, setTranscriptionKeyAction] = React.useState(false);
    const [voiceLocalCounters, setVoiceLocalCounters] = React.useState(() => getVoiceLocalCounters());

    React.useEffect(() => {
        if (!auth.credentials) return;
        fetchVoiceUsage(auth.credentials)
            .then(setUsage)
            .catch(() => {})
            .finally(() => setUsageLoading(false));
    }, [auth.credentials]);

    React.useEffect(() => {
        if (!auth.credentials) return;
        fetchVoiceTranscriptionKeyStatus(auth.credentials)
            .then(setTranscriptionKeyStatus)
            .catch(() => setTranscriptionKeyStatus(null))
            .finally(() => setTranscriptionKeyLoading(false));
    }, [auth.credentials]);

    // Find current language or default to first option
    const currentLanguage = findLanguageByCode(voiceAssistantLanguage) || LANGUAGES[0];

    const handleSupportUs = React.useCallback(async () => {
        trackPaywallButtonClicked('voluntary_support');
        await sync.presentPaywall('voluntary_support');
    }, []);

    const handleConfigureTranscriptionKey = React.useCallback(async () => {
        if (!auth.credentials || transcriptionKeyAction) return;
        const value = await Modal.prompt(
            'OpenAI API key',
            'Used only for voice dictation transcription. HappyHerd encrypts it for this account and never shows it again.',
            {
                placeholder: 'sk-…',
                inputType: 'secure-text',
            },
        );
        if (value === null || !value.trim()) return;
        setTranscriptionKeyAction(true);
        try {
            const status = await configureVoiceTranscriptionKey(auth.credentials, value.trim());
            setTranscriptionKeyStatus(status);
            Modal.alert('OpenAI API key configured', 'The key was accepted and stored securely for voice dictation.');
        } catch (error) {
            Modal.alert('Could not configure OpenAI API key', error instanceof Error ? error.message : 'The key could not be saved.');
        } finally {
            setTranscriptionKeyAction(false);
        }
    }, [auth.credentials, transcriptionKeyAction]);

    const handleTestTranscriptionKey = React.useCallback(async () => {
        if (!auth.credentials || transcriptionKeyAction) return;
        setTranscriptionKeyAction(true);
        try {
            await testVoiceTranscriptionKey(auth.credentials);
            Modal.alert('OpenAI API key works', 'Voice dictation can reach OpenAI with the configured key.');
        } catch (error) {
            Modal.alert('OpenAI API key test failed', error instanceof Error ? error.message : 'The key could not be tested.');
        } finally {
            setTranscriptionKeyAction(false);
        }
    }, [auth.credentials, transcriptionKeyAction]);

    const handleRemoveTranscriptionKey = React.useCallback(async () => {
        if (!auth.credentials || transcriptionKeyAction) return;
        const confirmed = await Modal.confirm(
            'Remove OpenAI API key?',
            'Voice dictation will use the deployment key if one exists; otherwise it will stop working.',
            { confirmText: 'Remove', destructive: true },
        );
        if (!confirmed) return;
        setTranscriptionKeyAction(true);
        try {
            setTranscriptionKeyStatus(await removeVoiceTranscriptionKey(auth.credentials));
        } catch (error) {
            Modal.alert('Could not remove OpenAI API key', error instanceof Error ? error.message : 'The key could not be removed.');
        } finally {
            setTranscriptionKeyAction(false);
        }
    }, [auth.credentials, transcriptionKeyAction]);

    const handleCustomAgentId = React.useCallback(async () => {
        const value = await Modal.prompt(
            t('settingsVoice.customAgentId'),
            t('settingsVoice.customAgentIdDescription'),
            {
                defaultValue: voiceCustomAgentId ?? '',
                placeholder: t('settingsVoice.customAgentIdPlaceholder'),
            }
        );
        if (value !== null) {
            const trimmed = value.trim() || null;
            setVoiceCustomAgentId(trimmed);
            // Auto-toggle bypass when setting/clearing agent ID
            setVoiceBypassToken(trimmed !== null);
        }
    }, [voiceCustomAgentId, setVoiceCustomAgentId, setVoiceBypassToken]);

    const handleVoiceExperimentOverride = React.useCallback(() => {
        Modal.alert(
            'Voice Experiment Override',
            'Select a local override for the voice-upsell experiment.',
            [
                { text: 'No Override', onPress: () => setVoiceUpsellOverride(null) },
                { text: 'Control', onPress: () => setVoiceUpsellOverride('control') },
                { text: 'Soft Paywall', onPress: () => setVoiceUpsellOverride('show-paywall-before-first-voice-chat') },
                { text: 'Onboarding + Upsell', onPress: () => setVoiceUpsellOverride('voice-onboarding-and-upsell') },
            ],
        );
    }, [setVoiceUpsellOverride]);

    const handleResetVoiceCounters = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            'Reset Voice Counters',
            'Clear local voice counters used for onboarding and soft-paywall behavior on this device?',
            {
                confirmText: 'Reset',
                destructive: true,
            },
        );
        if (!confirmed) {
            return;
        }

        resetVoiceLocalCounters();
        setVoiceLocalCounters(getVoiceLocalCounters());
    }, []);

    const voiceExperimentStatus = React.useMemo(() => {
        return getVoiceExperimentStatus({
            voiceBypassToken,
            voiceCustomAgentId,
            voiceUpsellOverride,
            voiceUpsellOverrideEnabled: devModeEnabled,
        });
    }, [devModeEnabled, voiceBypassToken, voiceCustomAgentId, voiceUpsellOverride]);

    const developerExperimentSubtitle = React.useMemo(() => {
        const upsellVariant = getVoiceUpsellVariantLabel(voiceExperimentStatus.upsellVariant);
        const gatingMode = voiceExperimentStatus.gatingMode === 'direct-byo-agent'
            ? 'direct BYO agent bypass'
            : 'Happy server gate';

        return [
            `voice-upsell: ${upsellVariant}`,
            `source: ${voiceExperimentStatus.upsellVariantSource}`,
            `gate: ${gatingMode}`,
            `experiments setting: ${experiments ? 'on' : 'off'}`,
        ].join('\n');
    }, [experiments, voiceExperimentStatus]);

    const developerOverrideLabel = React.useMemo(() => {
        if (!voiceUpsellOverride) {
            return 'No Override';
        }
        return getVoiceUpsellVariantLabel(voiceUpsellOverride);
    }, [voiceUpsellOverride]);

    const developerCountersSubtitle = React.useMemo(() => {
        return [
            `soft paywall shown: ${voiceLocalCounters.softPaywallShownCount}`,
            `onboarding prompt loads: ${voiceLocalCounters.onboardingPromptLoadCount}`,
            `voice messages: ${voiceLocalCounters.voiceMessageCount}`,
        ].join('\n');
    }, [voiceLocalCounters]);

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <ItemGroup
                title="Voice dictation transcription"
                footer="The key is encrypted for your account. HappyHerd only displays masked status and never returns the stored key to the app."
            >
                <Item
                    title="OpenAI API key"
                    subtitle={transcriptionKeyStatus?.configured
                        ? (transcriptionKeyStatus.source === 'user' ? '•••••••• · configured for this account' : '•••••••• · provided by this deployment')
                        : 'Not configured'}
                    icon={<Ionicons name="key-outline" size={29} color="#10A37F" />}
                    detail={transcriptionKeyStatus?.configured ? 'Configured' : undefined}
                    loading={transcriptionKeyLoading || transcriptionKeyAction}
                    disabled={transcriptionKeyLoading || transcriptionKeyAction}
                    onPress={handleConfigureTranscriptionKey}
                />
                {transcriptionKeyStatus?.configured && (
                    <Item
                        title="Test OpenAI API key"
                        subtitle="Verify access without recording audio"
                        icon={<Ionicons name="checkmark-circle-outline" size={29} color="#34C759" />}
                        disabled={transcriptionKeyAction}
                        onPress={handleTestTranscriptionKey}
                    />
                )}
                {transcriptionKeyStatus?.source === 'user' && (
                    <Item
                        title="Remove OpenAI API key"
                        subtitle="Delete the account-specific transcription key"
                        icon={<Ionicons name="trash-outline" size={29} color="#FF3B30" />}
                        destructive
                        disabled={transcriptionKeyAction}
                        onPress={handleRemoveTranscriptionKey}
                    />
                )}
            </ItemGroup>

            {/* Voice Usage */}
            {usageLoading ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                    <ActivityIndicator />
                </View>
            ) : usage ? (
                <ItemGroup
                    title={t('settingsVoice.usageTitle')}
                    footer={t('settingsVoice.usageFooter')}
                >
                    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                        <UsageBar
                            label={t('settingsVoice.usageLabel')}
                            value={usage.usedSeconds}
                            maxValue={usage.limitSeconds}
                            color={usage.usedSeconds >= usage.limitSeconds ? '#FF3B30' : '#007AFF'}
                        />
                        <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 4 }}>
                            {formatVoiceTime(usage.usedSeconds)} / {formatVoiceTime(usage.limitSeconds)}
                        </Text>
                        <UsageBar
                            label={t('settingsVoice.conversationsLabel')}
                            value={usage.conversationCount}
                            maxValue={usage.conversationLimit}
                            color={usage.conversationCount >= usage.conversationLimit ? '#FF3B30' : '#007AFF'}
                        />
                        <Text style={{ fontSize: 13, color: '#8E8E93', marginTop: 4 }}>
                            {usage.conversationCount} / {usage.conversationLimit}
                        </Text>
                    </View>
                </ItemGroup>
            ) : null}

            {/* Support / Upgrade */}
            {!hasPro && (
                <ItemGroup>
                    <Item
                        title={t('settingsVoice.supportTitle')}
                        subtitle={t('settingsVoice.supportSubtitle')}
                        icon={<Ionicons name="heart-outline" size={29} color="#FF2D55" />}
                        onPress={handleSupportUs}
                    />
                </ItemGroup>
            )}

            {devModeEnabled && (
                <ItemGroup
                    title="Developer"
                    footer="Developer-only diagnostics and local override controls for the current voice rollout. The paid voice gate runs through Happy server unless Direct Connection and a custom ElevenLabs agent are both enabled."
                >
                    <Item
                        title="Voice Experiment Override"
                        subtitle="Simple local override for the voice-upsell flag"
                        detail={developerOverrideLabel}
                        icon={<Ionicons name="options-outline" size={29} color="#007AFF" />}
                        onPress={handleVoiceExperimentOverride}
                    />
                    <Item
                        title="Voice Experiment Status"
                        subtitle={developerExperimentSubtitle}
                        subtitleLines={0}
                        icon={<Ionicons name="flask-outline" size={29} color="#5856D6" />}
                        showChevron={false}
                        copy={developerExperimentSubtitle}
                    />
                    <Item
                        title="Reset Voice Counters"
                        subtitle={developerCountersSubtitle}
                        subtitleLines={0}
                        icon={<Ionicons name="refresh-outline" size={29} color="#FF9500" />}
                        onPress={handleResetVoiceCounters}
                    />
                </ItemGroup>
            )}

            {/* Language Settings */}
            <ItemGroup
                title={t('settingsVoice.languageTitle')}
                footer={t('settingsVoice.languageDescription')}
            >
                <Item
                    title={t('settingsVoice.preferredLanguage')}
                    subtitle={t('settingsVoice.preferredLanguageSubtitle')}
                    icon={<Ionicons name="language-outline" size={29} color="#007AFF" />}
                    detail={getLanguageDisplayName(currentLanguage)}
                    onPress={() => router.push('/settings/voice/language')}
                />
            </ItemGroup>

            {/* Bring Your Own Agent */}
            <ItemGroup
                title={t('settingsVoice.byoTitle')}
                footer={t('settingsVoice.byoDescription')}
            >
                <Item
                    title={t('settingsVoice.customAgentId')}
                    subtitle={voiceCustomAgentId ?? t('settingsVoice.customAgentIdNotSet')}
                    icon={<Ionicons name="key-outline" size={29} color="#FF9500" />}
                    onPress={handleCustomAgentId}
                />
                <Item
                    title={t('settingsVoice.bypassToken')}
                    subtitle={t('settingsVoice.bypassTokenSubtitle')}
                    icon={<Ionicons name="flash-outline" size={29} color="#FF3B30" />}
                    rightElement={
                        <Switch
                            value={voiceBypassToken}
                            onValueChange={setVoiceBypassToken}
                        />
                    }
                />
            </ItemGroup>

            {/* Prompt Guide — shown when custom agent is configured */}
            {voiceCustomAgentId && (
                <ItemGroup
                    title={t('settingsVoice.promptGuideTitle')}
                    footer={t('settingsVoice.promptGuideDescription')}
                >
                    <Item
                        title={t('settingsVoice.customAgentId')}
                        subtitle={voiceCustomAgentId}
                        copy={voiceCustomAgentId}
                    />
                </ItemGroup>
            )}
        </ItemList>
    );
});
