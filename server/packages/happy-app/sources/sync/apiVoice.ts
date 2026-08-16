import {
    VoiceConversationResponseSchema,
    VoiceUsageResponseSchema,
    type VoiceConversationResponse,
    type VoiceUsageResponse,
} from '@slopus/happy-wire';
import { AuthCredentials } from '@/auth/tokenStorage';
import { getServerUrl } from './serverConfig';
import { getHappyClientId } from './apiSocket';
import { config } from '@/config';
import { encodeBase64 } from '@/encryption/base64';

export type { VoiceConversationResponse, VoiceUsageResponse };

export type VoiceTranscriptionKeyStatus = {
    configured: boolean;
    source: 'user' | 'deployment' | null;
};

function authenticatedHeaders(credentials: AuthCredentials): Record<string, string> {
    return {
        'Authorization': `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
        'X-Happy-Client': getHappyClientId(),
    };
}

async function parseVoiceError(response: Response, fallback: string): Promise<Error> {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    return new Error(typeof payload?.error === 'string' ? payload.error : fallback);
}

export async function fetchVoiceTranscriptionKeyStatus(
    credentials: AuthCredentials,
): Promise<VoiceTranscriptionKeyStatus> {
    const response = await fetch(`${getServerUrl()}/v1/voice/transcription-key`, {
        headers: authenticatedHeaders(credentials),
    });
    if (!response.ok) throw await parseVoiceError(response, 'Could not load the OpenAI API key status');
    return await response.json() as VoiceTranscriptionKeyStatus;
}

export async function configureVoiceTranscriptionKey(
    credentials: AuthCredentials,
    apiKey: string,
): Promise<VoiceTranscriptionKeyStatus> {
    const response = await fetch(`${getServerUrl()}/v1/voice/transcription-key`, {
        method: 'PUT',
        headers: authenticatedHeaders(credentials),
        body: JSON.stringify({ apiKey }),
    });
    if (!response.ok) throw await parseVoiceError(response, 'Could not save the OpenAI API key');
    return await response.json() as VoiceTranscriptionKeyStatus;
}

export async function removeVoiceTranscriptionKey(
    credentials: AuthCredentials,
): Promise<VoiceTranscriptionKeyStatus> {
    const response = await fetch(`${getServerUrl()}/v1/voice/transcription-key`, {
        method: 'DELETE',
        headers: authenticatedHeaders(credentials),
    });
    if (!response.ok) throw await parseVoiceError(response, 'Could not remove the OpenAI API key');
    return await response.json() as VoiceTranscriptionKeyStatus;
}

export async function testVoiceTranscriptionKey(credentials: AuthCredentials): Promise<void> {
    const response = await fetch(`${getServerUrl()}/v1/voice/transcription-key/test`, {
        method: 'POST',
        headers: authenticatedHeaders(credentials),
    });
    if (!response.ok) throw await parseVoiceError(response, 'Could not test the OpenAI API key');
}

export async function fetchVoiceCredentials(
    credentials: AuthCredentials,
    sessionId: string
): Promise<VoiceConversationResponse> {
    const serverUrl = getServerUrl();

    const agentId = config.elevenLabsAgentId;

    if (!agentId) {
        throw new Error('Agent ID not configured');
    }

    const response = await fetch(`${serverUrl}/v1/voice/conversations`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
            'X-Happy-Client': getHappyClientId(),
        },
        body: JSON.stringify({
            agentId
        })
    });

    if (!response.ok) {
        throw new Error(`Voice token request failed: ${response.status}`);
    }

    return VoiceConversationResponseSchema.parse(await response.json());
}

export async function fetchVoiceUsage(
    credentials: AuthCredentials
): Promise<VoiceUsageResponse> {
    const serverUrl = getServerUrl();

    const response = await fetch(`${serverUrl}/v1/voice/usage`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'X-Happy-Client': getHappyClientId(),
        },
    });

    if (!response.ok) {
        throw new Error(`Voice usage request failed: ${response.status}`);
    }

    return VoiceUsageResponseSchema.parse(await response.json());
}

export async function transcribeVoiceInput(
    credentials: AuthCredentials,
    audio: Uint8Array,
    mimeType: string,
    language = 'en',
): Promise<string> {
    const serverUrl = getServerUrl();
    const response = await fetch(`${serverUrl}/v1/voice/transcriptions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
            'X-Happy-Client': getHappyClientId(),
        },
        body: JSON.stringify({
            audioBase64: encodeBase64(audio),
            mimeType,
            language,
        }),
    });
    const payload = await response.json().catch(() => null) as { text?: unknown; error?: unknown } | null;
    if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : `Voice transcription failed (${response.status})`);
    }
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new Error('Voice transcription returned no text');
    return text;
}
