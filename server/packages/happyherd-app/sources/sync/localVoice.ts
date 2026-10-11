import {
    VOICE_RPC_METHODS,
    type LocalVoiceStatus,
    type VoiceFeature,
    type VoiceOperation,
    type VoiceReadResult,
} from '@happyherd/wire';
import { apiSocket } from './apiSocket';

async function voiceRpc<T>(machineId: string, method: string, params: unknown): Promise<T> {
    const response = await apiSocket.machineRPC<T | { error: string }, unknown>(machineId, method, params);
    if (response && typeof response === 'object' && 'error' in response && typeof response.error === 'string') {
        throw new Error(response.error);
    }
    return response as T;
}

export const localVoiceStatus = (machineId: string) => (
    voiceRpc<LocalVoiceStatus>(machineId, VOICE_RPC_METHODS.status, {})
);

export const installLocalVoiceFeature = (machineId: string, feature: VoiceFeature) => (
    voiceRpc<VoiceOperation>(machineId, VOICE_RPC_METHODS.install, { feature })
);

export const startLocalVoiceUpload = (machineId: string, mimeType: string, byteLength: number) => (
    voiceRpc<{ operationId: string; nextOffset: number }>(machineId, VOICE_RPC_METHODS.uploadStart, { mimeType, byteLength })
);

export const uploadLocalVoiceChunk = (machineId: string, operationId: string, offset: number, audioBase64: string) => (
    voiceRpc<{ nextOffset: number }>(machineId, VOICE_RPC_METHODS.uploadChunk, { operationId, offset, audioBase64 })
);

export const startLocalVoiceTranscription = (machineId: string, operationId: string) => (
    voiceRpc<VoiceOperation>(machineId, VOICE_RPC_METHODS.transcribe, { operationId })
);

export const startLocalVoiceSpeech = (machineId: string, text: string) => (
    voiceRpc<VoiceOperation>(machineId, VOICE_RPC_METHODS.speak, { text })
);

export const localVoiceOperation = (machineId: string, operationId: string) => (
    voiceRpc<VoiceOperation>(machineId, VOICE_RPC_METHODS.operation, { operationId })
);

export const readLocalVoiceAudio = (machineId: string, operationId: string, cursor: number) => (
    voiceRpc<VoiceReadResult>(machineId, VOICE_RPC_METHODS.read, { operationId, cursor })
);

export const cancelLocalVoiceOperation = (machineId: string, operationId: string) => (
    voiceRpc<{ ok: true }>(machineId, VOICE_RPC_METHODS.cancel, { operationId })
);

export const releaseLocalVoiceOperation = (machineId: string, operationId: string) => (
    voiceRpc<{ ok: true }>(machineId, VOICE_RPC_METHODS.release, { operationId })
);
