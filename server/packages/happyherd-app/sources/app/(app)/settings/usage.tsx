import React from 'react';
import { UsagePanel } from '@/components/usage/UsagePanel';
import { ItemList } from '@/components/ItemList';
import { withSettingsFrame } from '@/components/herd/pages/SettingsFrame';

function UsageSettingsScreen() {
    return (
        <ItemList style={{ paddingTop: 0 }}>
            <UsagePanel />
        </ItemList>
    );
}

export default withSettingsFrame('usage', UsageSettingsScreen);
