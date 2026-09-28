import * as React from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useUnistyles } from 'react-native-unistyles';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { PRODUCT } from '@/constants/product';
import { useMultiClick } from '@/hooks/useMultiClick';
import { Modal } from '@/modal';
import { useEntitlement, useLocalSettingMutable } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { trackPaywallButtonClicked } from '@/track';
import { openExternalUrl } from '@/utils/openExternalUrl';
import { t } from '@/text';

type BuildConfig = {
    buildCommitSha?: unknown;
    buildCommitTimestamp?: unknown;
};

function getBuildConfig(): BuildConfig {
    const appConfig = Constants.expoConfig?.extra?.app;
    return appConfig && typeof appConfig === 'object' ? appConfig as BuildConfig : {};
}

function formatUtcTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/:\d{2}Z$/, 'Z')
        .replace('T', ' ')
        .replace('Z', ' UTC');
}

function formatBuildSubtitle(buildConfig: BuildConfig): string | undefined {
    const commitTimestamp = typeof buildConfig.buildCommitTimestamp === 'string'
        ? formatUtcTimestamp(buildConfig.buildCommitTimestamp)
        : undefined;
    const commitSha = typeof buildConfig.buildCommitSha === 'string'
        ? buildConfig.buildCommitSha.slice(0, 7)
        : undefined;

    if (!commitTimestamp && !commitSha) {
        return undefined;
    }

    return [
        commitTimestamp ? `Commit ${commitTimestamp}` : 'Commit',
        commitSha,
    ].filter(Boolean).join(' / ');
}

/**
 * Settings → About (UI overhaul): support, the project's links and policies,
 * the version (ten quick taps toggle developer mode) and, in developer mode,
 * the developer tools. These lived on the removed Settings home.
 */
export const SettingsAboutView = React.memo(function SettingsAboutView() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const appVersion = Constants.expoConfig?.version;
    const runtimeVersion = typeof Constants.expoConfig?.runtimeVersion === 'string'
        ? Constants.expoConfig.runtimeVersion
        : undefined;
    const versionDetail = [
        appVersion ? `${PRODUCT.displayName} ${appVersion}` : PRODUCT.displayName,
        runtimeVersion ? `${t('common.runtime')} ${runtimeVersion}` : undefined,
    ].filter(Boolean).join(' · ');
    const versionSubtitle = formatBuildSubtitle(getBuildConfig());
    const [devModeEnabled, setDevModeEnabled] = useLocalSettingMutable('devModeEnabled');
    const isPro = __DEV__ || useEntitlement('pro');

    const handleGitHub = async () => {
        await openExternalUrl(PRODUCT.repositoryUrl);
    };

    const handleReportIssue = async () => {
        await openExternalUrl(PRODUCT.issueUrl);
    };

    const handleSupport = async () => {
        await openExternalUrl(PRODUCT.supportUrl);
    };

    const handleSubscribe = async () => {
        trackPaywallButtonClicked('voluntary_support');
        const result = await sync.presentPaywall('voluntary_support');
        if (!result.success) {
            console.error('Failed to present paywall:', result.error);
        } else if (result.purchased) {
            console.log('Purchase successful!');
        }
    };

    const handleVersionClick = useMultiClick(() => {
        const newDevMode = !devModeEnabled;
        setDevModeEnabled(newDevMode);
        Modal.alert(
            t('modals.developerMode'),
            newDevMode ? t('modals.developerModeEnabled') : t('modals.developerModeDisabled')
        );
    }, {
        requiredClicks: 10,
        resetTimeout: 2000
    });

    return (
        <ItemList>
            <ItemGroup>
                <Item
                    title={t('settings.supportUs')}
                    subtitle={isPro ? t('settings.supportUsSubtitlePro') : t('settings.supportUsSubtitle')}
                    icon={<Ionicons name="heart" size={29} color={theme.colors.textDestructive} />}
                    showChevron={false}
                    onPress={Platform.OS === 'web'
                        ? (PRODUCT.supportUrl ? handleSupport : undefined)
                        : (isPro ? undefined : handleSubscribe)}
                />
            </ItemGroup>

            <ItemGroup>
                {PRODUCT.repositoryUrl ? (
                    <Item
                        title={t('settings.github')}
                        icon={<Ionicons name="logo-github" size={29} color={theme.colors.text} />}
                        detail={PRODUCT.repositoryDisplay}
                        onPress={handleGitHub}
                    />
                ) : null}
                {PRODUCT.issueUrl ? (
                    <Item
                        title={t('settings.reportIssue')}
                        icon={<Ionicons name="bug-outline" size={29} color={theme.colors.textDestructive} />}
                        onPress={handleReportIssue}
                    />
                ) : null}
                <Item
                    title={t('settings.privacyPolicy')}
                    icon={<Ionicons name="shield-checkmark-outline" size={29} color={theme.colors.textLink} />}
                    onPress={() => openExternalUrl('https://flern.co/privacy')}
                />
                <Item
                    title={t('settings.termsOfService')}
                    icon={<Ionicons name="document-text-outline" size={29} color={theme.colors.textLink} />}
                    onPress={() => openExternalUrl('https://flern.co/terms')}
                />
                {Platform.OS === 'ios' && (
                    <Item
                        title={t('settings.eula')}
                        icon={<Ionicons name="document-text-outline" size={29} color={theme.colors.textLink} />}
                        onPress={() => openExternalUrl('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')}
                    />
                )}
                <Item
                    title={t('common.version')}
                    subtitle={versionSubtitle}
                    subtitleLines={2}
                    detail={versionDetail}
                    icon={<Ionicons name="information-circle-outline" size={29} color={theme.colors.textSecondary} />}
                    onPress={handleVersionClick}
                    showChevron={false}
                />
            </ItemGroup>

            {(__DEV__ || devModeEnabled) && (
                <ItemGroup title={t('settings.developer')}>
                    <Item
                        title={t('settings.developerTools')}
                        icon={<Ionicons name="construct-outline" size={29} color={theme.colors.textLink} />}
                        onPress={() => router.push('/dev')}
                    />
                </ItemGroup>
            )}
        </ItemList>
    );
});
