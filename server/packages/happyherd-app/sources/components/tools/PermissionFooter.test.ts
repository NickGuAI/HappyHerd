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
vi.mock('react-native-unistyles', () => ({
    useUnistyles: () => ({
        theme: {
            colors: {
                divider: 'divider',
                surface: 'surface',
                surfaceHighest: 'surface-highest',
                text: 'text',
                textSecondary: 'text-secondary',
            },
        },
    }),
}));
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
