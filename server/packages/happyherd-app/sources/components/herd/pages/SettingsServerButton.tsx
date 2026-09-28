import * as React from 'react';
import { useRouter } from 'expo-router';

import { HerdHeaderIconButton } from '@/components/herd/shell/HerdHeaderIconButton';
import { t } from '@/text';

/**
 * Phones (UI overhaul): on a custom server, the Settings title row opens the
 * server configuration, as the phone Settings tab header did.
 */
export function SettingsServerButton() {
    const router = useRouter();
    return (
        <HerdHeaderIconButton
            icon="server-outline"
            label={t('server.serverConfiguration')}
            onPress={() => router.push('/server')}
            testID="settings-server-configuration"
        />
    );
}
