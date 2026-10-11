import * as z from 'zod';

export const VoiceFeatureSchema = z.enum(['stt', 'tts']);
export type VoiceFeature = z.infer<typeof VoiceFeatureSchema>;

export const VoiceInstallStateSchema = z.enum([
    'not-installed',
    'installing',
    'ready',
    'failed',
    'unsupported',
]);
export type VoiceInstallState = z.infer<typeof VoiceInstallStateSchema>;

export const LocalVoiceFeatureStatusSchema = z.object({
    state: VoiceInstallStateSchema,
    error: z.string().optional(),
});
export const LocalVoiceStatusSchema = z.object({
    stt: LocalVoiceFeatureStatusSchema,
    tts: LocalVoiceFeatureStatusSchema,
});
export type LocalVoiceFeatureStatus = z.infer<typeof LocalVoiceFeatureStatusSchema>;
export type LocalVoiceStatus = z.infer<typeof LocalVoiceStatusSchema>;

export const VoiceOperationKindSchema = z.enum(['install', 'transcribe', 'speak']);
export type VoiceOperationKind = z.infer<typeof VoiceOperationKindSchema>;
export const VoiceOperationStateSchema = z.enum(['pending', 'running', 'done', 'error', 'cancelled']);
export type VoiceOperationState = z.infer<typeof VoiceOperationStateSchema>;

export const VoiceOperationSchema = z.object({
    operationId: z.string().min(1),
    kind: VoiceOperationKindSchema,
    state: VoiceOperationStateSchema,
    error: z.string().optional(),
    text: z.string().optional(),
    progress: z.string().optional(),
});
export type VoiceOperation = z.infer<typeof VoiceOperationSchema>;

export const VoiceAudioChunkSchema = z.object({
    index: z.number().int().nonnegative(),
    audioBase64: z.string(),
    mimeType: z.literal('audio/wav'),
    sampleRate: z.number().int().positive(),
});
export const VoiceReadResultSchema = z.object({
    state: VoiceOperationStateSchema,
    nextCursor: z.number().int().nonnegative(),
    chunks: z.array(VoiceAudioChunkSchema),
    error: z.string().optional(),
});
export type VoiceAudioChunk = z.infer<typeof VoiceAudioChunkSchema>;
export type VoiceReadResult = z.infer<typeof VoiceReadResultSchema>;

export const VoiceInstallRequestSchema = z.object({ feature: VoiceFeatureSchema });
export const VoiceUploadStartRequestSchema = z.object({
    mimeType: z.string().min(1).max(128),
    byteLength: z.number().int().positive().max(32 * 1024 * 1024),
});
export const VoiceUploadStartResponseSchema = z.object({ operationId: z.string().min(1), nextOffset: z.literal(0) });
export const VoiceUploadChunkRequestSchema = z.object({
    operationId: z.string().min(1),
    offset: z.number().int().nonnegative(),
    audioBase64: z.string().min(1).max(256 * 1024),
});
export const VoiceUploadChunkResponseSchema = z.object({ nextOffset: z.number().int().nonnegative() });
export const VoiceTranscribeRequestSchema = z.object({ operationId: z.string().min(1) });
export const VoiceSpeakRequestSchema = z.object({ text: z.string().min(1).max(100_000) });
export const VoiceOperationRequestSchema = z.object({ operationId: z.string().min(1) });
export const VoiceReadRequestSchema = z.object({ operationId: z.string().min(1), cursor: z.number().int().nonnegative() });
export const VoiceCancelRequestSchema = VoiceOperationRequestSchema;
export const VoiceReleaseRequestSchema = VoiceOperationRequestSchema;

export const VOICE_RPC_METHODS = {
    status: 'happyherd-voice-status',
    install: 'happyherd-voice-install',
    uploadStart: 'happyherd-voice-upload-start',
    uploadChunk: 'happyherd-voice-upload-chunk',
    transcribe: 'happyherd-voice-transcribe',
    speak: 'happyherd-voice-speak',
    operation: 'happyherd-voice-operation',
    read: 'happyherd-voice-read',
    cancel: 'happyherd-voice-cancel',
    release: 'happyherd-voice-release',
} as const;
