import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClaudeCodeExecutable } from './claudeExecutable';

describe('Claude executable resolution', () => {
    const originalPath = process.env.HAPPYHERD_CLAUDE_PATH;
    let fixtureDirectory: string | undefined;

    afterEach(async () => {
        if (originalPath === undefined) delete process.env.HAPPYHERD_CLAUDE_PATH;
        else process.env.HAPPYHERD_CLAUDE_PATH = originalPath;
        if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
    });

    it('reuses the local launcher resolver explicit executable override', async () => {
        fixtureDirectory = await mkdtemp(join(tmpdir(), 'happyherd-claude-path-'));
        const executable = join(fixtureDirectory, 'claude');
        await writeFile(executable, '');
        process.env.HAPPYHERD_CLAUDE_PATH = executable;

        expect(resolveClaudeCodeExecutable()).toBe(executable);
    });
});
