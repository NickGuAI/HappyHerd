import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    alert: vi.fn(),
    listCommanders: vi.fn(async (machineId: string) => ({
        commanders: [{
            id: machineId === 'machine-one' ? 'athena' : 'gaia',
            name: machineId === 'machine-one' ? 'Athena' : 'Gaia',
            role: 'Commander',
            workspace: `/srv/${machineId}`,
            commanderPath: `/home/me/.happyherd/commanders/${machineId}/COMMANDER.md`,
            agentContextPath: `/home/me/.happyherd/commanders/${machineId}/agentcontext`,
        }],
    })),
    pick: vi.fn(async () => ({
        canceled: false,
        assets: [{ uri: 'file:///picked-avatar.png' }],
    })),
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
    upload: vi.fn(async (machineId: string, commander: any) => ({
        ...commander,
        avatar: {
            path: `/home/me/.happyherd/commanders/${machineId}/avatar.png`,
            mimeType: 'image/png',
            byteLength: 3,
            sha256: 'a'.repeat(64),
        },
    })),
}));

vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.pick }));
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('@/components/Item', async () => {
    const ReactModule = await import('react');
    return { Item: (props: any) => ReactModule.createElement('Item', props) };
});
vi.mock('@/components/ItemGroup', async () => {
    const ReactModule = await import('react');
    return { ItemGroup: (props: any) => ReactModule.createElement('ItemGroup', props, props.children) };
});
vi.mock('@/modal', () => ({ Modal: { alert: mocks.alert } }));
vi.mock('@/sync/ops', () => ({ machineListCommanders: mocks.listCommanders }));
vi.mock('@/sync/storage', () => ({
    useAllMachines: () => ([
        {
            id: 'machine-one',
            active: true,
            metadata: { displayName: 'Alpha' },
        },
        {
            id: 'machine-two',
            active: true,
            metadata: { displayName: 'Beta' },
        },
    ]),
}));
vi.mock('@/text', () => ({
    t: (key: string, values?: Record<string, string>) => (
        values?.name ? `${key}:${values.name}` : key
    ),
}));
vi.mock('@/utils/commanderAvatarUpload', () => ({
    CommanderAvatarUploadError: class CommanderAvatarUploadError extends Error {},
    uploadCommanderAvatar: mocks.upload,
}));
vi.mock('@/utils/machineUtils', () => ({ isMachineOnline: (machine: any) => machine.active }));
vi.mock('@/utils/readFileBytes', () => ({ readFileBytes: mocks.readBytes }));
vi.mock('./CommanderSessionAvatar', async () => {
    const ReactModule = await import('react');
    return {
        CommanderSessionAvatar: (props: any) => ReactModule.createElement('CommanderSessionAvatar', props),
    };
});

import { CommanderAvatarSettings } from './CommanderAvatarSettings';

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

describe('CommanderAvatarSettings', () => {
    it('groups direct Commander selections by machine and uploads to the selected machine', async () => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(CommanderAvatarSettings));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.listCommanders).toHaveBeenCalledWith('machine-one');
        expect(mocks.listCommanders).toHaveBeenCalledWith('machine-two');
        expect(renderer.root.findAllByType('ItemGroup' as any).map((group: any) => group.props.title))
            .toEqual(['Alpha', 'Beta']);

        const items = renderer.root.findAllByType('Item' as any);
        expect(items.map((item: any) => item.props.title)).toEqual(['Athena', 'Gaia']);
        expect(renderer.root.findAllByType('TextInput' as any)).toHaveLength(0);

        await act(async () => {
            items[0].props.onPress();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.pick).toHaveBeenCalledWith(expect.objectContaining({
            type: ['image/png', 'image/jpeg', 'image/webp'],
            multiple: false,
        }));
        expect(mocks.readBytes).toHaveBeenCalledWith('file:///picked-avatar.png');
        expect(mocks.upload).toHaveBeenCalledWith(
            'machine-one',
            expect.objectContaining({ id: 'athena' }),
            new Uint8Array([1, 2, 3]),
        );

        act(() => renderer.unmount());
    });

    it('rejects a known oversized selection before reading it into memory', async () => {
        mocks.pick.mockResolvedValueOnce({
            canceled: false,
            assets: [{ uri: 'file:///too-large.png', size: 2 * 1024 * 1024 + 1 }],
        } as any);
        let renderer!: ReturnType<typeof create>;
        await act(async () => {
            renderer = create(React.createElement(CommanderAvatarSettings));
            await Promise.resolve();
            await Promise.resolve();
        });

        const item = renderer.root.findAllByType('Item' as any)[0];
        await act(async () => {
            item.props.onPress();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mocks.readBytes).not.toHaveBeenCalled();
        expect(mocks.upload).not.toHaveBeenCalled();
        expect(mocks.alert).toHaveBeenCalledWith(
            'common.error',
            'happyHerd.commanderAvatars.tooLarge',
        );

        act(() => renderer.unmount());
    });
});
