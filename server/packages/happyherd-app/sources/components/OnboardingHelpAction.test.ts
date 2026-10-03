import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT } from '@/constants/product';
const mocks = vi.hoisted(() => ({ alert: vi.fn(), open: vi.fn() }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text' }));
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: (fn: any) => fn({ colors: {} }) } }));
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/modal', () => ({ Modal: { alert: mocks.alert } }));
vi.mock('@/utils/openExternalUrl', () => ({ openExternalUrl: mocks.open }));
import { OnboardingHelpAction } from './OnboardingHelpAction';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());
describe('onboarding help', () => {
    it.each(['link', 'restore'] as const)('opens contextual %s help without opening an external page until requested', async (context) => {
        let tree: any;
        await act(async () => { tree = create(React.createElement(OnboardingHelpAction, { context })); });
        await act(async () => { tree.root.findByType('Pressable').props.onPress(); });
        const [title, message, buttons] = mocks.alert.mock.calls[0];
        expect(title).toBe('components.onboardingHelp.action');
        expect(message).toBe(`components.onboardingHelp.${context}Message`);
        expect(buttons[0]).toEqual({ text: 'common.cancel', style: 'cancel' });
        expect(mocks.open).not.toHaveBeenCalled();
        expect(buttons[1].text).toBe('settings.reportIssue');
        await act(async () => { buttons[1].onPress(); });
        expect(mocks.open).toHaveBeenCalledExactlyOnceWith(PRODUCT.issueUrl);
        await act(async () => { tree.unmount(); });
    });
    it('handles a rejected external open and allows retry from Help', async () => {
        mocks.open.mockRejectedValueOnce(new Error('native open failed')).mockResolvedValueOnce(undefined);
        let tree: any;
        await act(async () => { tree = create(React.createElement(OnboardingHelpAction, { context: 'link' })); });
        await act(async () => { tree.root.findByType('Pressable').props.onPress(); });
        await act(async () => { mocks.alert.mock.calls[0][2][1].onPress(); });
        expect(mocks.alert.mock.calls[1]).toEqual(['common.error', 'happyHerd.automations.unknownError', [{ text: 'OK', style: 'cancel' }]]);
        await act(async () => { tree.root.findByType('Pressable').props.onPress(); });
        await act(async () => { mocks.alert.mock.calls[2][2][1].onPress(); });
        expect(mocks.open).toHaveBeenCalledTimes(2);
        expect(mocks.alert).toHaveBeenCalledTimes(3);
        await act(async () => { tree.unmount(); });
    });
});
