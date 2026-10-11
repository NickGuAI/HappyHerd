import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rm, stat, writeFile, rename } from 'node:fs/promises';
import { homedir, platform, arch } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
    LocalVoiceStatusSchema,
    VoiceInstallRequestSchema,
    VoiceOperationRequestSchema,
    VoiceReadRequestSchema,
    VoiceSpeakRequestSchema,
    VoiceTranscribeRequestSchema,
    VoiceUploadChunkRequestSchema,
    VoiceUploadStartRequestSchema,
    VOICE_RPC_METHODS,
    type LocalVoiceStatus,
    type VoiceFeature,
    type VoiceOperation,
    type VoiceReadResult,
} from '@happyherd/wire';
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';

const execFileAsync = promisify(execFile);
const MAX_RECORDING_BYTES = 32 * 1024 * 1024;
const MAX_UPLOAD_CHUNK_BYTES = 192 * 1024;
const MAX_READ_BYTES = 192 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const OPERATION_TTL_MS = 15 * 60 * 1000;
const STT_MODEL = 'mlx-community/Qwen3-ASR-0.6B-8bit';
const TTS_MODEL_URLS = {
    en: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2',
    zh: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2',
} as const;

const operationRootInitializations = new Map<string, Promise<void>>();

function initializeOperationRoot(root: string): Promise<void> {
    const existing = operationRootInitializations.get(root);
    if (existing) return existing;
    const initialization = (async () => {
        await mkdir(join(root, '..'), { recursive: true, mode: 0o700 });
        const staleRoot = `${root}.stale-${randomUUID()}`;
        try {
            await rename(root, staleRoot);
            void rm(staleRoot, { recursive: true, force: true }).catch(() => {});
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await mkdir(root, { recursive: true, mode: 0o700 });
    })().catch((error) => {
        operationRootInitializations.delete(root);
        throw error;
    });
    operationRootInitializations.set(root, initialization);
    void initialization.catch(() => {});
    return initialization;
}

type VoiceOperationRecord = VoiceOperation & {
    directory: string;
    updatedAt: number;
    upload?: { mimeType: string; byteLength: number; received: number; chunkDigests: Map<number, string> };
    uploadWriteTail: Promise<void>;
    audio: Buffer[];
    audioBytes: number;
    child?: ChildProcessWithoutNullStreams;
    task?: Promise<void>;
    cleanupTask?: Promise<void>;
    readPages: Map<number, { nextCursor: number; state: VoiceOperation['state']; error?: string }>;
};

export interface LocalVoiceServiceOptions {
    homeDir: string;
    platform?: NodeJS.Platform;
    architecture?: string;
    /** Only used by focused state-machine tests. */
    runInstall?: (feature: VoiceFeature, progress: (value: string) => void, signal: AbortSignal) => Promise<void>;
    runTranscription?: (audioPath: string, progress: (value: string) => void, signal: AbortSignal) => Promise<string>;
    runSpeech?: (text: string, language: 'en' | 'zh', onAudio: (wav: Buffer, sampleRate: number) => void, progress: (value: string) => void, signal: AbortSignal) => Promise<void>;
    now?: () => number;
    operationTtlMs?: number;
}

function operationView(operation: VoiceOperation): VoiceOperation {
    const { operationId, kind, state, error, text, progress } = operation;
    return { operationId, kind, state, ...(error ? { error } : {}), ...(text !== undefined ? { text } : {}), ...(progress ? { progress } : {}) };
}

function isCancelled(operation: VoiceOperation): boolean {
    return operation.state === 'cancelled';
}

function voicePlatform(options: LocalVoiceServiceOptions): NodeJS.Platform {
    return options.platform ?? platform();
}

function voiceArchitecture(options: LocalVoiceServiceOptions): string {
    return options.architecture ?? arch();
}

function supportsStt(options: LocalVoiceServiceOptions): boolean {
    return voicePlatform(options) === 'darwin' && voiceArchitecture(options) === 'arm64';
}

function supportsTts(options: LocalVoiceServiceOptions): boolean {
    const nativePackages: Partial<Record<NodeJS.Platform, readonly string[]>> = {
        darwin: ['arm64'],
        linux: ['x64'],
    };
    return nativePackages[voicePlatform(options)]?.includes(voiceArchitecture(options)) ?? false;
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 1000);
}

function minimalEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const home = process.env.HOME ?? homedir();
    return {
        HOME: home,
        PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin',
        TMPDIR: process.env.TMPDIR,
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        ...extra,
    };
}

function withPath(environment: NodeJS.ProcessEnv, path: string): NodeJS.ProcessEnv {
    return { ...environment, PATH: `${path}${delimiter}${environment.PATH ?? ''}` };
}

export class LocalVoiceService {
    private readonly root: string;
    private readonly now: () => number;
    private readonly operations = new Map<string, VoiceOperationRecord>();
    private readonly installByFeature = new Map<VoiceFeature, string>();
    private readonly installStartByFeature = new Map<VoiceFeature, Promise<VoiceOperation>>();
    private readonly featureErrors = new Map<VoiceFeature, string>();
    private readonly controllers = new Map<string, AbortController>();
    private runtimeInstallQueue: Promise<void> = Promise.resolve();
    private readonly sweepInterval: NodeJS.Timeout;
    private initialization?: Promise<void>;
    private expiring = false;
    private readonly options: LocalVoiceServiceOptions;

    constructor(options: LocalVoiceServiceOptions) {
        this.options = options;
        this.root = join(options.homeDir, 'local-voice');
        this.now = options.now ?? Date.now;
        this.sweepInterval = setInterval(() => { void this.expireOperations().catch(() => {}); }, 60_000);
        this.sweepInterval.unref?.();
    }

    private get toolsRoot(): string { return join(this.root, 'tools'); }
    private get sttRoot(): string { return join(this.root, 'stt'); }
    private get ttsRoot(): string { return join(this.root, 'tts'); }
    private get temporaryRoot(): string { return join(this.root, 'operations'); }
    private initializeOperations(): Promise<void> {
        this.initialization ??= initializeOperationRoot(this.temporaryRoot);
        return this.initialization;
    }
    private get sherpaNativeRoot(): string {
        const osName = voicePlatform(this.options) === 'win32' ? 'win' : voicePlatform(this.options);
        return join(this.toolsRoot, 'node_modules', `sherpa-onnx-${osName}-${voiceArchitecture(this.options)}`);
    }

    async status(): Promise<LocalVoiceStatus> {
        // The UI polls status while an install is active. That request is
        // client activity for install operations only; engine progress does
        // not extend the lifetime of inference output.
        for (const operationId of this.installByFeature.values()) {
            const operation = this.operations.get(operationId);
            if (operation && (operation.state === 'pending' || operation.state === 'running')) this.touch(operation);
        }
        const state = async (feature: VoiceFeature): Promise<LocalVoiceStatus['stt']> => {
            const inProgress = this.installByFeature.get(feature) || this.installStartByFeature.has(feature);
            if (inProgress) return { state: 'installing' };
            if (!(feature === 'stt' ? supportsStt(this.options) : supportsTts(this.options))) {
                return { state: 'unsupported', error: feature === 'stt'
                    ? 'Local speech recognition currently requires an Apple Silicon Mac'
                    : 'This machine platform is not supported by the local speech runtime' };
            }
            if (await this.isInstalled(feature)) return { state: 'ready' };
            const error = this.featureErrors.get(feature);
            return error ? { state: 'failed', error } : { state: 'not-installed' };
        };
        return LocalVoiceStatusSchema.parse({ stt: await state('stt'), tts: await state('tts') });
    }

    async install(params: unknown): Promise<VoiceOperation> {
        const { feature } = VoiceInstallRequestSchema.parse(params);
        const supported = feature === 'stt' ? supportsStt(this.options) : supportsTts(this.options);
        if (!supported) throw new Error(feature === 'stt'
            ? 'Qwen3-ASR requires an Apple Silicon Mac'
            : 'This machine platform is not supported by the local speech runtime');
        const current = this.installByFeature.get(feature);
        if (current) return this.requireOperation(current);
        const starting = this.installStartByFeature.get(feature);
        if (starting) return starting;
        const start = this.startInstall(feature);
        this.installStartByFeature.set(feature, start);
        try { return await start; }
        finally { if (this.installStartByFeature.get(feature) === start) this.installStartByFeature.delete(feature); }
    }

    private async startInstall(feature: VoiceFeature): Promise<VoiceOperation> {
        const op = await this.createOperation('install');
        this.installByFeature.set(feature, op.operationId);
        this.featureErrors.delete(feature);
        op.task = this.run(op, async (report, signal) => {
            try {
                if (this.options.runInstall) await this.options.runInstall(feature, report, signal);
                else await this.installFeature(feature, report, signal);
                this.featureErrors.delete(feature);
            } finally {
                if (this.installByFeature.get(feature) === op.operationId) this.installByFeature.delete(feature);
            }
        }, feature);
        return operationView(op);
    }

    async uploadStart(params: unknown): Promise<{ operationId: string; nextOffset: number }> {
        const request = VoiceUploadStartRequestSchema.parse(params);
        if (request.byteLength > MAX_RECORDING_BYTES) throw new Error('Recording exceeds the 32 MiB limit');
        if ((await this.status()).stt.state !== 'ready') throw new Error('Local speech recognition is not ready on this machine');
        const op = await this.createOperation('transcribe');
        const uploadDirectory = join(op.directory, 'upload');
        await mkdir(uploadDirectory, { recursive: true });
        op.upload = { mimeType: request.mimeType, byteLength: request.byteLength, received: 0, chunkDigests: new Map() };
        return { operationId: op.operationId, nextOffset: 0 };
    }

    async uploadChunk(params: unknown): Promise<{ nextOffset: number }> {
        const request = VoiceUploadChunkRequestSchema.parse(params);
        const op = this.requireRecord(request.operationId);
        if (op.kind !== 'transcribe') throw new Error('Operation is not a recording upload');
        return this.serializeUploadWrite(op, async () => {
            this.touch(op);
            const upload = op.upload;
            if (!upload || op.state !== 'pending' || this.operations.get(op.operationId) !== op) throw new Error('Recording upload is no longer available');
            const data = Buffer.from(request.audioBase64, 'base64');
            if (data.length === 0 || data.length > MAX_UPLOAD_CHUNK_BYTES) throw new Error('Recording chunks must be between 1 byte and 192 KiB');
            if (request.offset < upload.received) {
                const digest = upload.chunkDigests.get(request.offset);
                const repeatedDigest = createHash('sha256').update(data).digest('hex');
                if (digest === repeatedDigest) return { nextOffset: upload.received };
                throw new Error('Recording upload retry differs from bytes already written');
            }
            if (request.offset !== upload.received) throw new Error(`Recording upload expected offset ${upload.received}`);
            if (upload.received + data.length > upload.byteLength) throw new Error('Recording exceeds its declared byte length');
            const file = join(op.directory, 'recording.input');
            const handle = await open(file, upload.received === 0 ? 'w' : 'a', 0o600);
            try {
                if (op.state !== 'pending' || this.operations.get(op.operationId) !== op) throw new Error('Recording upload is no longer available');
                await handle.write(data);
            } finally { await handle.close(); }
            if (op.state !== 'pending' || this.operations.get(op.operationId) !== op) throw new Error('Recording upload is no longer available');
            upload.received += data.length;
            upload.chunkDigests.set(request.offset, createHash('sha256').update(data).digest('hex'));
            return { nextOffset: upload.received };
        });
    }

    async transcribe(params: unknown): Promise<VoiceOperation> {
        const { operationId } = VoiceTranscribeRequestSchema.parse(params);
        const op = this.requireRecord(operationId);
        if (op.kind !== 'transcribe') throw new Error('Operation is not a transcription');
        this.touch(op);
        if (op.kind !== 'transcribe' || !op.upload) throw new Error('No recording upload exists for this operation');
        if (op.state !== 'pending') return operationView(op);
        await op.uploadWriteTail;
        if (op.state !== 'pending' || this.operations.get(op.operationId) !== op) return operationView(op);
        if (op.upload.received !== op.upload.byteLength) throw new Error('Recording upload is incomplete');
        if ((await this.status()).stt.state !== 'ready') throw new Error('Local speech recognition is not ready on this machine');
        if (op.state !== 'pending' || this.operations.get(op.operationId) !== op) return operationView(op);
        const audioPath = join(op.directory, 'recording.input');
        op.task = this.run(op, async (report, signal) => {
            const transcript = this.options.runTranscription
                ? await this.options.runTranscription(audioPath, report, signal)
                : await this.transcribeAudio(audioPath, op.upload!.mimeType, report, signal);
            op.text = transcript.trim();
            await rm(audioPath, { force: true });
        }, 'stt');
        return operationView(op);
    }

    async speak(params: unknown): Promise<VoiceOperation> {
        const { text } = VoiceSpeakRequestSchema.parse(params);
        if ((await this.status()).tts.state !== 'ready') throw new Error('Local speech playback is not ready on this machine');
        const op = await this.createOperation('speak');
        const language = this.dominantLanguage(text);
        op.task = this.run(op, (report, signal) => this.options.runSpeech
            ? this.options.runSpeech(text, language, (wav, sampleRate) => this.appendWav(op, wav, sampleRate), report, signal)
            : this.synthesize(text, language, op, report, signal));
        return operationView(op);
    }

    async operation(params: unknown): Promise<VoiceOperation> {
        const { operationId } = VoiceOperationRequestSchema.parse(params);
        const op = this.requireRecord(operationId);
        this.touch(op);
        return operationView(op);
    }

    async read(params: unknown): Promise<VoiceReadResult> {
        const { operationId, cursor } = VoiceReadRequestSchema.parse(params);
        const op = this.requireRecord(operationId);
        this.touch(op);
        if (op.kind !== 'speak') throw new Error('Audio is only available for speech operations');
        if (cursor > op.audio.length) throw new Error('Audio cursor is past the end of the generated audio');
        const cachedPage = op.readPages.get(cursor);
        if (cachedPage) return this.readPage(op, cursor, cachedPage);
        const chunks: VoiceReadResult['chunks'] = [];
        let bytes = 0;
        let nextCursor = cursor;
        while (nextCursor < op.audio.length) {
            const audio = op.audio[nextCursor]!;
            if (bytes > 0 && bytes + audio.length > MAX_READ_BYTES) break;
            bytes += audio.length;
            chunks.push({ index: nextCursor, audioBase64: audio.toString('base64'), mimeType: 'audio/wav', sampleRate: this.sampleRate(audio) });
            nextCursor += 1;
        }
        const page = { nextCursor, state: op.state, ...(op.error ? { error: op.error } : {}) };
        if (chunks.length > 0 || op.state === 'done' || op.state === 'error' || op.state === 'cancelled') op.readPages.set(cursor, page);
        return this.readPage(op, cursor, page);
    }

    async cancel(params: unknown): Promise<{ ok: true }> {
        const { operationId } = VoiceOperationRequestSchema.parse(params);
        const op = this.operations.get(operationId);
        if (!op) return { ok: true };
        if (op.state === 'pending' || op.state === 'running') {
            op.state = 'cancelled';
            op.progress = undefined;
            this.controllers.get(operationId)?.abort();
            op.child?.kill('SIGTERM');
        }
        op.audio = [];
        op.audioBytes = 0;
        op.readPages.clear();
        this.touch(op);
        this.scheduleDirectoryCleanup(op);
        return { ok: true };
    }

    async release(params: unknown): Promise<{ ok: true }> {
        const { operationId } = VoiceOperationRequestSchema.parse(params);
        const op = this.operations.get(operationId);
        if (!op) return { ok: true };
        if (op.state === 'pending' || op.state === 'running') throw new Error('Cancel the active voice operation before releasing it');
        this.removeOperation(op);
        return { ok: true };
    }

    register(manager: RpcHandlerManager): () => Promise<void> {
        manager.registerHandler(VOICE_RPC_METHODS.status, () => this.status());
        manager.registerHandler(VOICE_RPC_METHODS.install, (params) => this.install(params));
        manager.registerHandler(VOICE_RPC_METHODS.uploadStart, (params) => this.uploadStart(params));
        manager.registerHandler(VOICE_RPC_METHODS.uploadChunk, (params) => this.uploadChunk(params));
        manager.registerHandler(VOICE_RPC_METHODS.transcribe, (params) => this.transcribe(params));
        manager.registerHandler(VOICE_RPC_METHODS.speak, (params) => this.speak(params));
        manager.registerHandler(VOICE_RPC_METHODS.operation, (params) => this.operation(params));
        manager.registerHandler(VOICE_RPC_METHODS.read, (params) => this.read(params));
        manager.registerHandler(VOICE_RPC_METHODS.cancel, (params) => this.cancel(params));
        manager.registerHandler(VOICE_RPC_METHODS.release, (params) => this.release(params));
        return async () => { await this.shutdown(); };
    }

    async shutdown(): Promise<void> {
        clearInterval(this.sweepInterval);
        await this.initialization;
        await Promise.all([...this.operations.values()].map(async (op) => {
            if (op.state === 'pending' || op.state === 'running') {
                this.controllers.get(op.operationId)?.abort();
                op.child?.kill('SIGTERM');
                op.state = 'cancelled';
            }
            await op.uploadWriteTail.catch(() => {});
            await op.task;
            this.removeOperation(op);
            await op.cleanupTask;
        }));
    }

    private async createOperation(kind: VoiceOperation['kind']): Promise<VoiceOperationRecord> {
        await this.initializeOperations();
        await mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 });
        const operationId = randomUUID();
        const directory = join(this.temporaryRoot, operationId);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const op: VoiceOperationRecord = {
            operationId, kind, state: 'pending', progress: 'Starting', directory,
            updatedAt: this.now(), uploadWriteTail: Promise.resolve(), audio: [], audioBytes: 0, readPages: new Map(),
        };
        this.operations.set(operationId, op);
        return op;
    }

    private requireRecord(id: string): VoiceOperationRecord {
        const op = this.operations.get(id);
        if (!op) throw new Error('Voice operation expired or was released');
        return op;
    }

    private readPage(op: VoiceOperationRecord, cursor: number, page: { nextCursor: number; state: VoiceOperation['state']; error?: string }): VoiceReadResult {
        const chunks: VoiceReadResult['chunks'] = [];
        let bytes = 0;
        for (let index = cursor; index < page.nextCursor; index += 1) {
            const audio = op.audio[index];
            if (!audio) break;
            bytes += audio.length;
            chunks.push({ index, audioBase64: audio.toString('base64'), mimeType: 'audio/wav', sampleRate: this.sampleRate(audio) });
        }
        if (bytes > MAX_READ_BYTES) throw new Error('Cached voice audio page exceeds the RPC read limit');
        return { state: page.state, nextCursor: page.nextCursor, chunks, ...(page.error ? { error: page.error } : {}) };
    }

    private requireOperation(id: string): VoiceOperation { return operationView(this.requireRecord(id)); }
    private touch(op: VoiceOperationRecord): void { op.updatedAt = this.now(); }

    private serializeUploadWrite<T>(op: VoiceOperationRecord, write: () => Promise<T>): Promise<T> {
        const task = op.uploadWriteTail.then(write, write);
        op.uploadWriteTail = task.then(() => undefined, () => undefined);
        return task;
    }

    private async run(op: VoiceOperationRecord, work: (progress: (value: string) => void, signal: AbortSignal) => Promise<void>, feature?: VoiceFeature): Promise<void> {
        const controller = new AbortController();
        this.controllers.set(op.operationId, controller);
        op.state = 'running';
        op.progress = 'Preparing local engine';
        try {
            await work((progress) => {
                if (op.state === 'running') op.progress = progress.slice(0, 300);
            }, controller.signal);
            if (op.state === 'running') { op.state = 'done'; op.progress = undefined; }
        } catch (error) {
            if (!isCancelled(op)) {
                op.state = 'error';
                op.error = safeError(error);
                op.progress = undefined;
                if (feature) this.featureErrors.set(feature, op.error);
            }
        } finally {
            if (op.child && op.child.exitCode === null) op.child.kill('SIGTERM');
            op.child = undefined;
            this.controllers.delete(op.operationId);
        }
    }

    private async expireOperations(): Promise<void> {
        if (this.expiring) return;
        this.expiring = true;
        const threshold = this.now() - (this.options.operationTtlMs ?? OPERATION_TTL_MS);
        try {
            for (const op of this.operations.values()) {
                if (op.updatedAt < threshold) {
                    if (op.state === 'pending' || op.state === 'running') op.state = 'cancelled';
                    this.controllers.get(op.operationId)?.abort();
                    op.child?.kill('SIGTERM');
                    op.audio = [];
                    op.audioBytes = 0;
                    op.readPages.clear();
                    this.removeOperation(op);
                }
            }
        } finally {
            this.expiring = false;
        }
    }

    private removeOperation(op: VoiceOperationRecord): void {
        this.operations.delete(op.operationId);
        for (const [feature, id] of this.installByFeature) if (id === op.operationId) this.installByFeature.delete(feature);
        op.audio = [];
        op.audioBytes = 0;
        op.readPages.clear();
        this.scheduleDirectoryCleanup(op);
    }

    private scheduleDirectoryCleanup(op: VoiceOperationRecord): void {
        if (op.cleanupTask) return;
        op.cleanupTask = (async () => {
            await op.uploadWriteTail.catch(() => {});
            await op.task;
            await rm(op.directory, { recursive: true, force: true });
        })().catch(() => {}).finally(() => { op.cleanupTask = undefined; });
    }

    private async isInstalled(feature: VoiceFeature): Promise<boolean> {
        try {
            if (feature === 'stt') {
                await stat(join(this.sttRoot, 'venv', 'bin', 'python'));
                await stat(join(this.sttRoot, 'ready.json'));
                await stat(join(this.toolsRoot, 'node_modules', 'ffmpeg-static', 'package.json'));
                return true;
            }
            for (const language of ['en', 'zh'] as const) {
                if (!await this.hasTtsModelAssets(join(this.ttsRoot, language), language)) return false;
            }
            await stat(join(this.toolsRoot, 'node_modules', 'sherpa-onnx-node', 'package.json'));
            await stat(join(this.sherpaNativeRoot, 'sherpa-onnx.node'));
            return true;
        } catch { return false; }
    }

    private async installFeature(feature: VoiceFeature, report: (value: string) => void, signal: AbortSignal): Promise<void> {
        await mkdir(this.root, { recursive: true });
        await this.installDecoder(report, signal, feature === 'tts');
        if (feature === 'stt') {
            if (!supportsStt(this.options)) throw new Error('Qwen3-ASR requires an Apple Silicon Mac');
            const py = join(this.sttRoot, 'venv', 'bin', 'python');
            await mkdir(this.sttRoot, { recursive: true });
            report('Preparing Python environment');
            const python = await this.findPython();
            await this.exec(python, ['-m', 'venv', join(this.sttRoot, 'venv')], this.voiceEnvironment(), signal);
            report('Installing mlx-audio 0.5.8');
            await this.exec(py, ['-m', 'pip', 'install', '--disable-pip-version-check', 'mlx-audio==0.5.8'], this.voiceEnvironment(), signal);
            report('Downloading Qwen3-ASR model');
            await this.exec(py, ['-c', 'from mlx_audio.stt.utils import load_model; load_model("mlx-community/Qwen3-ASR-0.6B-8bit")'], this.voiceEnvironment(), signal);
            await writeFile(join(this.sttRoot, 'ready.json'), JSON.stringify({ runtime: 'mlx-audio', version: '0.5.8', model: STT_MODEL }));
            return;
        }

        await mkdir(join(this.ttsRoot, 'models'), { recursive: true });
        await this.installTtsRuntime(report, signal);
        if (!await this.hasTtsRuntime()) throw new Error('The installed local speech engine is missing its native runtime files');
        for (const language of ['en', 'zh'] as const) {
            const modelDirectory = join(this.ttsRoot, language);
            if (await this.hasTtsModelAssets(modelDirectory, language)) continue;
            report(`Downloading Kokoro ${language === 'en' ? 'English v1.0' : 'Chinese v1.1'} model`);
            const stagingDirectory = join(this.ttsRoot, `${language}.installing`);
            await rm(stagingDirectory, { recursive: true, force: true });
            await mkdir(stagingDirectory, { recursive: true });
            try {
                await this.downloadAndExtract(TTS_MODEL_URLS[language], stagingDirectory, signal);
                const nested = join(stagingDirectory, language === 'en' ? 'kokoro-multi-lang-v1_0' : 'kokoro-multi-lang-v1_1');
                if (await this.pathExists(join(nested, 'model.onnx'))) {
                    for (const entry of await readdir(nested)) await rename(join(nested, entry), join(stagingDirectory, entry));
                    await rm(nested, { recursive: true, force: true });
                }
                if (!await this.hasTtsModelAssets(stagingDirectory, language)) throw new Error(`Kokoro ${language} model archive is incomplete`);
                await rm(modelDirectory, { recursive: true, force: true });
                await rename(stagingDirectory, modelDirectory);
            } catch (error) {
                await rm(stagingDirectory, { recursive: true, force: true });
                throw error;
            }
        }
    }

    private async installDecoder(report: (value: string) => void, signal: AbortSignal, includeTts: boolean): Promise<void> {
        const ffmpeg = join(this.toolsRoot, 'node_modules', 'ffmpeg-static', 'package.json');
        if (await this.pathExists(ffmpeg) && (!includeTts || await this.hasTtsRuntime())) return;
        await mkdir(this.toolsRoot, { recursive: true });
        report('Installing local audio runtime');
        const install = this.runtimeInstallQueue.then(async () => {
            if (signal.aborted) throw new Error('Local voice operation was cancelled');
            const hasFfmpeg = await this.pathExists(ffmpeg);
            const hasSherpa = !includeTts || await this.hasTtsRuntime();
            if (hasFfmpeg && hasSherpa) return;
            const packages = ['ffmpeg-static@5.2.0'];
            if (includeTts) packages.push('sherpa-onnx-node@1.13.8');
            await this.exec('npm', ['install', '--prefix', this.toolsRoot, '--no-save', '--no-package-lock', ...packages], this.voiceEnvironment(), signal);
        });
        this.runtimeInstallQueue = install.catch(() => {});
        await install;
    }

    private async installTtsRuntime(report: (value: string) => void, signal: AbortSignal): Promise<void> {
        await this.installDecoder(report, signal, true);
    }

    private async hasTtsRuntime(): Promise<boolean> {
        return await this.pathExists(join(this.toolsRoot, 'node_modules', 'sherpa-onnx-node', 'package.json'))
            && await this.pathExists(join(this.sherpaNativeRoot, 'sherpa-onnx.node'));
    }

    private async hasTtsModelAssets(directory: string, language: 'en' | 'zh'): Promise<boolean> {
        try {
            for (const file of ['model.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'lexicon-zh.txt']) {
                const item = await stat(join(directory, file));
                if (!item.isFile() || item.size === 0) return false;
            }
            if (language === 'zh') {
                for (const file of ['date-zh.fst', 'phone-zh.fst', 'number-zh.fst']) {
                    const item = await stat(join(directory, file));
                    if (!item.isFile() || item.size === 0) return false;
                }
            }
            for (const folder of ['dict', 'espeak-ng-data']) {
                const item = await stat(join(directory, folder));
                if (!item.isDirectory()) return false;
            }
            return true;
        } catch { return false; }
    }

    private async installDecoderForUse(): Promise<string> {
        const require = createRequire(join(this.toolsRoot, 'runtime.cjs'));
        const ffmpeg = require('ffmpeg-static') as string | null;
        if (ffmpeg) return ffmpeg;
        throw new Error('Could not locate the installed local audio decoder');
    }

    private voiceEnvironment(): NodeJS.ProcessEnv {
        const dynamicLibraryVariable = platform() === 'darwin' ? 'DYLD_LIBRARY_PATH' : platform() === 'linux' ? 'LD_LIBRARY_PATH' : undefined;
        const inheritedLibraryPath = dynamicLibraryVariable ? process.env[dynamicLibraryVariable] : undefined;
        const environment = minimalEnvironment({
            HF_HOME: join(this.sttRoot, 'huggingface'),
            PYTHONUNBUFFERED: '1',
            ...(dynamicLibraryVariable ? { [dynamicLibraryVariable]: [this.sherpaNativeRoot, inheritedLibraryPath].filter(Boolean).join(delimiter) } : {}),
        });
        return withPath(environment, this.toolsRoot);
    }

    private async findPython(): Promise<string> {
        for (const candidate of ['python3.12', 'python3.11', 'python3.10', 'python3']) {
            try {
                const { stdout, stderr } = await execFileAsync(candidate, ['--version'], { timeout: 2000, env: minimalEnvironment() });
                const version = `${stdout}${stderr}`.match(/Python (\d+)\.(\d+)/);
                if (version && Number(version[1]) === 3 && Number(version[2]) >= 10) return candidate;
            } catch { /* Try the next supported Python command. */ }
        }
        try {
            const { stdout } = await execFileAsync('uv', ['python', 'find', '--no-project', '>=3.10'], { timeout: 5000, env: minimalEnvironment() });
            const candidate = stdout.trim();
            if (candidate) {
                const { stdout: versionOutput, stderr } = await execFileAsync(candidate, ['--version'], { timeout: 2000, env: minimalEnvironment() });
                const version = `${versionOutput}${stderr}`.match(/Python (\d+)\.(\d+)/);
                if (version && Number(version[1]) === 3 && Number(version[2]) >= 10) return candidate;
            }
        } catch { /* uv is optional; preserve the actionable missing-Python error below. */ }
        throw new Error('Python 3.10 or newer is required for local speech recognition');
    }

    private async transcribeAudio(inputPath: string, mimeType: string, report: (value: string) => void, signal: AbortSignal): Promise<string> {
        const wavPath = join(inputPath, '..', 'recording.wav');
        const textPath = `${wavPath}.transcript.txt`;
        try {
            report('Converting recording to 16 kHz mono audio');
            const ffmpeg = await this.installDecoderForUse();
            await this.exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath], this.voiceEnvironment(), signal);
            const python = join(this.sttRoot, 'venv', 'bin', 'python');
            report('Transcribing with Qwen3-ASR');
            const code = [
                'import json,sys',
                'from mlx_audio.stt.utils import load_model',
                'from mlx_audio.stt.generate import generate_transcription',
                'model=load_model(sys.argv[1])',
                'result=generate_transcription(model=model,audio=sys.argv[2],output_path=sys.argv[2]+".transcript",format="txt",system_prompt="Preserve proper-noun spelling: HappyHerd, Pioneerminds, S3.")',
                'print(json.dumps({"text":result.text},ensure_ascii=False))',
            ].join('; ');
            const { stdout } = await this.exec(python, ['-c', code, STT_MODEL, wavPath], this.voiceEnvironment(), signal);
            const lines = stdout.trim().split(/\r?\n/);
            const response = JSON.parse(lines.at(-1) ?? '{}') as { text?: unknown };
            if (typeof response.text !== 'string' || !response.text.trim()) throw new Error('Qwen3-ASR returned no transcript');
            return response.text;
        } finally {
            await Promise.all([rm(wavPath, { force: true }), rm(textPath, { force: true })]);
        }
    }

    private async synthesize(text: string, language: 'en' | 'zh', op: VoiceOperationRecord, report: (value: string) => void, signal: AbortSignal): Promise<void> {
        report('Loading local Kokoro voice');
        const pythonScript = join(op.directory, 'tts-worker.cjs');
        const workerSource = this.ttsWorkerSource();
        await writeFile(pythonScript, workerSource, { mode: 0o600 });
        const child = spawn(process.execPath, [pythonScript], { cwd: op.directory, env: this.voiceEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
        op.child = child;
        child.stdin.end(JSON.stringify({
            modulePath: join(this.toolsRoot, 'node_modules', 'sherpa-onnx-node'),
            modelDirectory: join(this.ttsRoot, language), language, text,
        }));
        let pending = Buffer.alloc(0);
        let stderr = '';
        let streamError: Error | undefined;
        child.stderr.on('data', (data: Buffer) => { if (stderr.length < 3000) stderr += data.toString(); });
        child.stdout.on('data', (data: Buffer) => {
            if (streamError) return;
            pending = Buffer.concat([pending, data]);
            while (pending.length >= 4) {
                const length = pending.readUInt32LE(0);
                if (length <= 0 || length > MAX_READ_BYTES - 1) {
                    streamError = new Error('Local speech engine emitted an invalid audio frame');
                    pending = Buffer.alloc(0);
                    child.kill('SIGTERM');
                    break;
                }
                if (pending.length < 4 + length) break;
                const wav = pending.subarray(4, 4 + length);
                try {
                    this.appendWav(op, Buffer.from(wav), this.sampleRate(wav));
                } catch (error) {
                    streamError = error instanceof Error ? error : new Error(String(error));
                    pending = Buffer.alloc(0);
                    child.kill('SIGTERM');
                    break;
                }
                pending = pending.subarray(4 + length);
            }
        });
        await new Promise<void>((resolve, reject) => {
            let killTimeout: NodeJS.Timeout | undefined;
            let settled = false;
            const cleanup = () => {
                signal.removeEventListener('abort', abort);
                if (killTimeout) clearTimeout(killTimeout);
            };
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback();
            };
            const abort = () => {
                child.kill('SIGTERM');
                killTimeout = setTimeout(() => {
                    if (child.exitCode === null) child.kill('SIGKILL');
                }, 3_000);
                killTimeout.unref?.();
            };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
            child.once('error', (error) => finish(() => reject(error)));
            child.once('close', (code) => {
                finish(() => {
                    if (signal.aborted) return reject(new Error('Speech generation was cancelled'));
                    if (streamError) return reject(streamError);
                    if (code === 0 && pending.length === 0) return resolve();
                    return reject(new Error(stderr.trim() || `Local speech engine exited with code ${code}`));
                });
            });
        });
    }

    private ttsWorkerSource(): string {
        return `const { createRequire } = require('node:module');
const input = [];
process.stdin.on('data', b => input.push(b));
process.stdin.on('end', async () => {
 try {
  const { modulePath, modelDirectory, language, text } = JSON.parse(Buffer.concat(input).toString('utf8'));
  const sherpa = createRequire(require('node:path').join(modulePath, 'package.json'))('sherpa-onnx-node');
  const model = language === 'zh' ? 'kokoro-multi-lang-v1_1' : 'kokoro-multi-lang-v1_0';
  const dir = require('node:path').join(modelDirectory, model);
  const modelDir = await require('node:fs/promises').access(require('node:path').join(modelDirectory, 'model.onnx')).then(() => modelDirectory).catch(() => dir);
  const dictDir = require('node:path').join(modelDir, 'dict');
  const fs = require('node:fs');
  const rules = ['date-zh.fst','phone-zh.fst','number-zh.fst'].map(x => require('node:path').join(modelDir,x)).filter(fs.existsSync).join(',');
  const tts = await sherpa.OfflineTts.createAsync({ model: { kokoro: { model: require('node:path').join(modelDir,'model.onnx'), voices: require('node:path').join(modelDir,'voices.bin'), tokens: require('node:path').join(modelDir,'tokens.txt'), dataDir: require('node:path').join(modelDir,'espeak-ng-data'), dictDir, lexicon: require('node:path').join(modelDir,'lexicon-us-en.txt') + ',' + require('node:path').join(modelDir,'lexicon-zh.txt'), lang: language === 'zh' ? 'cmn' : 'en-us' }, numThreads: 2, debug: false }, ruleFsts: rules, maxNumSentences: 1 });
  const sid = language === 'zh' ? 63 : 3;
  const audio = await tts.generateAsync({ text, sid, speed: 1.0, onProgress: ({ samples, progress }) => {
    const frameSamples = Math.floor((MAX_FRAME - 44) / 2);
    for (let start = 0; start < samples.length; start += frameSamples) {
      const end = Math.min(start + frameSamples, samples.length);
      const frame = wav(samples, tts.sampleRate, start, end);
      const len = Buffer.alloc(4); len.writeUInt32LE(frame.length);
      process.stdout.write(Buffer.concat([len, frame]));
    }
    return 1;
  }});
  if (!audio.samples.length) throw new Error('Kokoro returned no audio');
  process.exitCode = 0;
 } catch (e) { process.stderr.write(String(e && e.stack || e)); process.exitCode = 1; }
});
const MAX_FRAME = ${MAX_READ_BYTES - 1};
function wav(samples, rate, start, end) {
 const count=end-start, out=Buffer.allocUnsafe(44+count*2); out.write('RIFF',0); out.writeUInt32LE(36+count*2,4); out.write('WAVEfmt ',8); out.writeUInt32LE(16,16); out.writeUInt16LE(1,20); out.writeUInt16LE(1,22); out.writeUInt32LE(rate,24); out.writeUInt32LE(rate*2,28); out.writeUInt16LE(2,32); out.writeUInt16LE(16,34); out.write('data',36); out.writeUInt32LE(count*2,40);
 for(let i=0;i<count;i++){const s=Math.max(-1,Math.min(1,samples[start+i]||0)); out.writeInt16LE(s<0?Math.round(s*32768):Math.round(s*32767),44+i*2);} return out;
}`;
    }

    private appendWav(op: VoiceOperationRecord, wav: Buffer, sampleRate: number): void {
        if (op.state !== 'running') return;
        if (wav.length > MAX_READ_BYTES - 1) throw new Error('Speech audio chunk exceeded the RPC read limit');
        if (op.audioBytes + wav.length > MAX_OUTPUT_BYTES) throw new Error('Speech output exceeded the 128 MiB limit');
        if (this.sampleRate(wav) !== sampleRate) throw new Error('Speech chunk sample rate does not match its WAV header');
        op.audio.push(wav);
        op.audioBytes += wav.length;
    }

    private sampleRate(wav: Buffer): number {
        return wav.length >= 28 && wav.subarray(0, 4).toString() === 'RIFF' ? wav.readUInt32LE(24) : 24_000;
    }

    private dominantLanguage(text: string): 'en' | 'zh' {
        const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
        const latinWords = (text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []).length;
        return chinese > latinWords ? 'zh' : 'en';
    }

    private async exec(command: string, args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
        if (signal?.aborted) throw new Error('Local voice operation was cancelled');
        const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (part: Buffer) => { if (stdout.length < 1024 * 1024) stdout += part.toString(); });
        child.stderr.on('data', (part: Buffer) => { if (stderr.length < 5000) stderr += part.toString(); });
        await new Promise<void>((resolve, reject) => {
            let killTimeout: NodeJS.Timeout | undefined;
            let settled = false;
            const cleanup = () => {
                signal?.removeEventListener('abort', abort);
                if (killTimeout) clearTimeout(killTimeout);
            };
            const finish = (callback: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback();
            };
            const abort = () => {
                child.kill('SIGTERM');
                killTimeout = setTimeout(() => {
                    if (child.exitCode === null) child.kill('SIGKILL');
                }, 3_000);
                killTimeout.unref?.();
            };
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            child.once('error', (error) => finish(() => reject(error)));
            child.once('close', (code) => {
                finish(() => {
                    if (signal?.aborted) return reject(new Error('Local voice operation was cancelled'));
                    if (code === 0) return resolve();
                    return reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
                });
            });
        });
        return { stdout, stderr };
    }

    private async downloadAndExtract(url: string, destination: string, signal: AbortSignal): Promise<void> {
        const response = await fetch(url, { signal });
        if (!response.ok || !response.body) throw new Error(`Could not download the Kokoro model (${response.status})`);
        const archivePath = join(destination, 'model.tar.bz2');
        const file = await open(archivePath, 'w', 0o600);
        try {
            const reader = response.body.getReader();
            while (true) {
                if (signal.aborted) throw new Error('Model download was cancelled');
                const { done, value } = await reader.read();
                if (done) break;
                await file.write(value);
            }
        } finally { await file.close(); }
        try {
            await this.exec('tar', ['-xjf', archivePath, '-C', destination], this.voiceEnvironment(), signal);
        } finally { await rm(archivePath, { force: true }); }
    }

    private async pathExists(path: string): Promise<boolean> {
        try { await stat(path); return true; } catch { return false; }
    }
}
