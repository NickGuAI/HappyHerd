import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
});

it('does not emit session identifiers or install a commit hook in production', async () => {
    vi.stubGlobal('__DEV__', false);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfMark, perfSince, useCommitPerf } = await import('./perfLog');
    perfMark('session-open:private-session');
    perfSince('session-open:private-session', 'mounted');
    expect(() => useCommitPerf('chat', 'private-session')).not.toThrow();
    expect(output).not.toHaveBeenCalled();
});

it('retains session-open timing for the development performance harness', async () => {
    vi.stubGlobal('__DEV__', true);
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { perfMark, perfSince } = await import('./perfLog');
    perfMark('session-open:test-session');
    perfSince('session-open:test-session', 'mounted');
    expect(output).toHaveBeenCalledWith(expect.stringContaining('mounted'));
});
