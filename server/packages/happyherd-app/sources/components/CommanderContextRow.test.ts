import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata, Session } from '@/sync/storageTypes';

const mocks = vi.hoisted(() => ({ push: vi.fn(), platform: 'ios' }));
vi.hoisted(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { View: host('View'), Text: host('Text'), Pressable: host('Pressable'), Platform: { get OS() { return mocks.platform; } } };
});
vi.mock('react-native-unistyles', async () => {
    const { lightTheme: theme } = await import('@/theme');
    return { StyleSheet: { create: (factory: any) => factory(theme) }, useUnistyles: () => ({ theme }) };
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('@/hooks/useCommanderAvatar', () => ({ useCommanderAvatar: () => null }));
vi.mock('@/utils/sessionUtils', () => ({ useSessionStatus: () => ({}), formatPathRelativeToHome: (path: string) => path }));
vi.mock('@/sync/storage', () => ({ useSessionMessages: () => ({ messages: [], isLoaded: true, hasMoreOlder: false, isLoadingOlder: false }) }));
vi.mock('@/sync/sync', () => ({ sync: { loadOlderMessages: vi.fn() } }));
vi.mock('./RoundButton', () => ({ RoundButton: 'RoundButton' }));
vi.mock('./layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('@/text', () => ({ t: (key: string, params?: { name?: string; path?: string }) => params?.path ?? params?.name ?? key }));

import { CommanderContextRow } from './CommanderContextRow';
import { CommanderSessionAvatar } from './CommanderSessionAvatar';
import { EmptyMessages } from './EmptyMessages';

const renderers: ReturnType<typeof create>[] = [];
function render(element: React.ReactElement) {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(element); });
    renderers.push(renderer);
    return renderer;
}
const receipt: NonNullable<Metadata['commanderContextFiles']> = [
    { kind: 'global-agents', path: '/global/AGENTS.md' },
    { kind: 'commander', path: '/commanders/athena/COMMANDER.md' },
    { kind: 'working-memory', path: 'C:\\athena\\memory\\1-working-memory.md' },
    { kind: 'long-term-memory', path: '/athena/memory/2-long-term-memory.md' },
];
const metadata = {
    commanderId: 'athena', commanderName: 'Athena', machineId: 'machine-one',
    commanderContextFiles: receipt,
} as Metadata;
afterEach(() => { act(() => renderers.splice(0).forEach(renderer => renderer.unmount())); mocks.push.mockReset(); });

describe('Commander launch context row', () => {
    it.each(['ios', 'android', 'macos', 'windows'])('shares the empty-state row, avatar identity, exact files and Commander action on %s', (platform) => {
        mocks.platform = platform;
        const renderer = render(React.createElement(EmptyMessages, { session: { id: 'session', metadata, createdAt: Date.now() } as Session }));
        expect(renderer.root.findAllByType(CommanderContextRow)).toHaveLength(1);
        expect(renderer.root.findByType(CommanderSessionAvatar).props).toMatchObject({ commanderId: 'athena', machineId: 'machine-one', commanderName: 'Athena' });
        const chips = renderer.root.findAllByType('View').filter((node: any) => node.props.testID === 'commander-context-file');
        expect(chips.map((node: any) => node.props.accessibilityLabel)).toEqual(receipt.map(file => file.path));
        expect(chips.map((node: any) => node.findByType('Text').props.children)).toEqual(['AGENTS.md', 'COMMANDER.md', '1-working-memory.md', '2-long-term-memory.md']);
        act(() => renderer.root.findByType('Pressable').props.onPress());
        expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/commanders');
    });

    it('renders only recorded files, including a custom filename, without inferring missing memory paths', () => {
        const renderer = render(React.createElement(CommanderContextRow, { metadata: {
            ...metadata, commanderContextFiles: [{ kind: 'working-memory', path: '/memory/团队 Context.md' }],
            globalAgentsPath: '/unread/AGENTS.md', commanderPath: '/unread/COMMANDER.md', commanderAgentContextPath: '/unread/memory',
        } }));
        const chips = renderer.root.findAllByType('View').filter((node: any) => node.props.testID === 'commander-context-file');
        expect(chips).toHaveLength(1);
        expect(chips[0].findByType('Text').props.children).toBe('团队 Context.md');
    });

    it.each([undefined, []])('does not claim any files for an absent or empty receipt (%j)', (commanderContextFiles) => {
        const renderer = render(React.createElement(CommanderContextRow, { metadata: {
            ...metadata, commanderContextFiles, globalAgentsPath: '/AGENTS.md', commanderPath: '/COMMANDER.md',
        } }));
        expect(renderer.root.findAllByType('View').filter((node: any) => node.props.testID === 'commander-context-file')).toHaveLength(0);
        expect(renderer.root.findByType('Pressable').props.accessibilityRole).toBe('link');
    });

    it.each([null, { commanderContextFiles: receipt }])('shows no row without a Commander, even if files exist in metadata', (value) => {
        const renderer = render(React.createElement(CommanderContextRow, { metadata: value as Metadata | null }));
        expect(renderer.toJSON()).toBeNull();
    });
});
