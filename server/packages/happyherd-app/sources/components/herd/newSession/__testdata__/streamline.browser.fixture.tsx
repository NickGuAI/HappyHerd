import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import NewSessionScreen from '@/app/(app)/new/index';
import StreamlineSettingsScreen from '@/app/(app)/settings/streamline';
import { herdAlpha } from '@/components/herd/session/color';

// A style factory in the real Unistyles web runtime receives CSS-variable
// theme colors, as every production sheet does.
const probeStyles = StyleSheet.create((theme) => ({
    box: { width: 40, height: 40, borderWidth: 2, borderColor: herdAlpha(theme.colors.textLink, 0.55) },
}));

function AlphaProbe() {
    return <View testID="herd-alpha-probe" style={probeStyles.box} />;
}

function Fixture() {
    const screen = new URLSearchParams(window.location.search).get('screen');
    return (
        <div data-testid="new-session-fixture" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
            {screen === 'settings' ? <StreamlineSettingsScreen /> : screen === 'alpha' ? <AlphaProbe /> : <NewSessionScreen />}
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
