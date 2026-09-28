import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ops = vi.hoisted(() => ({
    allow: vi.fn(),
    deny: vi.fn(),
    setAgentModes: vi.fn(),
}));

vi.mock('@/sync/ops', () => ({
    sessionAllow: ops.allow,
    sessionDeny: ops.deny,
    sessionSetAgentModes: ops.setAgentModes,
}));
vi.mock('react-native', () => {
    class AnimatedValue {
        interpolate() { return 0; }
        setValue() {}
        stopAnimation() {}
    }

    return {
        Animated: {
            Value: AnimatedValue,
            View: 'AnimatedView',
            loop: () => ({ start() {}, stop() {} }),
            sequence: () => ({}),
            timing: () => ({}),
        },
        Easing: { inOut: (value: unknown) => value, quad: 'quad' },
        Platform: {
            OS: 'web',
            select: (values: Record<string, unknown>) => values.web ?? values.default,
        },
        ScrollView: 'ScrollView',
        StyleSheet: { absoluteFillObject: {}, create: (styles: unknown) => styles },
        Text: 'Text',
        TouchableOpacity: 'TouchableOpacity',
        View: 'View',
        useWindowDimensions: () => ({ height: 800, width: 1200 }),
    };
});
vi.mock('react-native-unistyles', async () => {
    // The real tokens back everything the fixture does not pin explicitly.
    const { lightTheme } = await import('@/theme');
    const theme = {
        ...lightTheme,
        colors: {
            ...lightTheme.colors,
            divider: 'divider',
            surface: 'surface',
            surfaceHighest: 'surface-highest',
            text: 'text',
            textSecondary: 'text-secondary',
        },
    };
    return { useUnistyles: () => ({ theme }) };
});
vi.mock('@expo/vector-icons', () => ({ Octicons: 'Octicons' }));
vi.mock('@/utils/responsive', () => ({ useIsTablet: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));
vi.mock('@/components/ProviderIcon', () => ({ ProviderIcon: 'ProviderIcon' }));

import { PermissionFooter } from './PermissionFooter';

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
    vi.clearAllMocks();
});

describe('PermissionFooter GrokBuild decisions', () => {
    it('sends an explicit denied decision for the rejection option', async () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(PermissionFooter, {
                metadata: { flavor: 'grok' },
                permission: { id: 'permission-1', status: 'pending' },
                sessionId: 'session-1',
                toolName: 'write_file',
            }));
        });

        const buttons = renderer.root.findAllByType('TouchableOpacity' as any);
        expect(buttons).toHaveLength(2);

        await act(async () => {
            await buttons[1].props.onPress();
        });

        expect(ops.deny).toHaveBeenCalledWith(
            'session-1',
            'permission-1',
            undefined,
            undefined,
            'denied',
        );
    });
});

describe('PermissionFooter Web choices (UI overhaul)', () => {
    function texts(renderer: ReturnType<typeof create>): string[] {
        return renderer.root.findAllByType('Text' as any).flatMap((node: any) => node.children.map(String));
    }

    it('numbers the provider choices while pending', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(PermissionFooter, {
                metadata: { flavor: 'claude' },
                permission: { id: 'permission-edit', status: 'pending' },
                sessionId: 'session-1',
                toolName: 'Edit',
            }));
        });
        expect(texts(renderer)).toEqual([
            'common.yes', '1',
            'claude.permissions.yesAllowAllEdits', '2',
            'claude.permissions.noTellClaude', '3',
        ]);
        expect(renderer.root.findAllByType('Octicons' as any)).toHaveLength(0);
    });

    it('marks the chosen answer once decided and drops the key hints', () => {
        let renderer!: ReturnType<typeof create>;
        act(() => {
            renderer = create(React.createElement(PermissionFooter, {
                metadata: { flavor: 'codex' },
                permission: { id: 'permission-codex', status: 'approved', decision: 'approved_for_session' },
                sessionId: 'session-1',
                toolName: 'CodexBash',
            }));
        });
        expect(texts(renderer)).toEqual(['common.yes', 'codex.permissions.yesForSession', 'codex.permissions.stopAndExplain']);
        const checks = renderer.root.findAllByType('Octicons' as any);
        expect(checks).toHaveLength(1);
        const buttons = renderer.root.findAllByType('TouchableOpacity' as any);
        expect(buttons.every((button: any) => button.props.disabled)).toBe(true);
        const chosen = buttons.findIndex((button: any) => button.findAllByType('Octicons' as any).length === 1);
        expect(chosen).toBe(1);
    });
});
