import { Ionicons } from '@expo/vector-icons';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useSettingMutable, useLocalSettingMutable } from '@/sync/storage';
import { Switch } from '@/components/Switch';
import { t } from '@/text';
import { CommanderAvatarSettings } from '@/components/CommanderAvatarSettings';

export default function FeaturesSettingsScreen() {
    const [experiments, setExperiments] = useSettingMutable('experiments');
    const [markdownCopyV2, setMarkdownCopyV2] = useLocalSettingMutable('markdownCopyV2');
    const [hideInactiveSessions, setHideInactiveSessions] = useSettingMutable('hideInactiveSessions');
    const [machineWorkspace, setMachineWorkspace] = useSettingMutable('machineWorkspace');
    const [expImageUpload, setExpImageUpload] = useSettingMutable('expImageUpload');
    const [commanderProfilePictures, setCommanderProfilePictures] = useSettingMutable('commanderProfilePictures');

    return (
        <ItemList style={{ paddingTop: 0 }}>
            {/* Interface */}
            <ItemGroup
                title={t('happyHerd.features.interface')}
                footer={t('happyHerd.features.interfaceFooter')}
            >
                <Item
                    title={t('workspace.title')}
                    subtitle={t('workspace.featureSubtitle')}
                    icon={<Ionicons name="folder-open-outline" size={29} color="#34C759" />}
                    rightElement={
                        <Switch
                            value={machineWorkspace}
                            onValueChange={setMachineWorkspace}
                        />
                    }
                    showChevron={false}
                />
            </ItemGroup>

            {/* Experimental Features */}
            <ItemGroup
                title={t('settingsFeatures.experiments')}
                footer={t('settingsFeatures.experimentsDescription')}
            >
                <Item
                    title={t('settingsFeatures.experimentalFeatures')}
                    subtitle={experiments ? t('settingsFeatures.experimentalFeaturesEnabled') : t('settingsFeatures.experimentalFeaturesDisabled')}
                    icon={<Ionicons name="flask-outline" size={29} color="#5856D6" />}
                    rightElement={
                        <Switch
                            value={experiments}
                            onValueChange={setExperiments}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeatures.markdownCopyV2')}
                    subtitle={t('settingsFeatures.markdownCopyV2Subtitle')}
                    icon={<Ionicons name="text-outline" size={29} color="#34C759" />}
                    rightElement={
                        <Switch
                            value={markdownCopyV2}
                            onValueChange={setMarkdownCopyV2}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeatures.hideInactiveSessions')}
                    subtitle={t('settingsFeatures.hideInactiveSessionsSubtitle')}
                    icon={<Ionicons name="eye-off-outline" size={29} color="#FF9500" />}
                    rightElement={
                        <Switch
                            value={hideInactiveSessions}
                            onValueChange={setHideInactiveSessions}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('settingsFeatures.imageUpload')}
                    subtitle={t('settingsFeatures.imageUploadSubtitle')}
                    icon={<Ionicons name="image-outline" size={29} color="#FF2D55" />}
                    rightElement={
                        <Switch
                            value={expImageUpload}
                            onValueChange={setExpImageUpload}
                        />
                    }
                    showChevron={false}
                />
                <Item
                    title={t('happyHerd.features.commanderProfilePictures')}
                    subtitle={t('happyHerd.features.commanderProfilePicturesSubtitle')}
                    icon={<Ionicons name="people-circle-outline" size={29} color="#007AFF" />}
                    rightElement={(
                        <Switch
                            value={commanderProfilePictures}
                            onValueChange={setCommanderProfilePictures}
                        />
                    )}
                    showChevron={false}
                />
            </ItemGroup>

            {commanderProfilePictures && <CommanderAvatarSettings />}
        </ItemList>
    );
}
