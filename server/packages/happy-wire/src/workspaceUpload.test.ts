import { describe, expect, it } from 'vitest';

import {
  WorkspaceUploadRequestSchema,
  WorkspaceUploadStartRequestSchema,
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
});
