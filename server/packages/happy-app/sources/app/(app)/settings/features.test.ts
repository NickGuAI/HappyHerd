import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({
    commanderProfilePictures: false,
    userSafeguardEnabled: false,
}));
const settingReads = vi.hoisted(() => [] as string[]);
const setUserSafeguardEnabled = vi.hoisted(() => vi.fn());

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
    useSettingMutable: (key: string) => {
        settingReads.push(key);
        if (key === 'userSafeguardEnabled') {
            return [settings.userSafeguardEnabled, setUserSafeguardEnabled];
        }
        return [
            key === 'commanderProfilePictures' ? settings.commanderProfilePictures : false,
            vi.fn(),
        ];
    },
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
beforeEach(() => {
    settingReads.splice(0);
    settings.commanderProfilePictures = false;
    settings.userSafeguardEnabled = false;
    setUserSafeguardEnabled.mockClear();
});

describe('User Safeguard setting', () => {
    it('renders the account-synced switch off and enables it through its setter', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(FeaturesSettingsScreen));
        });

        expect(settingReads).toContain('userSafeguardEnabled');
        const safeguardItem = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'happyHerd.features.userSafeguard');
        expect(safeguardItem).toBeDefined();
        expect(safeguardItem!.props.subtitleLines).toBe(0);

        const safeguardSwitch = safeguardItem!.props.rightElement;
        expect(safeguardSwitch.props.value).toBe(false);
        act(() => safeguardSwitch.props.onValueChange(true));
        expect(setUserSafeguardEnabled).toHaveBeenCalledOnce();
        expect(setUserSafeguardEnabled).toHaveBeenCalledWith(true);
    });
});

describe('Commander profile picture feature gate', () => {
    it('keeps avatar management unmounted until the account-synced switch is enabled', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(FeaturesSettingsScreen));
        });

        expect(settingReads).toContain('commanderProfilePictures');
        expect(renderer.root.findAllByType('CommanderAvatarSettings' as any)).toHaveLength(0);
        expect(renderer.root.findAllByType('Item' as any)
            .map((item: any) => item.props.title))
            .toContain('happyHerd.features.commanderProfilePictures');

        settings.commanderProfilePictures = true;
        act(() => {
            renderer.update(React.createElement(FeaturesSettingsScreen));
        });

        expect(renderer.root.findAllByType('CommanderAvatarSettings' as any)).toHaveLength(1);
    });
});
