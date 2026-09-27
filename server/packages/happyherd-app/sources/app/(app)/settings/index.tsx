import { SettingsView } from "@/components/SettingsView";
import { MOBILE_GLASS_HEADER_HEIGHT } from '@/components/navigation/headerMetrics';
import { Platform } from 'react-native';
import { withSettingsFrame } from '@/components/herd/pages/SettingsFrame';

function SettingsScreen() {
    return (
        <SettingsView
            topContentInset={Platform.OS === 'ios' ? MOBILE_GLASS_HEADER_HEIGHT : 0}
        />
    );
}

export default withSettingsFrame('general', SettingsScreen);
