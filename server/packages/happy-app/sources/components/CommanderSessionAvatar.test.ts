import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useCommanderAvatar', () => ({
    useCommanderAvatar: () => 'data:image/png;base64,avatar',
}));

vi.mock('./Avatar', async () => {
    const ReactModule = await import('react');
    return { Avatar: (props: any) => ReactModule.createElement('Avatar', props) };
});

import { CommanderSessionAvatar } from './CommanderSessionAvatar';

const originalConsoleError = console.error;

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        originalConsoleError(message, ...args);
    });
});

afterAll(() => vi.restoreAllMocks());

describe('CommanderSessionAvatar', () => {
    it('renders the machine-scoped Commander image in the compact leading slot', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(CommanderSessionAvatar, {
                machineId: 'machine-one',
                commanderId: 'athena',
            }));
        });

        expect(renderer.root.findByType('Avatar' as any).props).toMatchObject({
            id: 'commander:machine-one:athena',
            imageUrl: 'data:image/png;base64,avatar',
            flavor: null,
            size: 16,
        });

        act(() => {
            renderer.root.findByType('Avatar' as any).props.onImageError();
        });
        expect(renderer.root.findByType('Avatar' as any).props).toMatchObject({
            id: 'commander:machine-one:athena',
            imageUrl: null,
            flavor: null,
            size: 16,
        });
    });
});
