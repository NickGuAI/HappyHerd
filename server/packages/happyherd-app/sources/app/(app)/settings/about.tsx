import * as React from 'react';
import { SettingsAboutView } from '@/components/SettingsAboutView';
import { withSettingsFrame } from '@/components/herd/pages/SettingsFrame';

function AboutSettingsScreen() {
    return <SettingsAboutView />;
}

export default withSettingsFrame('about', AboutSettingsScreen);
