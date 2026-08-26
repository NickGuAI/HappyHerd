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
import { useSettingMutable, useLocalSetting, useLocalSettingMutable, useSetting } from '@/sync/storage';
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

    const handleConfigureTranscriptionKey = React.useCallback(async () => {
        if (!auth.credentials || transcriptionKeyAction) return;
        const value = await Modal.prompt(
            t("uiCopy.openaiApiKey"),
            t("uiCopy.usedOnlyForVoiceDictationTranscriptionHappyherdEncryptsItFor"),
            {
                placeholder: t("uiCopy.sk"),
                inputType: 'secure-text',
            },
        );
        if (value === null || !value.trim()) return;
        setTranscriptionKeyAction(true);
        try {
            const status = await configureVoiceTranscriptionKey(auth.credentials, value.trim());
            setTranscriptionKeyStatus(status);
            Modal.alert(t("uiCopy.openaiApiKeyConfigured"), t("uiCopy.theKeyWasAcceptedAndStoredSecurelyForVoiceDictation"));
        } catch (error) {
            Modal.alert(t("uiCopy.couldNotConfigureOpenaiApiKey"), error instanceof Error ? error.message : t("uiCopy.theKeyCouldNotBeSaved"));
        } finally {
            setTranscriptionKeyAction(false);
        }
    }, [auth.credentials, transcriptionKeyAction]);

    const handleTestTranscriptionKey = React.useCallback(async () => {
        if (!auth.credentials || transcriptionKeyAction) return;
        setTranscriptionKeyAction(true);
        try {
            await testVoiceTranscriptionKey(auth.credentials);
            Modal.alert(t("uiCopy.openaiApiKeyWorks"), t("uiCopy.voiceDictationCanReachOpenaiWithTheConfiguredKey"));
        } catch (error) {
            Modal.alert(t("uiCopy.openaiApiKeyTestFailed"), error instanceof Error ? error.message : t("uiCopy.theKeyCouldNotBeTested"));
        } finally {
            setTranscriptionKeyAction(false);
        }
    }, [auth.credentials, transcriptionKeyAction]);

    const handleRemoveTranscriptionKey = React.useCallback(async () => {
        if (!auth.credentials || transcriptionKeyAction) return;
        const confirmed = await Modal.confirm(
            t("uiCopy.removeOpenaiApiKey"),
            t("uiCopy.voiceDictationWillUseTheDeploymentKeyIfOneExists"),
            { confirmText: 'Remove', destructive: true },
        );
        if (!confirmed) return;
        setTranscriptionKeyAction(true);
        try {
            setTranscriptionKeyStatus(await removeVoiceTranscriptionKey(auth.credentials));
        } catch (error) {
            Modal.alert(t("uiCopy.couldNotRemoveOpenaiApiKey"), error instanceof Error ? error.message : t("uiCopy.theKeyCouldNotBeRemoved"));
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
            t("uiCopy.voiceExperimentOverride"),
            t("uiCopy.selectALocalOverrideForTheVoiceUpsellExperiment"),
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
            t("uiCopy.resetVoiceCounters"),
            t("uiCopy.clearLocalVoiceCountersUsedForOnboardingAndSoftPaywall"),
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
                title={t("uiCopy.voiceDictationTranscription")}
                footer={t("uiCopy.theKeyIsEncryptedForYourAccountHappyherdOnlyDisplays")}
            >
                <Item
                    title={t("uiCopy.openaiApiKey")}
                    subtitle={transcriptionKeyStatus?.configured
                        ? `•••••••• · ${transcriptionKeyStatus.source === 'user' ? t('uiCopy.configuredForAccount') : t('uiCopy.providedByDeployment')}`
                        : t('settingsVoice.customAgentIdNotSet')}
                    icon={<Ionicons name="key-outline" size={29} color="#10A37F" />}
                    detail={transcriptionKeyStatus?.configured ? t('uiCopy.configured') : undefined}
                    loading={transcriptionKeyLoading || transcriptionKeyAction}
                    disabled={transcriptionKeyLoading || transcriptionKeyAction}
                    onPress={handleConfigureTranscriptionKey}
                />
                {transcriptionKeyStatus?.configured && (
                    <Item
                        title={t("uiCopy.testOpenaiApiKey")}
                        subtitle={t("uiCopy.verifyAccessWithoutRecordingAudio")}
                        icon={<Ionicons name="checkmark-circle-outline" size={29} color="#34C759" />}
                        disabled={transcriptionKeyAction}
                        onPress={handleTestTranscriptionKey}
                    />
                )}
                {transcriptionKeyStatus?.source === 'user' && (
                    <Item
                        title={t("uiCopy.removeOpenaiApiKey_18glmc")}
                        subtitle={t("uiCopy.deleteTheAccountSpecificTranscriptionKey")}
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

            {devModeEnabled && (
                <ItemGroup
                    title={t("settings.developer")}
                    footer={t("uiCopy.developerOnlyDiagnosticsAndLocalOverrideControlsForTheCurrent")}
                >
                    <Item
                        title={t("uiCopy.voiceExperimentOverride")}
                        subtitle={t("uiCopy.simpleLocalOverrideForTheVoiceUpsellFlag")}
                        detail={developerOverrideLabel}
                        icon={<Ionicons name="options-outline" size={29} color="#007AFF" />}
                        onPress={handleVoiceExperimentOverride}
                    />
                    <Item
                        title={t("uiCopy.voiceExperimentStatus")}
                        subtitle={developerExperimentSubtitle}
                        subtitleLines={0}
                        icon={<Ionicons name="flask-outline" size={29} color="#5856D6" />}
                        showChevron={false}
                        copy={developerExperimentSubtitle}
                    />
                    <Item
                        title={t("uiCopy.resetVoiceCounters")}
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
