import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { SessionView } from '@/-session/SessionView';

// Review fixture: the production SessionView (right panel, side chats and
// Workspace) over synthetic storage and transport, in the production style
// runtime. The page background follows the app shell: raised slate on
// desktop, the grouped background on phones.
function PanelsFixture() {
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

createRoot(document.getElementById('root')!).render(<PanelsFixture />);
