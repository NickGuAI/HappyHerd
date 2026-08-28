import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const motion = vi.hoisted(() => ({ reduced: false }));
const settings = vi.hoisted(() => ({ commanderProfilePictures: true }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    return { View: (props: any) => ReactModule.createElement('View', props, props.children) };
});
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Ionicons', props) };
});
vi.mock('react-native-reanimated', () => ({ useReducedMotion: () => motion.reduced }));
vi.mock('react-native-unistyles', () => {
    const theme = {
        colors: {
            permission: { bypass: 'orange' },
            radio: { active: 'blue' },
            status: {
                connected: 'green',
                disconnected: 'grey',
                default: 'neutral',
            },
            surface: 'surface',
            surfaceHighest: 'surface-highest',
            text: 'text',
            textSecondary: 'text-secondary',
        },
    };
    return {
        StyleSheet: { create: (factory: any) => factory(theme) },
        useUnistyles: () => ({ theme }),
    };
});
vi.mock('@/components/StyledText', async () => {
    const ReactModule = await import('react');
    return { Text: (props: any) => ReactModule.createElement('Text', props, props.children) };
});
vi.mock('@/constants/Typography', () => ({ Typography: { default: () => ({}) } }));
vi.mock('@/sync/storage', () => ({
    useSetting: (key: string) => key === 'commanderProfilePictures'
        ? settings.commanderProfilePictures
        : false,
}));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('./CommanderSessionAvatar', async () => {
    const ReactModule = await import('react');
    return {
        CommanderSessionAvatar: (props: any) => ReactModule.createElement('CommanderSessionAvatar', props),
    };
});
vi.mock('./ProviderIcon', async () => {
    const ReactModule = await import('react');
    return { ProviderIcon: (props: any) => ReactModule.createElement('ProviderIcon', props) };
});
vi.mock('./HarnessBadgeIcon', async () => {
    const ReactModule = await import('react');
    return { HarnessBadgeIcon: (props: any) => ReactModule.createElement('HarnessBadgeIcon', props) };
});
vi.mock('./StatusDot', async () => {
    const ReactModule = await import('react');
    return { StatusPulse: (props: any) => ReactModule.createElement('StatusPulse', props) };
});

import { SessionStatusAvatar } from './SessionStatusAvatar';

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
    motion.reduced = false;
    settings.commanderProfilePictures = true;
});

function flattenedStyle(value: unknown): Record<string, unknown> {
    if (!Array.isArray(value)) return value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return Object.assign({}, ...value.map(flattenedStyle));
}

describe('SessionStatusAvatar', () => {
    it('keeps initials and status rendering but withholds the machine identity while pictures are disabled', () => {
        settings.commanderProfilePictures = false;
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SessionStatusAvatar, {
                active: true,
                clientId: null,
                commanderId: 'athena',
                commanderName: 'Athena',
                flavor: 'codex',
                hasDraft: true,
                hasUnread: true,
                machineId: 'machine-one',
                state: 'permission_required',
            }));
        });

        expect(renderer.root.findByType('CommanderSessionAvatar' as any).props).toMatchObject({
            commanderId: 'athena',
            commanderName: 'Athena',
            machineId: null,
        });
        expect(renderer.root.findByType('StatusPulse' as any).props.isPulsing).toBe(true);
        expect(renderer.root.findByType('HarnessBadgeIcon' as any).props.harness).toBe('codex');
        expect(renderer.root.findByType('Ionicons' as any).props.name).toBe('create-outline');
    });

    it('renders Commander identity with the blocking ring, harness and draft overlays', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SessionStatusAvatar, {
                active: true,
                clientId: null,
                commanderId: 'athena',
                commanderName: 'Athena',
                flavor: 'codex',
                hasDraft: true,
                hasUnread: true,
                machineId: 'machine-one',
                machineOffline: true,
                state: 'permission_required',
            }));
        });

        expect(renderer.root.findByType('CommanderSessionAvatar' as any).props).toMatchObject({
            accessible: false,
            commanderId: 'athena',
            commanderName: 'Athena',
            machineId: 'machine-one',
        });
        const outer = renderer.root.findAllByType('View' as any)
            .find((node: any) => node.props.accessibilityRole === 'image');
        expect(outer?.props).toMatchObject({
            accessibilityLabel: 'Athena, machine.machineId: machine-one, happyHerd.sessionStatusAvatar.actionRequired',
            accessibilityState: { busy: true },
        });

        const fadedIdentity = renderer.root.findAllByType('View' as any)
            .map((node: any) => flattenedStyle(node.props.style))
            .find((style: Record<string, unknown>) => style.opacity === 0.55);
        expect(fadedIdentity).toBeTruthy();

        const pulse = renderer.root.findByType('StatusPulse' as any);
        expect(pulse.props.isPulsing).toBe(true);
        expect(flattenedStyle(pulse.props.style)).toMatchObject({
            borderColor: 'orange',
            borderWidth: 3,
        });

        const overlayPositions = renderer.root.findAllByType('View' as any)
            .map((node: any) => flattenedStyle(node.props.style))
            .filter((style: Record<string, unknown>) => style.position === 'absolute');
        expect(overlayPositions).toEqual(expect.arrayContaining([
            expect.objectContaining({ bottom: -1, left: -1 }),
            expect.objectContaining({ bottom: -1, right: -1 }),
        ]));
        expect(renderer.root.findByType('Ionicons' as any).props.name).toBe('create-outline');
        expect(renderer.root.findByType('HarnessBadgeIcon' as any).props.harness).toBe('codex');
    });

    it('keeps the semantic busy state but stops the pulse for reduced motion', () => {
        motion.reduced = true;
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SessionStatusAvatar, {
                active: true,
                commanderId: null,
                flavor: 'claude',
                hasDraft: false,
                hasUnread: false,
                machineId: 'machine-one',
                providerKind: 'claude',
                providerLabel: 'Claude',
                state: 'thinking',
            }));
        });

        expect(renderer.root.findByType('StatusPulse' as any).props.isPulsing).toBe(false);
        const outer = renderer.root.findAllByType('View' as any)
            .find((node: any) => node.props.accessibilityRole === 'image');
        expect(outer?.props).toMatchObject({
            accessibilityLabel: 'Claude, machine.machineId: machine-one, happyHerd.sessionStatusAvatar.thinking',
            accessibilityState: { busy: true },
        });
        expect(renderer.root.findByType('ProviderIcon' as any).props.kind).toBe('claude');
        expect(flattenedStyle(renderer.root.findByType('StatusPulse' as any).props.style))
            .toMatchObject({ borderColor: 'blue', borderWidth: 3 });
    });

    it('uses initials for an unknown non-Commander provider and a neutral idle ring', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SessionStatusAvatar, {
                active: false,
                commanderId: null,
                flavor: null,
                hasDraft: false,
                hasUnread: false,
                machineId: 'machine-one',
                providerKind: 'future-provider',
                providerLabel: 'Future Provider',
                state: 'waiting',
            }));
        });

        expect(renderer.root.findAllByType('ProviderIcon' as any)).toHaveLength(0);
        expect(renderer.root.findByType('Text' as any).props.children).toBe('FP');
        expect(flattenedStyle(renderer.root.findByType('StatusPulse' as any).props.style))
            .toMatchObject({ borderColor: 'neutral', borderWidth: 2 });
    });

    it('derives the GrokBuild provider icon from session flavor', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(SessionStatusAvatar, {
                active: true,
                commanderId: null,
                flavor: 'grok',
                hasDraft: false,
                hasUnread: false,
                machineId: 'machine-one',
                providerKind: null,
                providerLabel: 'GrokBuild',
                state: 'waiting',
            }));
        });

        expect(renderer.root.findByType('ProviderIcon' as any).props.kind).toBe('grok');
        const outer = renderer.root.findAllByType('View' as any)
            .find((node: any) => node.props.accessibilityRole === 'image');
        expect(outer?.props.accessibilityLabel).toContain('GrokBuild');
    });
});
