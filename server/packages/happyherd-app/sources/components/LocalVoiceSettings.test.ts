import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    values: { localVoiceMachineId: null as string | null, localVoiceSttEnabled: false, localVoiceTtsEnabled: false },
    machines: [] as Array<any>,
    voiceStatus: { stt: { state: 'not-installed' }, tts: { state: 'not-installed' } },
    install: vi.fn(),
    refresh: vi.fn(),
}));

vi.mock('react-native-unistyles', async () => {
    const { lightTheme } = await import('@/theme');
    return { useUnistyles: () => ({ theme: lightTheme }) };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Icon', props) };
});
vi.mock('@/components/Item', async () => {
    const ReactModule = await import('react');
    return { Item: (props: any) => ReactModule.createElement('Item', props) };
});
vi.mock('@/components/ItemGroup', async () => {
    const ReactModule = await import('react');
    return { ItemGroup: (props: any) => ReactModule.createElement('ItemGroup', props, props.children) };
});
vi.mock('@/components/Switch', async () => {
    const ReactModule = await import('react');
    return { Switch: (props: any) => ReactModule.createElement('Switch', props) };
});
vi.mock('@/sync/storage', async () => {
    const ReactModule = await import('react');
    return {
        useAllMachines: () => state.machines,
        useSettingMutable: (key: keyof typeof state.values) => {
            const [, rerender] = ReactModule.useState(0);
            return [state.values[key], (value: any) => {
                (state.values as any)[key] = value;
                rerender((current: number) => current + 1);
            }];
        },
        useMachine: (machineId: string) => state.machines.find((machine) => machine.id === machineId) ?? null,
    };
});
vi.mock('@/hooks/useLocalVoiceStatus', () => ({
    useLocalVoiceStatus: (machineId: string | null) => ({
        status: machineId && state.machines.some((machine) => machine.id === machineId && machine.active) ? state.voiceStatus : null,
        loading: false,
        online: Boolean(machineId && state.machines.some((machine) => machine.id === machineId && machine.active)),
        refresh: state.refresh,
    }),
}));
vi.mock('@/sync/localVoice', () => ({ installLocalVoiceFeature: state.install }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { LocalVoiceSettings } from './LocalVoiceSettings';

describe('LocalVoiceSettings', () => {
    beforeAll(() => {
        (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        state.values.localVoiceMachineId = null;
        state.values.localVoiceSttEnabled = false;
        state.values.localVoiceTtsEnabled = false;
        state.voiceStatus = { stt: { state: 'not-installed' }, tts: { state: 'not-installed' } };
        state.machines = [{
            id: 'mac-mini', active: true, activeAt: 3, createdAt: 1,
            metadata: { happyCliVersion: '1.0.0', displayName: 'Mac mini' },
        }];
        state.install.mockReset().mockResolvedValue({ operationId: 'install', kind: 'install', state: 'running' });
        state.refresh.mockReset().mockResolvedValue(null);
    });

    it('keeps both local engines opt-in and installs each on the selected account machine', async () => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => { renderer = create(React.createElement(LocalVoiceSettings)); });
        const items = renderer.root.findAllByType('Item' as any);
        const stt = items.find((item: any) => item.props.title === 'happyHerd.localVoice.sttTitle');
        const tts = items.find((item: any) => item.props.title === 'happyHerd.localVoice.ttsTitle');
        expect(stt.props.rightElement.props.value).toBe(false);
        expect(tts.props.rightElement.props.value).toBe(false);

        await act(async () => { stt.props.rightElement.props.onValueChange(true); });
        expect(state.values.localVoiceSttEnabled).toBe(true);
        expect(state.install).toHaveBeenCalledWith('mac-mini', 'stt');
        expect(state.values.localVoiceTtsEnabled).toBe(false);
        act(() => renderer.unmount());
    });

    it('lets the Human choose the account voice machine independently of a session', () => {
        state.machines.push({
            id: 'ec2', active: true, activeAt: 2, createdAt: 2,
            metadata: { happyCliVersion: '1.0.0', displayName: 'EC2' },
        });
        let renderer!: ReturnType<typeof create>;
        act(() => { renderer = create(React.createElement(LocalVoiceSettings)); });
        const selector = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'happyHerd.localVoice.voiceMachine');
        act(() => selector.props.onPress());
        const ec2 = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'EC2');
        expect(ec2).toBeDefined();
        act(() => ec2.props.onPress());
        expect(state.values.localVoiceMachineId).toBe('ec2');
        act(() => renderer.unmount());
    });

    it('keeps the stored voice machine selected while its machine record temporarily disappears', () => {
        state.values.localVoiceMachineId = 'missing-for-now';
        let renderer!: ReturnType<typeof create>;
        act(() => { renderer = create(React.createElement(LocalVoiceSettings)); });

        const selector = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'happyHerd.localVoice.voiceMachine');
        expect(selector.props.subtitle).toBe('happyHerd.localVoice.selectedMachineUnavailable');
        expect(state.values.localVoiceMachineId).toBe('missing-for-now');
        act(() => selector.props.onPress());
        expect(renderer.root.findAllByType('Item' as any).some((item: any) => item.props.title === 'Mac mini')).toBe(true);
        act(() => renderer.unmount());
    });

    it('lets an enabled switch turn off while its machine is offline or downloading', () => {
        state.values.localVoiceMachineId = 'mac-mini';
        state.values.localVoiceSttEnabled = true;
        state.machines[0].active = false;
        let renderer!: ReturnType<typeof create>;
        act(() => { renderer = create(React.createElement(LocalVoiceSettings)); });
        let stt = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'happyHerd.localVoice.sttTitle');
        expect(stt.props.rightElement.props.disabled).toBe(false);
        act(() => stt.props.rightElement.props.onValueChange(false));
        expect(state.values.localVoiceSttEnabled).toBe(false);

        state.machines[0].active = true;
        state.voiceStatus.stt.state = 'installing';
        state.values.localVoiceSttEnabled = true;
        act(() => renderer.update(React.createElement(LocalVoiceSettings)));
        stt = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'happyHerd.localVoice.sttTitle');
        expect(stt.props.rightElement.props.disabled).toBe(false);
        act(() => stt.props.rightElement.props.onValueChange(false));
        expect(state.values.localVoiceSttEnabled).toBe(false);
        expect(state.install).not.toHaveBeenCalled();
        act(() => renderer.unmount());
    });

    it('shows install request errors and retries the selected feature', async () => {
        state.values.localVoiceMachineId = 'mac-mini';
        state.install
            .mockRejectedValueOnce(new Error('Install RPC unavailable'))
            .mockResolvedValueOnce({ operationId: 'install-retry', kind: 'install', state: 'running' });
        let renderer!: ReturnType<typeof create>;
        await act(async () => { renderer = create(React.createElement(LocalVoiceSettings)); });
        const stt = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'happyHerd.localVoice.sttTitle');
        await act(async () => {
            stt.props.rightElement.props.onValueChange(true);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const retry = renderer.root.findAllByType('Item' as any)
            .find((item: any) => item.props.title === 'happyHerd.localVoice.retry');
        expect(retry.props.subtitle).toBe('Install RPC unavailable');
        await act(async () => { retry.props.onPress(); await Promise.resolve(); });
        expect(state.install).toHaveBeenCalledTimes(2);
        expect(state.install).toHaveBeenLastCalledWith('mac-mini', 'stt');
        act(() => renderer.unmount());
    });
});
