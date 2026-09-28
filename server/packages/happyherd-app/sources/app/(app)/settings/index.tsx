import * as React from 'react';
import { SettingsView } from "@/components/SettingsView";
import { MOBILE_GLASS_HEADER_HEIGHT } from '@/components/navigation/headerMetrics';
import { Platform } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { useSettingsFrameVisible } from '@/components/herd/pages/SettingsFrame';
import { SettingsServerButton } from '@/components/herd/pages/SettingsServerButton';
import { isUsingCustomServer } from '@/sync/serverConfig';

/**
 * Settings has no home page of its own (UI overhaul). Beside the desktop
 * section list it opens on Account, replacing this route so Back never
 * returns here; elsewhere this route is the section list.
 */
export default function SettingsScreen() {
    const framed = useSettingsFrameVisible();
    // A custom server's configuration stays one tap away on the title row: it
    // is the only signed-in way to /server. Connections carries it on desktop.
    const serverButton = isUsingCustomServer();
    if (framed) return <Redirect href="/settings/account" />;
    return (
        <>
            <Stack.Screen options={{ headerRight: serverButton ? () => <SettingsServerButton /> : undefined }} />
            <SettingsView
                topContentInset={Platform.OS === 'ios' ? MOBILE_GLASS_HEADER_HEIGHT : 0}
            />
        </>
    );
}
