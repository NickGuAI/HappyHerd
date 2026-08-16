import * as z from 'zod';

export const MAX_WORKSPACE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_WORKSPACE_UPLOAD_FILES = 10;

export const WorkspaceUploadRequestSchema = z.object({
  directory: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
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
  return fileName.length > 0
    && fileName !== '.'
    && fileName !== '..'
    && !fileName.includes('/')
    && !fileName.includes('\\')
    && !fileName.includes('\0');
}
