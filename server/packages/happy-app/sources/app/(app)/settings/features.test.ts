import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const settingState = vi.hoisted(() => ({ commanderProfilePictures: false }));

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('@/components/Item', async () => {
    const ReactModule = await import('react');
    return { Item: (props: any) => ReactModule.createElement('Item', props, props.children) };
});
vi.mock('@/components/ItemGroup', async () => {
    const ReactModule = await import('react');
    return { ItemGroup: (props: any) => ReactModule.createElement('ItemGroup', props, props.children) };
});
vi.mock('@/components/ItemList', async () => {
    const ReactModule = await import('react');
    return { ItemList: (props: any) => ReactModule.createElement('ItemList', props, props.children) };
});
vi.mock('@/components/Switch', async () => {
    const ReactModule = await import('react');
    return { Switch: (props: any) => ReactModule.createElement('Switch', props) };
});
vi.mock('@/components/CommanderAvatarSettings', async () => {
    const ReactModule = await import('react');
    return {
        CommanderAvatarSettings: () => ReactModule.createElement('CommanderAvatarSettings'),
    };
});
vi.mock('@/sync/storage', () => ({
    useSettingMutable: (key: string) => [
        key === 'commanderProfilePictures' ? settingState.commanderProfilePictures : false,
        vi.fn(),
    ],
    useLocalSettingMutable: () => [false, vi.fn()],
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import FeaturesSettingsScreen from './features';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

describe('Commander profile picture feature gate', () => {
    it('keeps machine and file selection UI unmounted until the account-synced switch is enabled', () => {
        settingState.commanderProfilePictures = false;
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(FeaturesSettingsScreen));
        });

        expect(renderer.root.findAllByType('CommanderAvatarSettings' as any)).toHaveLength(0);

        settingState.commanderProfilePictures = true;
        act(() => {
            renderer.update(React.createElement(FeaturesSettingsScreen));
        });
        expect(renderer.root.findAllByType('CommanderAvatarSettings' as any)).toHaveLength(1);
    });
});
