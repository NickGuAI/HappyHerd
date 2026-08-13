import { describe, expect, it, vi } from 'vitest';
import {
    MAX_WORKSPACE_CONTEXT_FILE_BYTES,
    addWorkspaceContextFile,
    clearWorkspaceContextFiles,
    decodeWorkspaceContextText,
    getWorkspaceContextFileSource,
    getWorkspaceContextFiles,
    removeWorkspaceContextFile,
    buildWorkspaceContextMessage,
} from './workspaceContext';

vi.mock('./ops', () => ({
    machineReadFile: vi.fn(async () => ({ success: true, content: btoa('\0binary') })),
    sessionReadFile: vi.fn(),
}));

function toBase64(value: string): string {
    return btoa(unescape(encodeURIComponent(value)));
}

describe('workspace context selection', () => {
    it('deduplicates and removes selected files per session', () => {
        clearWorkspaceContextFiles('s1');
        expect(addWorkspaceContextFile('s1', 'src/a.ts')).toBe(true);
        expect(addWorkspaceContextFile('s1', 'src/a.ts')).toBe(true);
        expect(getWorkspaceContextFiles('s1')).toEqual(['src/a.ts']);
        removeWorkspaceContextFile('s1', 'src/a.ts');
        expect(getWorkspaceContextFiles('s1')).toEqual([]);
    });

    it('tracks machine-scoped selections without changing legacy session selections', () => {
        clearWorkspaceContextFiles('s2');
        expect(addWorkspaceContextFile('s2', '/home/nick/report.md', {
            kind: 'machine',
            machineId: 'machine-1',
        })).toBe(true);
        expect(getWorkspaceContextFileSource('s2', '/home/nick/report.md')).toEqual({
            kind: 'machine',
            machineId: 'machine-1',
        });

        expect(addWorkspaceContextFile('s2', 'src/legacy.ts')).toBe(true);
        expect(getWorkspaceContextFileSource('s2', 'src/legacy.ts')).toEqual({ kind: 'session' });
        clearWorkspaceContextFiles('s2');
    });

    it('upgrades an existing legacy chip to the selected machine source', () => {
        clearWorkspaceContextFiles('s3');
        expect(addWorkspaceContextFile('s3', '/srv/report.md')).toBe(true);
        expect(addWorkspaceContextFile('s3', '/srv/report.md', {
            kind: 'machine',
            machineId: 'machine-2',
        })).toBe(true);
        expect(getWorkspaceContextFiles('s3')).toEqual(['/srv/report.md']);
        expect(getWorkspaceContextFileSource('s3', '/srv/report.md')).toEqual({
            kind: 'machine',
            machineId: 'machine-2',
        });
        clearWorkspaceContextFiles('s3');
    });

    it('rejects binary and oversized context before sending', () => {
        expect(() => decodeWorkspaceContextText(btoa('\0binary'), 'asset.bin')).toThrow('not a readable text file');
        const oversized = btoa('a'.repeat(MAX_WORKSPACE_CONTEXT_FILE_BYTES + 1));
        expect(() => decodeWorkspaceContextText(oversized, 'large.txt')).toThrow('larger than 128 KiB');
    });

    it('decodes utf-8 text', () => {
        expect(decodeWorkspaceContextText(toBase64('你好, HappyHerd'), 'note.md').text).toBe('你好, HappyHerd');
    });

    it('keeps machine binary attachments as host-path references for the agent', async () => {
        clearWorkspaceContextFiles('s4');
        addWorkspaceContextFile('s4', '/home/nick/report.pdf', { kind: 'machine', machineId: 'm1' });
        const message = await buildWorkspaceContextMessage('s4', 'Review this', ['/home/nick/report.pdf']);
        expect(message.promptText).toContain('ATTACHED WORKSPACE FILE REFERENCE: /home/nick/report.pdf');
        expect(message.promptText).toContain('Use the provider file tools');
        clearWorkspaceContextFiles('s4');
    });
});
