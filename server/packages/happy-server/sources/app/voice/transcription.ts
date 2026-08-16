import { readFileSync } from 'node:fs';

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 15 * 1024 * 1024;
export const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

const MIME_EXTENSIONS: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
    'audio/caf': 'caf',
};

export class VoiceTranscriptionError extends Error {
    constructor(message: string, readonly statusCode = 500) {
        super(message);
        this.name = 'VoiceTranscriptionError';
    }
}

export function resolveVoiceTranscriptionApiKey(
    env: NodeJS.ProcessEnv = process.env,
    readFile: typeof readFileSync = readFileSync,
): string | null {
    const directKey = env.OPENAI_API_KEY?.trim();
    if (directKey) return directKey;
    const keyFile = env.OPENAI_API_KEY_FILE?.trim();
    if (!keyFile) return null;
    try {
        return readFile(keyFile, 'utf8').trim() || null;
    } catch {
        return null;
    }
}

export function normalizeAudioMimeType(value: string): string {
    const mimeType = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (!MIME_EXTENSIONS[mimeType]) {
        throw new VoiceTranscriptionError(`Unsupported audio type: ${mimeType || 'unknown'}`, 400);
    }
    return mimeType;
}

export function decodeTranscriptionAudio(audioBase64: string): Buffer {
    if (!audioBase64) {
        throw new VoiceTranscriptionError('Audio payload is empty', 400);
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64) || audioBase64.length % 4 !== 0) {
        throw new VoiceTranscriptionError('Audio payload is not valid base64', 400);
    }
    const audio = Buffer.from(audioBase64, 'base64');
    if (audio.length === 0) {
        throw new VoiceTranscriptionError('Audio payload is empty', 400);
    }
    if (audio.length > MAX_TRANSCRIPTION_AUDIO_BYTES) {
        throw new VoiceTranscriptionError('Audio payload is larger than 15 MiB', 413);
    }
    return audio;
}

export async function transcribeVoiceInput(options: {
    audioBase64: string;
    mimeType: string;
    language?: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
}): Promise<string> {
    const mimeType = normalizeAudioMimeType(options.mimeType);
    const audio = decodeTranscriptionAudio(options.audioBase64);
    const extension = MIME_EXTENSIONS[mimeType];
    const body = new FormData();
    body.set('file', new Blob([audio], { type: mimeType }), `happyherd-dictation.${extension}`);
    body.set('model', DEFAULT_TRANSCRIPTION_MODEL);
    body.set('language', options.language?.trim() || 'en');
    body.set('prompt', [
        'Transcribe the speaker for HappyHerd coding-agent command input.',
        'Preserve proper nouns and technical terms such as Claude Code, Codex, OpenCode, HappyHerd, GitHub, TypeScript, and Kubernetes.',
        'Apply punctuation and capitalization, but do not add facts, labels, or explanations.',
    ].join(' '));
    body.set('response_format', 'json');

    const response = await (options.fetchImpl ?? fetch)(OPENAI_TRANSCRIPTION_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        // The app workspace contributes React Native's narrower FormData type
        // to the shared TS program; Node's fetch accepts this runtime object.
        body: body as any,
    });
    if (!response.ok) {
        throw new VoiceTranscriptionError(`Transcription provider failed with status ${response.status}`, 502);
    }
    const payload = await response.json() as { text?: unknown };
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) {
        throw new VoiceTranscriptionError('Transcription provider returned no text', 502);
    }
    return text;
}
