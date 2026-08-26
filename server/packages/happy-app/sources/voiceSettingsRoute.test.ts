import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    return {
        credentials: { token: 'test-token' },
        push: vi.fn(),
        fetchVoiceUsage: vi.fn(async () => ({
            usedSeconds: 90,
            limitSeconds: 1_200,
            conversationCount: 2,
            conversationLimit: 100,
            elevenUserId: 'eleven-user-1',
        })),
        fetchVoiceTranscriptionKeyStatus: vi.fn(async () => ({
            configured: true,
            source: 'user' as const,
        })),
    };
});

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return {
        View: (props: any) => ReactModule.createElement('View', props, props.children),
        ActivityIndicator: (props: any) => ReactModule.createElement('ActivityIndicator', props),
    };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
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
vi.mock('@/components/usage/UsageBar', async () => {
    const ReactModule = await import('react');
    return { UsageBar: (props: any) => ReactModule.createElement('UsageBar', props) };
});
vi.mock('@/sync/storage', () => ({
    useSettingMutable: (key: string) => {
        if (key === 'voiceAssistantLanguage') return ['en-US', vi.fn()];
        if (key === 'voiceCustomAgentId') return ['agent-1', vi.fn()];
        if (key === 'voiceBypassToken') return [true, vi.fn()];
        throw new Error(`Unexpected mutable setting: ${key}`);
    },
    useLocalSettingMutable: () => [null, vi.fn()],
    useSetting: () => false,
    useLocalSetting: () => true,
}));
vi.mock('@/auth/AuthContext', () => ({
    useAuth: () => ({ credentials: mocks.credentials }),
}));
vi.mock('@/constants/Languages', () => ({
    LANGUAGES: [{ code: 'en-US', name: 'English', nativeName: 'English' }],
    findLanguageByCode: () => ({ code: 'en-US', name: 'English', nativeName: 'English' }),
    getLanguageDisplayName: () => 'English',
}));
vi.mock('@/sync/apiVoice', () => ({
    configureVoiceTranscriptionKey: vi.fn(),
    fetchVoiceTranscriptionKeyStatus: mocks.fetchVoiceTranscriptionKeyStatus,
    fetchVoiceUsage: mocks.fetchVoiceUsage,
    removeVoiceTranscriptionKey: vi.fn(),
    testVoiceTranscriptionKey: vi.fn(),
}));
vi.mock('@/text', () => ({
    t: (key: string) => key === 'settingsVoice.supportTitle' ? 'Upgrade Voice' : key,
}));
vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn(), confirm: vi.fn(), prompt: vi.fn() },
}));
vi.mock('@/realtime/voiceExperiment', () => ({
    getVoiceExperimentStatus: () => ({
        upsellVariant: 'control',
        upsellVariantSource: 'default',
        gatingMode: 'direct-byo-agent',
    }),
    getVoiceUpsellVariantLabel: () => 'Control',
}));
vi.mock('@/sync/persistence', () => ({
    getVoiceLocalCounters: () => ({
        softPaywallShownCount: 0,
        onboardingPromptLoadCount: 0,
        voiceMessageCount: 0,
    }),
    resetVoiceLocalCounters: vi.fn(),
}));

import VoiceSettingsScreen from './app/(app)/settings/voice';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());
beforeEach(() => vi.clearAllMocks());

describe('Voice settings', () => {
    it('omits Upgrade Voice while retaining transcription, usage, language, BYOA, and diagnostics', async () => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(VoiceSettingsScreen));
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        const items = renderer.root.findAllByType('Item' as any);
        const itemTitles = items.map((item: any) => item.props.title);
        expect(itemTitles).not.toContain('Upgrade Voice');
        expect(itemTitles).toEqual(expect.arrayContaining([
            'uiCopy.openaiApiKey',
            'uiCopy.testOpenaiApiKey',
            'uiCopy.removeOpenaiApiKey_18glmc',
            'uiCopy.voiceExperimentOverride',
            'uiCopy.voiceExperimentStatus',
            'uiCopy.resetVoiceCounters',
            'settingsVoice.preferredLanguage',
            'settingsVoice.customAgentId',
            'settingsVoice.bypassToken',
        ]));

        const groups = renderer.root.findAllByType('ItemGroup' as any);
        const groupTitles = groups.map((group: any) => group.props.title);
        expect(groupTitles).toEqual(expect.arrayContaining([
            'uiCopy.voiceDictationTranscription',
            'settingsVoice.usageTitle',
            'settings.developer',
            'settingsVoice.languageTitle',
            'settingsVoice.byoTitle',
            'settingsVoice.promptGuideTitle',
        ]));
        expect(groups.find((group: any) => group.props.title === 'settingsVoice.byoTitle')?.props.footer)
            .toBe('settingsVoice.byoDescription');

        expect(renderer.root.findAllByType('UsageBar' as any).map((bar: any) => bar.props.label)).toEqual([
            'settingsVoice.usageLabel',
            'settingsVoice.conversationsLabel',
        ]);

        items.find((item: any) => item.props.title === 'settingsVoice.preferredLanguage')?.props.onPress();
        expect(mocks.push).toHaveBeenCalledWith('/settings/voice/language');

        act(() => renderer.unmount());
    });
});
