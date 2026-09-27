import * as React from 'react';
import { SettingsView } from "@/components/SettingsView";
import { MOBILE_GLASS_HEADER_HEIGHT } from '@/components/navigation/headerMetrics';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { withSettingsFrame } from '@/components/herd/pages/SettingsFrame';
import { SettingsServerButton } from '@/components/herd/pages/SettingsServerButton';
import { isUsingCustomServer } from '@/sync/serverConfig';
import { useIsTablet } from '@/utils/responsive';

function SettingsScreen() {
    // Phones (UI overhaul): a custom server's configuration stays one tap away, on the title row.
    const serverButton = !useIsTablet() && isUsingCustomServer();
    return (
        <>
            <Stack.Screen options={{ headerRight: serverButton ? () => <SettingsServerButton /> : undefined }} />
            <SettingsView
                topContentInset={Platform.OS === 'ios' ? MOBILE_GLASS_HEADER_HEIGHT : 0}
            />
        </>
    );
}

export default withSettingsFrame('general', SettingsScreen);
