import { db } from '@/storage/db';
import { decryptString, encryptString } from '@/modules/encrypt';
import { resolveVoiceTranscriptionApiKey, VoiceTranscriptionError } from './transcription';

export const VOICE_TRANSCRIPTION_TOKEN_VENDOR = 'happyherd-voice-openai';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

export type VoiceTranscriptionKeyStatus = {
    configured: boolean;
    source: 'user' | 'deployment' | null;
};

function encryptionPath(userId: string): string[] {
    return ['user', userId, 'voice', 'openai', 'api-key'];
}

export async function getVoiceTranscriptionKeyStatus(userId: string): Promise<VoiceTranscriptionKeyStatus> {
    const userToken = await db.serviceAccountToken.findUnique({
        where: { accountId_vendor: { accountId: userId, vendor: VOICE_TRANSCRIPTION_TOKEN_VENDOR } },
        select: { id: true },
    });
    if (userToken) {
        return { configured: true, source: 'user' };
    }
    if (resolveVoiceTranscriptionApiKey()) {
        return { configured: true, source: 'deployment' };
    }
    return { configured: false, source: null };
}

export async function resolveVoiceTranscriptionApiKeyForUser(userId: string): Promise<string | null> {
    const userToken = await db.serviceAccountToken.findUnique({
        where: { accountId_vendor: { accountId: userId, vendor: VOICE_TRANSCRIPTION_TOKEN_VENDOR } },
        select: { token: true },
    });
    if (userToken) {
        return decryptString(encryptionPath(userId), userToken.token);
    }
    return resolveVoiceTranscriptionApiKey();
}

export async function setVoiceTranscriptionApiKey(userId: string, apiKey: string): Promise<void> {
    const normalized = apiKey.trim();
    const encrypted = encryptString(encryptionPath(userId), normalized);
    await db.serviceAccountToken.upsert({
        where: { accountId_vendor: { accountId: userId, vendor: VOICE_TRANSCRIPTION_TOKEN_VENDOR } },
        update: { token: encrypted, updatedAt: new Date() },
        create: {
            accountId: userId,
            vendor: VOICE_TRANSCRIPTION_TOKEN_VENDOR,
            token: encrypted,
        },
    });
}

export async function removeVoiceTranscriptionApiKey(userId: string): Promise<void> {
    await db.serviceAccountToken.deleteMany({
        where: { accountId: userId, vendor: VOICE_TRANSCRIPTION_TOKEN_VENDOR },
    });
}

export async function testVoiceTranscriptionApiKey(
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
): Promise<void> {
    let response: Response;
    try {
        response = await fetchImpl(OPENAI_MODELS_URL, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
        });
    } catch {
        throw new VoiceTranscriptionError('Could not reach OpenAI to test this API key', 502);
    }
    if (response.status === 401 || response.status === 403) {
        throw new VoiceTranscriptionError('OpenAI rejected this API key', 400);
    }
    if (!response.ok) {
        throw new VoiceTranscriptionError(`OpenAI key test failed with status ${response.status}`, 502);
    }
}
