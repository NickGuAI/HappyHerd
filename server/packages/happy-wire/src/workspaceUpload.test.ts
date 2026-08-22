import { describe, expect, it } from 'vitest';

import {
  MAX_WORKSPACE_UPLOAD_BYTES,
  WorkspaceUploadRequestSchema,
  WorkspaceUploadStartRequestSchema,
  WorkspaceFileHashRequestSchema,
  WorkspaceFileHashResponseSchema,
  WorkspaceCreateDirectoryRequestSchema,
  isSafeWorkspacePathSegment,
} from './workspaceUpload';

describe('workspace path segment contract', () => {
  it('accepts literal plus, spaces, percent, hash, and Unicode names', () => {
    for (const name of ['a+b', 'a b', '100%', '#notes', '你好']) {
      expect(isSafeWorkspacePathSegment(name)).toBe(true);
      expect(WorkspaceCreateDirectoryRequestSchema.safeParse({
        directory: '/srv/work',
        directoryName: name,
      }).success).toBe(true);
    }
  });

  it('rejects traversal, separators, NUL, empty, and unknown request fields', () => {
    for (const directoryName of ['', '.', '..', '../escape', 'nested/child', 'nested\\child', 'bad\0name']) {
      expect(
        isSafeWorkspacePathSegment(directoryName)
        && WorkspaceCreateDirectoryRequestSchema.safeParse({ directory: '/srv/work', directoryName }).success,
      ).toBe(false);
    }
    expect(WorkspaceCreateDirectoryRequestSchema.safeParse({
      directory: '/srv/work',
      directoryName: 'child',
      recursive: true,
    }).success).toBe(false);
  });

  it('validates without normalizing exact path and name values', () => {
    expect(WorkspaceUploadRequestSchema.parse({
      directory: '/srv/work ',
      fileName: ' report.txt ',
      content: '',
    })).toEqual({ directory: '/srv/work ', fileName: ' report.txt ', content: '' });
    expect(WorkspaceUploadStartRequestSchema.parse({
      directory: '/srv/work ',
      fileName: ' report.txt ',
      size: 0,
    })).toEqual({ directory: '/srv/work ', fileName: ' report.txt ', size: 0 });
    expect(WorkspaceCreateDirectoryRequestSchema.parse({
      directory: '/srv/work ',
      directoryName: ' child ',
    })).toEqual({ directory: '/srv/work ', directoryName: ' child ' });

    expect(WorkspaceUploadStartRequestSchema.safeParse({
      directory: '   ',
      fileName: 'report.txt',
      size: 0,
    }).success).toBe(false);
    expect(WorkspaceCreateDirectoryRequestSchema.safeParse({
      directory: '/srv/work',
      directoryName: '   ',
    }).success).toBe(false);
  });

  it('accepts only canonical lowercase SHA-256 hashes for optimistic replacement', () => {
    const expectedHash = 'a'.repeat(64);
    expect(WorkspaceUploadRequestSchema.parse({
      directory: '/srv/work',
      fileName: 'avatar.png',
      content: '',
      expectedHash,
    }).expectedHash).toBe(expectedHash);
    expect(WorkspaceUploadStartRequestSchema.parse({
      directory: '/srv/work',
      fileName: 'avatar.png',
      size: 0,
      expectedHash,
    }).expectedHash).toBe(expectedHash);

    for (const invalidHash of ['a'.repeat(63), 'A'.repeat(64), 'not-a-hash']) {
      expect(WorkspaceUploadStartRequestSchema.safeParse({
        directory: '/srv/work',
        fileName: 'avatar.png',
        size: 0,
        expectedHash: invalidHash,
      }).success).toBe(false);
    }
  });

  it('keeps the file-hash preflight bounded and content-free', () => {
    expect(WorkspaceFileHashRequestSchema.parse({
      path: '/srv/work/avatar.png',
      maxBytes: 2 * 1024 * 1024,
    })).toEqual({ path: '/srv/work/avatar.png', maxBytes: 2 * 1024 * 1024 });
    const response = WorkspaceFileHashResponseSchema.parse({
      success: true,
      exists: true,
      size: 128,
      hash: 'a'.repeat(64),
    });
    expect(response).not.toHaveProperty('content');
    expect(WorkspaceFileHashResponseSchema.safeParse({
      ...response,
      content: 'must never cross this RPC',
    }).success).toBe(false);
    expect(WorkspaceFileHashRequestSchema.safeParse({
      path: '/srv/work/avatar.png',
      maxBytes: MAX_WORKSPACE_UPLOAD_BYTES + 1,
    }).success).toBe(false);
  });
});
