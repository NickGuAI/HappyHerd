import * as React from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { ItemList } from '@/components/ItemList';
import { SettingsSectionList } from '@/components/herd/pages/SettingsFrame';

/**
 * Settings on phones, narrow windows and the apps (UI overhaul): the section
 * list, and nothing else. Every option lives on one of its pages; desktop
 * shows the same list beside the page instead (SettingsFrame).
 */
export const SettingsView = React.memo(function SettingsView({
    topContentInset = 0,
    bottomContentInset = 0,
    onScroll,
}: {
    topContentInset?: number;
    bottomContentInset?: number;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
    return (
        <ItemList
            style={{ paddingTop: 0 }}
            containerStyle={{ paddingTop: topContentInset, paddingBottom: bottomContentInset }}
            onScroll={onScroll}
            scrollEventThrottle={16}
        >
            <SettingsSectionList />
        </ItemList>
    );
});
