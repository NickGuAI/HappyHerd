import * as React from 'react';
import { Stack } from 'expo-router';
import { ConnectionsSettingsView } from '@/components/ConnectionsSettingsView';
import { useSettingsFrameAction, withSettingsFrame } from '@/components/herd/pages/SettingsFrame';
import { SettingsServerButton } from '@/components/herd/pages/SettingsServerButton';
import { isUsingCustomServer } from '@/sync/serverConfig';

function ConnectionsSettingsScreen() {
    // A custom server's configuration sits on the title row at every width;
    // it is the only signed-in way to /server (UI overhaul). Where the desktop
    // frame draws the title, the button sits beside it instead.
    const serverButton = isUsingCustomServer();
    useSettingsFrameAction(serverButton ? SettingsServerButton : null);
    return (
        <>
            <Stack.Screen options={{ headerRight: serverButton ? () => <SettingsServerButton /> : undefined }} />
            <ConnectionsSettingsView />
        </>
    );
}

export default withSettingsFrame('connections', ConnectionsSettingsScreen);
