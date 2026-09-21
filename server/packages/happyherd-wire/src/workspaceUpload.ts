import * as z from 'zod';

export const MAX_WORKSPACE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_WORKSPACE_UPLOAD_FILES = 10;
/** Base64 characters carried by one encrypted machine RPC upload chunk. */
export const MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH = 256 * 1024;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function isSafeWorkspacePathSegment(name: string): boolean {
  return name.length > 0
    && name !== '.'
    && name !== '..'
    && !name.includes('/')
    && !name.includes('\\')
    && !name.includes('\0');
}

export const WorkspaceUploadRequestSchema = z.object({
  directory: z.string().min(1).refine((value) => value.trim().length > 0),
  fileName: z.string().min(1).max(255).refine((value) => value.trim().length > 0),
  content: z.string(),
  expectedHash: z.string().regex(SHA256_HEX_PATTERN).optional(),
}).strict();

export type WorkspaceUploadRequest = z.infer<typeof WorkspaceUploadRequestSchema>;

export const WorkspaceUploadResponseSchema = z.object({
  success: z.boolean(),
  path: z.string().optional(),
  size: z.number().int().min(0).optional(),
  hash: z.string().optional(),
  code: z.enum(['invalid-name', 'too-large', 'conflict', 'not-directory', 'write-failed']).optional(),
  error: z.string().optional(),
}).strict();

export type WorkspaceUploadResponse = z.infer<typeof WorkspaceUploadResponseSchema>;

export function isSafeWorkspaceUploadFileName(fileName: string): boolean {
  return isSafeWorkspacePathSegment(fileName);
}

export const WorkspaceUploadStartRequestSchema = z.object({
  directory: z.string().min(1).refine((value) => value.trim().length > 0),
  fileName: z.string().min(1).max(255).refine((value) => value.trim().length > 0),
  size: z.number().int().min(0).max(MAX_WORKSPACE_UPLOAD_BYTES),
  expectedHash: z.string().regex(SHA256_HEX_PATTERN).optional(),
}).strict();

export type WorkspaceUploadStartRequest = z.infer<typeof WorkspaceUploadStartRequestSchema>;

export const WorkspaceUploadStartResponseSchema = z.object({
  success: z.boolean(),
  uploadId: z.string().uuid().optional(),
  code: z.enum(['invalid-name', 'too-large', 'conflict', 'not-directory', 'write-failed']).optional(),
  error: z.string().optional(),
}).strict();

export type WorkspaceUploadStartResponse = z.infer<typeof WorkspaceUploadStartResponseSchema>;

export const WorkspaceUploadChunkRequestSchema = z.object({
  uploadId: z.string().uuid(),
  offset: z.number().int().min(0).max(MAX_WORKSPACE_UPLOAD_BYTES),
  content: z.string().min(4).max(MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH),
}).strict();

export type WorkspaceUploadChunkRequest = z.infer<typeof WorkspaceUploadChunkRequestSchema>;

export const WorkspaceUploadChunkResponseSchema = z.object({
  success: z.boolean(),
  received: z.number().int().min(0).max(MAX_WORKSPACE_UPLOAD_BYTES).optional(),
  code: z.enum(['invalid-upload', 'invalid-content', 'too-large', 'write-failed']).optional(),
  error: z.string().optional(),
}).strict();

export type WorkspaceUploadChunkResponse = z.infer<typeof WorkspaceUploadChunkResponseSchema>;

export const WorkspaceUploadFinishRequestSchema = z.object({
  uploadId: z.string().uuid(),
}).strict();

export type WorkspaceUploadFinishRequest = z.infer<typeof WorkspaceUploadFinishRequestSchema>;

export const WorkspaceUploadAbortRequestSchema = WorkspaceUploadFinishRequestSchema;
export type WorkspaceUploadAbortRequest = WorkspaceUploadFinishRequest;

export const WorkspaceUploadAbortResponseSchema = z.object({
  success: z.boolean(),
}).strict();

export type WorkspaceUploadAbortResponse = z.infer<typeof WorkspaceUploadAbortResponseSchema>;

/**
 * Read only the bounded size and SHA-256 identity of a regular machine file.
 * The daemon never returns file content through this preflight operation.
 */
export const WorkspaceFileHashRequestSchema = z.object({
  path: z.string().min(1).refine((value) => value.trim().length > 0),
  maxBytes: z.number().int().positive().max(MAX_WORKSPACE_UPLOAD_BYTES),
}).strict();

export type WorkspaceFileHashRequest = z.infer<typeof WorkspaceFileHashRequestSchema>;

export const WorkspaceFileHashResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    exists: z.literal(false),
  }).strict(),
  z.object({
    success: z.literal(true),
    exists: z.literal(true),
    size: z.number().int().min(0),
    hash: z.string().regex(SHA256_HEX_PATTERN),
  }).strict(),
  z.object({
    success: z.literal(false),
    code: z.enum(['invalid-path', 'not-regular', 'too-large', 'read-failed', 'unavailable']),
    error: z.string().optional(),
  }).strict(),
]);

export type WorkspaceFileHashResponse = z.infer<typeof WorkspaceFileHashResponseSchema>;

export const WorkspaceCreateDirectoryRequestSchema = z.object({
  directory: z.string().min(1).refine((value) => value.trim().length > 0),
  directoryName: z.string().min(1).max(255).refine((value) => value.trim().length > 0),
}).strict();

export type WorkspaceCreateDirectoryRequest = z.infer<typeof WorkspaceCreateDirectoryRequestSchema>;

export const WorkspaceCreateDirectoryResponseSchema = z.object({
  success: z.boolean(),
  path: z.string().optional(),
  code: z.enum([
    'invalid-name',
    'conflict',
    'not-found',
    'not-directory',
    'permission-denied',
    'write-failed',
  ]).optional(),
  error: z.string().optional(),
}).strict();

export type WorkspaceCreateDirectoryResponse = z.infer<typeof WorkspaceCreateDirectoryResponseSchema>;
