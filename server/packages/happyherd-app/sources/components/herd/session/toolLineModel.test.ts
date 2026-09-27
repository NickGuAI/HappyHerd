import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { formatToolSeconds, resolveToolLineStats, resolveToolLineText } from './toolLineModel';

describe('tool line', () => {
    const tool = (name: string, input: unknown, extra: Record<string, unknown> = {}) => ({
        name, input, title: undefined, description: null, ...extra,
    }) as any;

    it('splits the activity label into a verb and a monospaced argument', () => {
        expect(resolveToolLineText(tool('Bash', { command: 'pnpm test' }))).toEqual({ verb: 'toolGroup.ran', argument: 'pnpm test' });
        expect(resolveToolLineText(tool('Read', { file_path: '/work/app/src/a.ts' }))).toEqual({
            verb: 'toolGroup.read', argument: '/work/app/src/a.ts',
        });
        // File arguments read relative to the session folder.
        expect(resolveToolLineText(tool('Read', { file_path: '/work/app/src/a.ts' }), { path: '/work/app' } as any)).toEqual({
            verb: 'toolGroup.read', argument: 'src/a.ts',
        });
        // Provider titles stay whole.
        expect(resolveToolLineText(tool('Read', { file_path: '/work/app/src/a.ts' }, { title: 'Inspect the auth module' }))).toEqual({
            verb: 'Inspect the auth module', argument: null,
        });
    });

    it('counts changed lines for edits, writes and patches', () => {
        expect(resolveToolLineStats(tool('Edit', { old_string: 'a\nb', new_string: 'a\nc\nd' }))).toEqual({ additions: 2, deletions: 1 });
        expect(resolveToolLineStats(tool('MultiEdit', { edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: '', new_string: 'c' },
        ] }))).toEqual({ additions: 2, deletions: 1 });
        expect(resolveToolLineStats(tool('Write', { content: 'x\ny\n' }))).toEqual({ additions: 2, deletions: 0 });
        expect(resolveToolLineStats(tool('apply_patch', {
            patch: '*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n+more\n*** End Patch',
        }))).toEqual({ additions: 2, deletions: 1 });
        expect(resolveToolLineStats(tool('Read', { file_path: 'a.ts' }))).toBeNull();
    });

    it('formats elapsed seconds with one decimal', () => {
        expect(formatToolSeconds(2400)).toBe('2.4s');
        expect(formatToolSeconds(-10)).toBe('0.0s');
    });
});
