import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ specialized: null as any }));
vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { Text: host('Text'), View: host('View'), ScrollView: host('ScrollView'), Platform: { select: (value: any) => value.web ?? value.default }, useWindowDimensions: () => ({ width: 1440 }) };
});
vi.mock('react-native-unistyles', () => ({ StyleSheet: { create: (factory: any) => factory({ colors: { text: '#111', groupped: { background: '#fff' }, box: { error: {} } } }) } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../layout', () => ({ layout: { maxWidth: 800 } }));
vi.mock('../CodeView', async () => { const ReactModule = await import('react'); return { CodeView: (props: any) => ReactModule.createElement('CodeView', props) }; });
vi.mock('../CommandView', async () => { const ReactModule = await import('react'); return { CommandView: (props: any) => ReactModule.createElement('CommandView', props) }; });
vi.mock('./views/_all', () => ({ getToolFullViewComponent: () => mocks.specialized }));
vi.mock('@/sync/storage', () => ({ useLocalSetting: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { ToolFullView } from './ToolFullView';

beforeAll(() => {
    vi.stubGlobal('__DEV__', false);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation((message, ...args) => {
        if (typeof message === 'string' && message.startsWith('react-test-renderer is deprecated')) return;
        original(message, ...args);
    });
});
afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => { mocks.specialized = null; });

const tool = { name: 'exec_command', input: { cmd: 'printf value' }, state: 'completed' as const, result: false, createdAt: 1, startedAt: 1, completedAt: 2, description: null };
const render = (props: any): ReactTestRenderer => { let renderer!: ReactTestRenderer; act(() => { renderer = create(React.createElement(ToolFullView, props)); }); return renderer; };

describe('ToolFullView provider terminal output', () => {
    it.each([false, 0, null, { value: 'retained' }])('preserves completed output %j in the shared CommandView', result => {
        const renderer = render({ tool: { ...tool, result } });
        expect(renderer.root.findByType('CommandView' as any).props).toMatchObject({ command: 'printf value', stdout: JSON.stringify(result, null, 2), error: null });
        act(() => renderer.unmount());
    });
    it('keeps a structured error and a separate falsy result', () => {
        const renderer = render({ tool: { ...tool, state: 'error', result: 0, error: { exitCode: 2, stderr: 'failed' } } });
        expect(renderer.root.findByType('CommandView' as any).props).toMatchObject({ stdout: '0', error: '{\n  "exitCode": 2,\n  "stderr": "failed"\n}' });
        act(() => renderer.unmount());
    });
    it('passes exact session, provider metadata, and focused file to a specialized full view', () => {
        mocks.specialized = (props: any) => React.createElement('SpecializedFullView', props);
        const metadata = { flavor: 'codex', path: '/workspace/project' };
        const renderer = render({ tool, metadata, sessionId: 'session-1', focusFile: 'src/a%20b.ts' });
        expect(renderer.root.findByType('SpecializedFullView' as any).props).toMatchObject({ metadata, sessionId: 'session-1', focusFile: 'src/a%20b.ts' });
        act(() => renderer.unmount());
    });
});
