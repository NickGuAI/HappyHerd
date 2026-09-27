import { ConnectionsSettingsView } from '@/components/ConnectionsSettingsView';
import { withSettingsFrame } from '@/components/herd/pages/SettingsFrame';

function ConnectionsSettingsScreen() {
    return <ConnectionsSettingsView />;
}

export default withSettingsFrame('connections', ConnectionsSettingsScreen);
