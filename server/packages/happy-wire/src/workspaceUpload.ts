import * as z from 'zod';

export const MAX_WORKSPACE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_WORKSPACE_UPLOAD_FILES = 10;
/**
 * Base64 characters carried by one encrypted machine RPC. The RPC layer wraps
 * this JSON in authenticated encryption and base64 once more, so keeping the
 * plaintext chunk at 256 KiB leaves ample room below Engine.IO's default
 * 1,000,000-byte frame limit without raising that global limit.
 */
export const MAX_WORKSPACE_UPLOAD_CHUNK_BASE64_LENGTH = 256 * 1024;

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
