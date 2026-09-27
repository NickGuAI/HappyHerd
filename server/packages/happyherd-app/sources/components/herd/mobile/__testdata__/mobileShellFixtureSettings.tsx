import * as React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { t } from '@/text';

/** Stands in for SettingsViewWrapper: real grouped rows that open settings sub-pages. */
export function FixtureSettingsViewWrapper() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const icon = (name: React.ComponentProps<typeof Ionicons>['name']) => (
        <Ionicons name={name} size={24} color={theme.colors.textLink} />
    );
    return (
        <ItemList>
            <ItemGroup title={t('settings.features')}>
                <Item title={t('settings.account')} icon={icon('person-circle-outline')} onPress={() => router.push('/settings/account')} />
                <Item title={t('settings.appearance')} icon={icon('color-palette-outline')} onPress={() => router.push('/settings/appearance')} />
                <Item title={t('settings.voiceAssistant')} icon={icon('mic-outline')} onPress={() => router.push('/settings/voice')} />
            </ItemGroup>
            <ItemGroup title={t('settings.about')}>
                <Item title={t('settings.whatsNew')} icon={icon('sparkles-outline')} onPress={() => router.push('/changelog')} />
            </ItemGroup>
        </ItemList>
    );
}
