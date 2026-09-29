import React from 'react';
import { Stack } from 'expo-router';
import { UsagePanel } from '@/components/usage/UsagePanel';
import { ItemList } from '@/components/ItemList';
import { withSettingsFrame } from '@/components/herd/pages/SettingsFrame';
import { t } from '@/text';

function UsageSettingsScreen() {
    return (
        <>
            <Stack.Screen options={{ headerTitle: t('settings.usage') }} />
            <ItemList style={{ paddingTop: 0 }}>
                <UsagePanel />
            </ItemList>
        </>
    );
}

export default withSettingsFrame('usage', UsageSettingsScreen);
