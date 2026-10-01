import * as React from 'react';
import Module from 'node:module';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ checklist: { other: true } as Record<string, boolean> }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default } }));
vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: () => ({}) }, withUnistyles: (component: any) => component, useUnistyles: () => ({ theme: { colors: { kilv: {} } } }) }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/components/RoundButton', () => ({ RoundButton: 'RoundButton' }));
vi.mock('@/components/OnboardingHelpAction', () => ({ OnboardingHelpAction: 'OnboardingHelpAction' }));
vi.mock('@/hooks/useConnectTerminal', () => ({ useConnectTerminal: () => ({}) }));
vi.mock('@/hooks/useOfflineMachineTroubleshooting', () => ({ useOfflineMachineTroubleshooting: () => vi.fn() }));
vi.mock('@/modal', () => ({ Modal: {} }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('expo-router', () => ({ useRouter: () => ({}) }));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => [],
    useLocalSetting: () => state.checklist,
    storage: { getState: () => ({ localSettings: { linkComputerChecklist: state.checklist }, applyLocalSettings: (delta: any) => { state.checklist = delta.linkComputerChecklist; } }) },
}));
import { EmptyMainScreen } from './EmptyMainScreen';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());
it('preserves both batched steps and double toggles against the synchronous owner before a render', async () => {
    // Native artwork is unrelated to interactions; do not load binary assets in Node.
    const load = (Module as any)._load;
    vi.spyOn(Module as any, '_load').mockImplementation((id: unknown, ...args: unknown[]) =>
        id === '@/assets/images/kilv-mark-light.webp' ? 'artwork' : load(id, ...args));
    let tree: any;
    await act(async () => { tree = create(React.createElement(EmptyMainScreen)); });
    const boxes = tree.root.findAllByProps({ accessibilityRole: 'checkbox' });
    expect(boxes).toHaveLength(2);
    await act(async () => { boxes[0].props.onPress(); boxes[1].props.onPress(); });
    expect(state.checklist).toEqual({ other: true, install: true, open: true });
    await act(async () => { boxes[0].props.onPress(); boxes[0].props.onPress(); });
    expect(state.checklist).toEqual({ other: true, install: true, open: true });
    await act(async () => { tree.unmount(); });
});
