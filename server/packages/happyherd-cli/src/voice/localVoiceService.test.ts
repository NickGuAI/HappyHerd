import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalVoiceService } from './localVoiceService';

describe('LocalVoiceService', () => {
    let homeDir: string;

    beforeEach(async () => {
        homeDir = await mkdtemp(join(tmpdir(), 'happyherd-local-voice-'));
    });

    afterEach(async () => {
        vi.useRealTimers();
        await rm(homeDir, { recursive: true, force: true });
    });

    async function installState(feature: 'stt' | 'tts') {
        const root = join(homeDir, 'local-voice');
        if (feature === 'stt') {
            await mkdir(join(root, 'stt', 'venv', 'bin'), { recursive: true });
            await writeFile(join(root, 'stt', 'venv', 'bin', 'python'), '');
            await writeFile(join(root, 'stt', 'ready.json'), '{}');
            await mkdir(join(root, 'tools', 'node_modules', 'ffmpeg-static'), { recursive: true });
            await writeFile(join(root, 'tools', 'node_modules', 'ffmpeg-static', 'package.json'), '{}');
        } else {
            for (const language of ['en', 'zh']) {
                await mkdir(join(root, 'tts', language), { recursive: true });
                for (const file of ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt', 'date-zh.fst', 'phone-zh.fst', 'number-zh.fst']) {
                    await writeFile(join(root, 'tts', language, file), 'fixture');
                }
                await mkdir(join(root, 'tts', language, 'dict'), { recursive: true });
                await mkdir(join(root, 'tts', language, 'espeak-ng-data'), { recursive: true });
            }
            await mkdir(join(root, 'tools', 'node_modules', 'sherpa-onnx-node'), { recursive: true });
            await writeFile(join(root, 'tools', 'node_modules', 'sherpa-onnx-node', 'package.json'), '{}');
            await mkdir(join(root, 'tools', 'node_modules', 'sherpa-onnx-linux-x64'), { recursive: true });
            await writeFile(join(root, 'tools', 'node_modules', 'sherpa-onnx-linux-x64', 'sherpa-onnx.node'), 'fixture');
        }
    }

    function wav(): Buffer {
        const audio = Buffer.alloc(48);
        audio.write('RIFF', 0);
        audio.writeUInt32LE(40, 4);
        audio.write('WAVEfmt ', 8);
        audio.writeUInt32LE(16, 16);
        audio.writeUInt16LE(1, 20);
        audio.writeUInt16LE(1, 22);
        audio.writeUInt32LE(24_000, 24);
        audio.writeUInt32LE(48_000, 28);
        audio.writeUInt16LE(2, 32);
        audio.writeUInt16LE(16, 34);
        audio.write('data', 36);
        audio.writeUInt32LE(4, 40);
        return audio;
    }

    async function settle(service: LocalVoiceService, operationId: string) {
        for (let i = 0; i < 40; i += 1) {
            const operation = await service.operation({ operationId });
            if (operation.state === 'done' || operation.state === 'error' || operation.state === 'cancelled') return operation;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        throw new Error('Voice operation did not settle');
    }

    it('returns an operation immediately and reports an opt-in install state', async () => {
        let finish!: () => void;
        const service = new LocalVoiceService({
            homeDir,
            platform: 'darwin',
            architecture: 'arm64',
            runInstall: async (_feature, _progress, signal) => await new Promise<void>((resolve, reject) => {
                finish = resolve;
                signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
            }),
        });
        const startedAt = Date.now();
        const operation = await service.install({ feature: 'stt' });
        expect(Date.now() - startedAt).toBeLessThan(100);
        expect(operation).toMatchObject({ kind: 'install', state: 'running' });
        expect((await service.status()).stt.state).toBe('installing');
        await service.cancel({ operationId: operation.operationId });
        expect((await service.operation({ operationId: operation.operationId })).state).toBe('cancelled');
        finish();
        await service.shutdown();
    });

    it('deduplicates concurrent install requests for the same feature', async () => {
        let installStarts = 0;
        const service = new LocalVoiceService({
            homeDir,
            platform: 'darwin', architecture: 'arm64',
            runInstall: async (_feature, _progress, signal) => await new Promise<void>((resolve, reject) => {
                installStarts += 1;
                signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
            }),
        });

        const [first, retry] = await Promise.all([
            service.install({ feature: 'tts' }),
            service.install({ feature: 'tts' }),
        ]);

        expect(first.operationId).toBe(retry.operationId);
        expect(installStarts).toBe(1);
        await service.cancel({ operationId: first.operationId });
        await service.shutdown();
    });

    it('can retry a failed engine installation', async () => {
        let installAttempts = 0;
        const service = new LocalVoiceService({
            homeDir,
            platform: 'darwin', architecture: 'arm64',
            runInstall: async () => {
                installAttempts += 1;
                if (installAttempts === 1) throw new Error('temporary package registry failure');
            },
        });

        const failed = await service.install({ feature: 'tts' });
        expect(await settle(service, failed.operationId)).toMatchObject({ state: 'error', error: 'temporary package registry failure' });
        expect((await service.status()).tts).toMatchObject({ state: 'failed', error: 'temporary package registry failure' });

        const retry = await service.install({ feature: 'tts' });
        expect(retry.operationId).not.toBe(failed.operationId);
        expect(await settle(service, retry.operationId)).toMatchObject({ state: 'done' });
        expect(installAttempts).toBe(2);
        expect((await service.status()).tts.state).toBe('not-installed');
        await service.shutdown();
    });

    it('accepts retried upload chunks and transcribes through the asynchronous operation', async () => {
        await installState('stt');
        const service = new LocalVoiceService({
            homeDir,
            platform: 'darwin', architecture: 'arm64',
            runTranscription: async () => '  Hello from Qwen.  ',
        });
        const bytes = Buffer.from('captured audio bytes');
        const upload = await service.uploadStart({ mimeType: 'audio/webm;codecs=opus', byteLength: bytes.length });
        const first = bytes.subarray(0, 8);
        const second = bytes.subarray(8);
        const duplicateWrites = await Promise.all([
            service.uploadChunk({ operationId: upload.operationId, offset: 0, audioBase64: first.toString('base64') }),
            service.uploadChunk({ operationId: upload.operationId, offset: 0, audioBase64: first.toString('base64') }),
        ]);
        expect(duplicateWrites).toEqual([{ nextOffset: first.length }, { nextOffset: first.length }]);
        await expect(service.uploadChunk({ operationId: upload.operationId, offset: first.length + 1, audioBase64: second.toString('base64') })).rejects.toThrow('expected offset');
        await expect(service.uploadChunk({ operationId: upload.operationId, offset: 0, audioBase64: second.toString('base64') })).rejects.toThrow('differs from bytes already written');
        await service.uploadChunk({ operationId: upload.operationId, offset: first.length, audioBase64: second.toString('base64') });
        expect(await service.uploadChunk({ operationId: upload.operationId, offset: 0, audioBase64: first.toString('base64') })).toEqual({ nextOffset: bytes.length });
        await expect(service.uploadChunk({ operationId: upload.operationId, offset: 0, audioBase64: second.toString('base64') })).rejects.toThrow('differs from bytes already written');
        const started = await service.transcribe({ operationId: upload.operationId });
        expect(started.state).toBe('running');
        expect(await settle(service, upload.operationId)).toMatchObject({ state: 'done', text: 'Hello from Qwen.' });
        await service.release({ operationId: upload.operationId });
        await expect(service.operation({ operationId: upload.operationId })).rejects.toThrow('expired or was released');
        await service.shutdown();
    });

    it('does not restart transcription if cancellation lands during readiness polling', async () => {
        await installState('stt');
        let transcriptionStarts = 0;
        const service = new LocalVoiceService({
            homeDir,
            platform: 'darwin', architecture: 'arm64',
            runTranscription: async () => { transcriptionStarts += 1; return 'must not start'; },
        });
        const bytes = Buffer.from('captured audio bytes');
        const upload = await service.uploadStart({ mimeType: 'audio/webm', byteLength: bytes.length });
        await service.uploadChunk({ operationId: upload.operationId, offset: 0, audioBase64: bytes.toString('base64') });

        let resumeStatus!: () => void;
        let announceStatus!: () => void;
        const statusGate = new Promise<void>((resolve) => { resumeStatus = resolve; });
        const statusStarted = new Promise<void>((resolve) => { announceStatus = resolve; });
        const originalStatus = service.status.bind(service);
        (service as unknown as { status: () => Promise<Awaited<ReturnType<LocalVoiceService['status']>>> }).status = async () => {
            announceStatus();
            await statusGate;
            return originalStatus();
        };
        const transcribing = service.transcribe({ operationId: upload.operationId });
        await statusStarted;
        await service.cancel({ operationId: upload.operationId });
        resumeStatus();

        expect(await transcribing).toMatchObject({ state: 'cancelled' });
        expect(transcriptionStarts).toBe(0);
        await service.shutdown();
    });

    it('keeps a long installation pollable beyond the RPC timeout', async () => {
        vi.useFakeTimers();
        let service: LocalVoiceService | undefined;
        try {
            service = new LocalVoiceService({
                homeDir,
                platform: 'darwin', architecture: 'arm64',
                runInstall: async () => await new Promise<void>((resolve) => setTimeout(resolve, 31_000)),
            });
            const operation = await service.install({ feature: 'stt' });
            expect(operation.state).toBe('running');

            await vi.advanceTimersByTimeAsync(31_000);
            for (let i = 0; i < 5; i += 1) await Promise.resolve();

            expect(await service.operation({ operationId: operation.operationId })).toMatchObject({ state: 'done' });
            await service.release({ operationId: operation.operationId });
        } finally {
            await service?.shutdown();
            vi.useRealTimers();
        }
    });

    it('waits for a spawned worker to exit after cancellation before completing', async () => {
        const service = new LocalVoiceService({ homeDir });
        const execute = (service as unknown as {
            exec(command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }>;
        }).exec.bind(service);
        const controller = new AbortController();
        const startedAt = Date.now();
        const operation = execute(process.execPath, [
            '-e',
            'process.on("SIGTERM", () => setTimeout(() => process.exit(0), 120)); setInterval(() => {}, 1000)',
        ], {}, controller.signal);
        await new Promise((resolve) => setTimeout(resolve, 100));
        controller.abort();

        await expect(operation).rejects.toThrow('cancelled');
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
        await service.shutdown();
    });

    it('keeps audio reads ordered and repeatable while synthesis is still running', async () => {
        await installState('tts');
        const service = new LocalVoiceService({
            homeDir,
            platform: 'linux', architecture: 'x64',
            runSpeech: async (_text, language, onAudio, _progress, signal) => {
                expect(language).toBe('zh');
                onAudio(wav(), 24_000);
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                onAudio(wav(), 24_000);
                await new Promise<void>((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
            },
        });
        const operation = await service.speak({ text: '这是一段中文口语概览和语音测试 summary' });
        const first = await service.read({ operationId: operation.operationId, cursor: 0 });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const repeated = await service.read({ operationId: operation.operationId, cursor: 0 });
        expect(first).toEqual(repeated);
        expect(first).toMatchObject({ state: 'running', nextCursor: 1, chunks: [{ index: 0, mimeType: 'audio/wav', sampleRate: 24_000 }] });
        expect((await service.read({ operationId: operation.operationId, cursor: 1 })).chunks[0]).toMatchObject({ index: 1, sampleRate: 24_000 });
        await service.cancel({ operationId: operation.operationId });
        expect((await service.operation({ operationId: operation.operationId })).state).toBe('cancelled');
        await service.shutdown();
    });

    it('expires inactive operations and releases their transient output', async () => {
        await installState('tts');
        vi.useFakeTimers();
        let now = 1_000;
        const service = new LocalVoiceService({
            homeDir,
            platform: 'linux', architecture: 'x64',
            now: () => now,
            operationTtlMs: 100,
            runSpeech: async (_text, _language, onAudio, _progress, signal) => {
                onAudio(wav(), 24_000);
                await new Promise<void>((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
            },
        });
        const operation = await service.speak({ text: 'A short English summary.' });
        expect((await service.read({ operationId: operation.operationId, cursor: 0 })).chunks).toHaveLength(1);
        now += 101;
        await vi.advanceTimersByTimeAsync(60_000);
        await expect(service.operation({ operationId: operation.operationId })).rejects.toThrow('expired or was released');
        await service.shutdown();
        vi.useRealTimers();
    });

    it('cleans up operation directories left behind by an unclean daemon exit', async () => {
        const orphan = join(homeDir, 'local-voice', 'operations', 'orphaned-upload');
        await mkdir(orphan, { recursive: true });
        await writeFile(join(orphan, 'recording.input'), 'private audio bytes');
        const service = new LocalVoiceService({ homeDir, platform: 'darwin', architecture: 'arm64', runInstall: async () => {} });

        await service.status();
        await expect(stat(orphan)).resolves.toBeDefined();
        const operation = await service.install({ feature: 'tts' });
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try { await stat(orphan); } catch { break; }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await expect(stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
        await settle(service, operation.operationId);
        await service.release({ operationId: operation.operationId });
        await service.shutdown();
    });

    it('does not report partially extracted TTS assets as ready', async () => {
        const root = join(homeDir, 'local-voice');
        for (const language of ['en', 'zh']) {
            const directory = join(root, 'tts', language);
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, 'model.onnx'), 'partial model');
        }
        await mkdir(join(root, 'tools', 'node_modules', 'sherpa-onnx-node'), { recursive: true });
        await writeFile(join(root, 'tools', 'node_modules', 'sherpa-onnx-node', 'package.json'), '{}');
        await mkdir(join(root, 'tools', 'node_modules', 'sherpa-onnx-linux-x64'), { recursive: true });
        await writeFile(join(root, 'tools', 'node_modules', 'sherpa-onnx-linux-x64', 'sherpa-onnx.node'), 'fixture');
        const service = new LocalVoiceService({ homeDir, platform: 'linux', architecture: 'x64' });

        expect((await service.status()).tts.state).toBe('not-installed');
        await service.shutdown();
    });

    it('reports ASR as Apple-only while allowing Sherpa TTS on Linux x64', async () => {
        const service = new LocalVoiceService({ homeDir, platform: 'linux', architecture: 'x64' });
        expect(await service.status()).toMatchObject({
            stt: { state: 'unsupported' },
            tts: { state: 'not-installed' },
        });
        await expect(service.install({ feature: 'stt' })).rejects.toThrow('Apple Silicon Mac');
        await service.shutdown();
    });

    it('advertises Kokoro TTS only on the verified macOS arm64 and Linux x64 targets', async () => {
        for (const target of [
            { platform: 'darwin' as const, architecture: 'arm64', state: 'not-installed' },
            { platform: 'linux' as const, architecture: 'x64', state: 'not-installed' },
            { platform: 'darwin' as const, architecture: 'x64', state: 'unsupported' },
            { platform: 'linux' as const, architecture: 'arm64', state: 'unsupported' },
            { platform: 'win32' as const, architecture: 'x64', state: 'unsupported' },
        ]) {
            const service = new LocalVoiceService({ homeDir, platform: target.platform, architecture: target.architecture });
            expect((await service.status()).tts.state).toBe(target.state);
            await service.shutdown();
        }
    });

    it('routes mixed Chinese and English text by Han characters versus Latin words', async () => {
        await installState('tts');
        const routedLanguages: Array<'en' | 'zh'> = [];
        const service = new LocalVoiceService({
            homeDir,
            platform: 'linux', architecture: 'x64',
            runSpeech: async (_text, language, onAudio) => { routedLanguages.push(language); onAudio(wav(), 24_000); },
        });

        const chinese = await service.speak({ text: '请用 HappyHerd 播放这段回复' });
        expect(await settle(service, chinese.operationId)).toMatchObject({ state: 'done' });
        const english = await service.speak({ text: 'HappyHerd play this 这段回复 for me' });
        expect(await settle(service, english.operationId)).toMatchObject({ state: 'done' });

        expect(routedLanguages).toEqual(['zh', 'en']);
        await service.shutdown();
    });

    it('refreshes active install TTL from status polling', async () => {
        let now = 1_000;
        const service = new LocalVoiceService({
            homeDir,
            platform: 'darwin', architecture: 'arm64',
            now: () => now,
            operationTtlMs: 100,
            runInstall: async (_feature, _progress, signal) => await new Promise<void>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
            }),
        });
        const operation = await service.install({ feature: 'stt' });
        const internals = service as unknown as { expireOperations: () => Promise<void> };

        now += 90;
        expect((await service.status()).stt.state).toBe('installing');
        now += 90;
        await internals.expireOperations();
        expect(await service.operation({ operationId: operation.operationId })).toMatchObject({ state: 'running' });

        now += 101;
        await internals.expireOperations();
        await expect(service.operation({ operationId: operation.operationId })).rejects.toThrow('expired or was released');
        await service.shutdown();
    });

    it('does not extend inference TTL from engine progress', async () => {
        await installState('tts');
        let now = 1_000;
        let reportProgress!: (value: string) => void;
        let announceStarted!: () => void;
        const started = new Promise<void>((resolve) => { announceStarted = resolve; });
        const service = new LocalVoiceService({
            homeDir,
            platform: 'linux', architecture: 'x64',
            now: () => now,
            operationTtlMs: 100,
            runSpeech: async (_text, _language, _onAudio, progress, signal) => {
                reportProgress = progress;
                announceStarted();
                await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
            },
        });
        const operation = await service.speak({ text: 'A short English summary.' });
        await started;

        now += 90;
        reportProgress('Still generating audio');
        now += 11;
        const internals = service as unknown as { expireOperations: () => Promise<void> };
        await internals.expireOperations();

        await expect(service.operation({ operationId: operation.operationId })).rejects.toThrow('expired or was released');
        await service.shutdown();
    });

    it('clears completed audio and removes its temporary directory when cancelled', async () => {
        await installState('tts');
        const service = new LocalVoiceService({ homeDir, platform: 'linux', architecture: 'x64', runSpeech: async (_text, _language, onAudio) => onAudio(wav(), 24_000) });
        const operation = await service.speak({ text: 'Completed audio.' });
        expect(await settle(service, operation.operationId)).toMatchObject({ state: 'done' });
        expect((await service.read({ operationId: operation.operationId, cursor: 0 })).chunks).toHaveLength(1);

        const directory = join(homeDir, 'local-voice', 'operations', operation.operationId);
        const startedAt = Date.now();
        expect(await service.cancel({ operationId: operation.operationId })).toEqual({ ok: true });
        expect(Date.now() - startedAt).toBeLessThan(100);
        expect((await service.operation({ operationId: operation.operationId })).state).toBe('done');
        expect(await service.read({ operationId: operation.operationId, cursor: 0 })).toMatchObject({ state: 'done', nextCursor: 0, chunks: [] });
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try { await stat(directory); } catch { break; }
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
        await service.shutdown();
    });

    it('returns from cancellation without waiting for an uncooperative engine task', async () => {
        await installState('tts');
        let finish!: () => void;
        const service = new LocalVoiceService({
            homeDir, platform: 'linux', architecture: 'x64',
            runSpeech: async () => await new Promise<void>((resolve) => { finish = resolve; }),
        });
        const operation = await service.speak({ text: 'Cancelable speech.' });
        const result = await Promise.race([
            service.cancel({ operationId: operation.operationId }),
            new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('cancel RPC blocked')), 500)),
        ]);
        expect(result).toEqual({ ok: true });
        expect((await service.operation({ operationId: operation.operationId })).state).toBe('cancelled');
        finish();
        await service.shutdown();
    });

    it('keeps status responsive while expiry stops a long-running operation', async () => {
        await installState('tts');
        let now = 1_000;
        let finish!: () => void;
        const service = new LocalVoiceService({
            homeDir, platform: 'linux', architecture: 'x64', now: () => now, operationTtlMs: 100,
            runSpeech: async () => await new Promise<void>((resolve) => { finish = resolve; }),
        });
        const operation = await service.speak({ text: 'Long-running synthesis.' });
        now += 101;
        const internals = service as unknown as { expireOperations: () => Promise<void> };
        await internals.expireOperations();

        const status = await Promise.race([
            service.status(),
            new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('status RPC blocked on operation cleanup')), 500)),
        ]);
        expect(status.tts.state).toBe('ready');
        await expect(service.operation({ operationId: operation.operationId })).rejects.toThrow('expired or was released');
        finish();
        await service.shutdown();
    });

    it('turns worker stdout append failures into operation errors', async () => {
        await installState('tts');
        const service = new LocalVoiceService({ homeDir, platform: 'linux', architecture: 'x64' });
        const internals = service as unknown as {
            ttsWorkerSource: () => string;
            appendWav: (operation: unknown, audio: Buffer, sampleRate: number) => void;
        };
        const wavBase64 = wav().toString('base64');
        internals.ttsWorkerSource = () => `const wav = Buffer.from('${wavBase64}', 'base64'); const frame = Buffer.alloc(4 + wav.length); frame.writeUInt32LE(wav.length); wav.copy(frame, 4); process.stdout.write(frame);`;
        internals.appendWav = () => { throw new Error('audio buffer append failed'); };

        const operation = await service.speak({ text: 'Worker stream failure.' });
        expect(await settle(service, operation.operationId)).toMatchObject({ state: 'error', error: 'audio buffer append failed' });
        await service.release({ operationId: operation.operationId });
        await service.shutdown();
    });

    it('serializes shared npm runtime installs and invokes npm directly', async () => {
        const service = new LocalVoiceService({ homeDir, platform: 'linux', architecture: 'x64' });
        const internals = service as unknown as {
            installDecoder: (report: (value: string) => void, signal: AbortSignal, includeTts: boolean) => Promise<void>;
            pathExists: (path: string) => Promise<boolean>;
            exec: (command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<{ stdout: string; stderr: string }>;
        };
        let ffmpegInstalled = false;
        let sherpaInstalled = false;
        internals.pathExists = async (path) => path.endsWith('ffmpeg-static/package.json') ? ffmpegInstalled : sherpaInstalled;
        let unblockFirst!: () => void;
        let announceFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => { unblockFirst = resolve; });
        const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve; });
        const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
        let running = 0;
        let maximumRunning = 0;
        internals.exec = async (command, args, env) => {
            calls.push({ command, args, env });
            running += 1;
            maximumRunning = Math.max(maximumRunning, running);
            if (calls.length === 1) {
                announceFirst();
                await firstGate;
            }
            ffmpegInstalled = true;
            if (args.includes('sherpa-onnx-node@1.13.8')) sherpaInstalled = true;
            running -= 1;
            return { stdout: '', stderr: '' };
        };
        const signal = new AbortController().signal;
        const sttRuntime = internals.installDecoder(() => {}, signal, false);
        await firstStarted;
        const ttsRuntime = internals.installDecoder(() => {}, signal, true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(calls).toHaveLength(1);
        unblockFirst();
        await Promise.all([sttRuntime, ttsRuntime]);
        expect(maximumRunning).toBe(1);
        expect(calls.map((call) => call.command)).toEqual(['npm', 'npm']);
        expect(calls[1]?.args).toContain('sherpa-onnx-node@1.13.8');
        expect(calls.every((call) => call.env.npm_execpath === undefined)).toBe(true);
        await service.shutdown();
    });

    it('passes AbortSignal through venv, pip, and model-prefetch child processes', async () => {
        const service = new LocalVoiceService({ homeDir, platform: 'darwin', architecture: 'arm64' });
        const internals = service as unknown as {
            installFeature: (feature: 'stt', report: (value: string) => void, signal: AbortSignal) => Promise<void>;
            installDecoder: (report: (value: string) => void, signal: AbortSignal, includeTts: boolean) => Promise<void>;
            findPython: () => Promise<string>;
            exec: (command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<{ stdout: string; stderr: string }>;
        };
        internals.installDecoder = async () => {};
        internals.findPython = async () => '/fixture/python';
        const childSignals: Array<AbortSignal | undefined> = [];
        internals.exec = async (_command, _args, _env, signal) => { childSignals.push(signal); return { stdout: '', stderr: '' }; };
        const controller = new AbortController();

        await internals.installFeature('stt', () => {}, controller.signal);

        expect(childSignals).toHaveLength(3);
        expect(childSignals.every((signal) => signal === controller.signal)).toBe(true);
        await service.shutdown();
    });

    it('uses uv to find a supported Python when named interpreters are too old', async () => {
        const python = join(homeDir, 'uv-python');
        const bin = join(homeDir, 'bin');
        await mkdir(bin, { recursive: true });
        const pythonScript = `#!/bin/sh\nprintf 'Python 3.13.13\\n'\n`;
        const uvScript = `#!/bin/sh\nprintf '%s\\n' '${python}'\n`;
        await writeFile(python, pythonScript, { mode: 0o700 });
        await writeFile(join(bin, 'uv'), uvScript, { mode: 0o700 });
        await chmod(python, 0o700);
        await chmod(join(bin, 'uv'), 0o700);
        const originalPath = process.env.PATH;
        process.env.PATH = bin;
        try {
            const service = new LocalVoiceService({ homeDir });
            const findPython = (service as unknown as { findPython: () => Promise<string> }).findPython.bind(service);
            expect(await findPython()).toBe(python);
            await service.shutdown();
        } finally {
            if (originalPath === undefined) delete process.env.PATH;
            else process.env.PATH = originalPath;
        }
    });
});
