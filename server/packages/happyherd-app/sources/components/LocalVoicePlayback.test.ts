import * as React from 'react';
// @ts-expect-error react-test-renderer has no declarations in this workspace.
import { act, create } from 'react-test-renderer';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ enabled: true, online: true, status: 'ready' }));

vi.mock('react-native', async () => {
    const ReactModule = await import('react');
    const host = (name: string) => (props: any) => ReactModule.createElement(name, props, props.children);
    return { Platform: { OS: 'web' }, Pressable: host('Pressable'), Text: host('Text'), View: host('View') };
});
vi.mock('react-native-unistyles', () => ({ useUnistyles: () => ({ theme: { colors: { surfaceSelected: 'selected', textLink: 'link', textSecondary: 'secondary', textDestructive: 'danger' } } }) }));
vi.mock('@expo/vector-icons', async () => {
    const ReactModule = await import('react');
    return { Ionicons: (props: any) => ReactModule.createElement('Icon', props) };
});
vi.mock('@/sync/storage', () => ({ useSetting: () => state.enabled }));
vi.mock('@/hooks/useLocalVoiceStatus', () => ({ useLocalVoiceStatus: vi.fn(() => ({ online: state.online, status: { tts: { state: state.status } } })) }));
vi.mock('@/sync/localVoice', () => ({
    cancelLocalVoiceOperation: vi.fn(async () => ({ ok: true })),
    readLocalVoiceAudio: vi.fn(),
    releaseLocalVoiceOperation: vi.fn(async () => ({ ok: true })),
    startLocalVoiceSpeech: vi.fn(),
}));
vi.mock('@/encryption/base64', () => ({ decodeBase64: () => new Uint8Array([1, 2, 3]) }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { LocalVoicePlayback } from './LocalVoicePlayback';
import { useLocalVoiceStatus } from '@/hooks/useLocalVoiceStatus';
import { cancelLocalVoiceOperation, readLocalVoiceAudio, releaseLocalVoiceOperation, startLocalVoiceSpeech } from '@/sync/localVoice';

const defaultRead = {
    chunks: [{ index: 0, audioBase64: 'AQID' }],
    nextCursor: 1,
    state: 'done',
};
const doneRead = { chunks: [], nextCursor: 1, state: 'done' };

class FakeAudioContext {
    static instances: FakeAudioContext[] = [];
    static decodeImpl: (() => Promise<AudioBuffer>) | null = null;
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    sources: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; onended?: () => void }> = [];

    constructor() { FakeAudioContext.instances.push(this); }
    async decodeAudioData() { return FakeAudioContext.decodeImpl ? FakeAudioContext.decodeImpl() : { duration: 0 } as AudioBuffer; }
    createBufferSource() {
        const source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), onended: undefined as (() => void) | undefined };
        this.sources.push(source);
        return source as unknown as AudioBufferSourceNode;
    }
}

function playbackProps(messageId: string, summary: string | null, body: string) {
    return { machineId: 'voice-machine', summary, body, messageId };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
    state.enabled = true;
    state.online = true;
    state.status = 'ready';
    FakeAudioContext.instances = [];
    FakeAudioContext.decodeImpl = null;
    vi.mocked(startLocalVoiceSpeech).mockReset().mockImplementation(async (_machine, text) => ({ operationId: `operation-${text}`, kind: 'speak', state: 'running' } as any));
    vi.mocked(useLocalVoiceStatus).mockReset().mockImplementation(() => ({ online: state.online, status: { tts: { state: state.status } } } as any));
    vi.mocked(readLocalVoiceAudio).mockReset().mockImplementation(async (_machine, _operation, cursor) => (cursor === 0 ? defaultRead : doneRead) as any);
    vi.mocked(cancelLocalVoiceOperation).mockReset().mockResolvedValue({ ok: true });
    vi.mocked(releaseLocalVoiceOperation).mockReset().mockResolvedValue({ ok: true });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeAudioContext } });
});

afterAll(() => {
    Reflect.deleteProperty(globalThis, 'window');
});

beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('LocalVoicePlayback', () => {
    it('does not autoplay, starts the requested text in a user gesture and releases progressive chunks', async () => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => { renderer = create(React.createElement(LocalVoicePlayback, playbackProps('reply-1', 'Short spoken overview.', 'Full reply.'))); });
        expect(FakeAudioContext.instances).toHaveLength(0);
        expect(startLocalVoiceSpeech).not.toHaveBeenCalled();

        const summary = renderer.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.playSummary');
        await act(async () => { summary.props.onPress(); await flush(); });
        expect(FakeAudioContext.instances).toHaveLength(1);
        expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
        expect(startLocalVoiceSpeech).toHaveBeenCalledExactlyOnceWith('voice-machine', 'Short spoken overview.');
        expect(readLocalVoiceAudio).toHaveBeenNthCalledWith(1, 'voice-machine', 'operation-Short spoken overview.', 0);
        expect(readLocalVoiceAudio).toHaveBeenNthCalledWith(2, 'voice-machine', 'operation-Short spoken overview.', 1);
        expect(FakeAudioContext.instances[0].sources).toHaveLength(1);
        expect(releaseLocalVoiceOperation).toHaveBeenCalledExactlyOnceWith('voice-machine', 'operation-Short spoken overview.');
        expect(cancelLocalVoiceOperation).not.toHaveBeenCalled();
        await act(async () => { renderer.unmount(); });
    });

    it('uses the full reply for old messages and cancels playback when another reply starts', async () => {
        let first!: ReturnType<typeof create>;
        let second!: ReturnType<typeof create>;
        await act(async () => {
            first = create(React.createElement(LocalVoicePlayback, playbackProps('reply-1', null, 'Old full reply.')));
            second = create(React.createElement(LocalVoicePlayback, playbackProps('reply-2', 'New summary.', 'New full reply.')));
        });

        let finishFirst!: (value: typeof defaultRead) => void;
        vi.mocked(readLocalVoiceAudio)
            .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }) as any)
            .mockImplementationOnce(async () => defaultRead as any);

        const oldBody = first.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.playReply');
        await act(async () => { oldBody.props.onPress(); await flush(); });
        expect(startLocalVoiceSpeech).toHaveBeenNthCalledWith(1, 'voice-machine', 'Old full reply.');

        const newSummary = second.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.playSummary');
        await act(async () => { newSummary.props.onPress(); await flush(); });
        expect(cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'operation-Old full reply.');
        expect(startLocalVoiceSpeech).toHaveBeenNthCalledWith(2, 'voice-machine', 'New summary.');
        finishFirst(defaultRead);
        await act(async () => { await flush(); });
        expect(releaseLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'operation-New summary.');
        await act(async () => { first.unmount(); second.unmount(); });
    });

    it('hides controls while local TTS is off or not ready', async () => {
        state.enabled = false;
        let disabled!: ReturnType<typeof create>;
        await act(async () => { disabled = create(React.createElement(LocalVoicePlayback, playbackProps('reply-1', 'Summary.', 'Body.'))); });
        expect(disabled.toJSON()).toBeNull();
        await act(async () => { disabled.unmount(); });

        state.enabled = true;
        const statusModule = await import('@/hooks/useLocalVoiceStatus');
        vi.mocked(statusModule.useLocalVoiceStatus).mockReturnValue({ online: true, status: { tts: { state: 'installing' } } } as any);
        let installing!: ReturnType<typeof create>;
        await act(async () => { installing = create(React.createElement(LocalVoicePlayback, playbackProps('reply-2', 'Summary.', 'Body.'))); });
        expect(installing.toJSON()).toBeNull();
        await act(async () => { installing.unmount(); });
        vi.mocked(statusModule.useLocalVoiceStatus).mockReturnValue({ online: true, status: { tts: { state: 'ready' } } } as any);
    });

    it.each(['tts-off', 'machine-change', 'offline'] as const)('cancels active playback when eligibility changes: %s', async (change) => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => { renderer = create(React.createElement(LocalVoicePlayback, playbackProps('reply-eligibility', 'Summary.', 'Body.'))); });
        let finishRead!: (value: typeof defaultRead) => void;
        vi.mocked(readLocalVoiceAudio).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }) as any);

        const body = renderer.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.playReply');
        await act(async () => { body.props.onPress(); await flush(); });
        expect(renderer.root.findAllByType('Pressable' as any)
            .some((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.stop')).toBe(true);

        if (change === 'tts-off') state.enabled = false;
        if (change === 'machine-change') {
            await act(async () => { renderer.update(React.createElement(LocalVoicePlayback, { ...playbackProps('reply-eligibility', 'Summary.', 'Body.'), machineId: 'other-machine' })); });
        } else {
            if (change === 'offline') state.online = false;
            await act(async () => { renderer.update(React.createElement(LocalVoicePlayback, playbackProps('reply-eligibility', 'Summary.', 'Body.'))); });
        }

        expect(cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'operation-Body.');
        finishRead(defaultRead);
        await act(async () => { await flush(); });
        expect(releaseLocalVoiceOperation).not.toHaveBeenCalled();
        await act(async () => { renderer.unmount(); });
        state.enabled = true;
        state.online = true;
    });

    it('does not schedule audio decoded after playback becomes ineligible', async () => {
        let renderer!: ReturnType<typeof create>;
        let finishDecode!: (value: AudioBuffer) => void;
        FakeAudioContext.decodeImpl = () => new Promise((resolve) => { finishDecode = resolve; });
        await act(async () => { renderer = create(React.createElement(LocalVoicePlayback, playbackProps('reply-decode', 'Summary.', 'Body.'))); });

        const body = renderer.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.playReply');
        await act(async () => { body.props.onPress(); await flush(); });
        expect(FakeAudioContext.instances[0].sources).toHaveLength(0);

        state.enabled = false;
        await act(async () => { renderer.update(React.createElement(LocalVoicePlayback, playbackProps('reply-decode', 'Summary.', 'Body.'))); });
        expect(cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'operation-Body.');
        finishDecode({ duration: 0 } as AudioBuffer);
        await act(async () => { await flush(); });

        expect(FakeAudioContext.instances[0].sources).toHaveLength(0);
        expect(releaseLocalVoiceOperation).not.toHaveBeenCalled();
        await act(async () => { renderer.unmount(); });
        state.enabled = true;
    });

    it('cancels and stops through the visible stop control', async () => {
        let renderer!: ReturnType<typeof create>;
        await act(async () => { renderer = create(React.createElement(LocalVoicePlayback, playbackProps('reply-stop', 'Summary.', 'Body.'))); });
        let finishRead!: (value: typeof defaultRead) => void;
        vi.mocked(readLocalVoiceAudio).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }) as any);
        const body = renderer.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.playReply');
        await act(async () => { body.props.onPress(); await flush(); });
        const stop = renderer.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.stop');
        act(() => stop.props.onPress());
        expect(cancelLocalVoiceOperation).toHaveBeenCalledWith('voice-machine', 'operation-Body.');
        expect(renderer.root.findAllByType('Pressable' as any)
            .some((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.stop')).toBe(false);
        finishRead(defaultRead);
        await act(async () => { await flush(); });
        await act(async () => { renderer.unmount(); });
    });

    it('cancels the daemon operation if stop happens before speech start returns its operation id', async () => {
        let renderer!: ReturnType<typeof create>;
        let finishStart!: (value: any) => void;
        vi.mocked(startLocalVoiceSpeech).mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve; }) as any);
        await act(async () => { renderer = create(React.createElement(LocalVoicePlayback, playbackProps('reply-start-pending', 'Summary.', 'Body.'))); });

        const body = renderer.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.playReply');
        await act(async () => { body.props.onPress(); await flush(); });
        const stop = renderer.root.findAllByType('Pressable' as any).find((button: any) => button.props.accessibilityLabel === 'happyHerd.localVoice.stop');
        act(() => stop.props.onPress());
        expect(cancelLocalVoiceOperation).not.toHaveBeenCalled();

        finishStart({ operationId: 'late-speech-operation', kind: 'speak', state: 'running' });
        await act(async () => { await flush(); });
        expect(cancelLocalVoiceOperation).toHaveBeenCalledExactlyOnceWith('voice-machine', 'late-speech-operation');
        expect(readLocalVoiceAudio).not.toHaveBeenCalled();
        await act(async () => { renderer.unmount(); });
    });
});
