import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { SessionView } from '@/-session/SessionView';

// Review fixture: the production SessionView over synthetic storage/transport.
// The page background follows the app shell: raised slate on desktop, the
// grouped background on phones.
function SessionScreenFixture() {
    const { theme } = useUnistyles();
    const phone = window.innerWidth < 768;
    return (
        <View
            testID="foreground-session"
            style={{
                flex: 1,
                height: '100%',
                backgroundColor: phone ? theme.colors.groupped.background : theme.colors.surface,
            }}
        >
            <SessionView id="parent" />
        </View>
    );
}

createRoot(document.getElementById('root')!).render(<SessionScreenFixture />);
