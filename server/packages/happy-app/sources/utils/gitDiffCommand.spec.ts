import { describe, expect, it } from 'vitest';
import { execSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildGitDiffCommand,
    buildGitShowBase64Command,
    FULL_FILE_CONTEXT,
    quoteShellPath,
} from './gitDiffCommand';

describe('quoteShellPath', () => {
    it('quotes a plain path', () => {
        expect(quoteShellPath('src/app.ts')).toBe('"src/app.ts"');
    });

    it('survives paths that would otherwise break the command apart', () => {
        expect(quoteShellPath('src/say "hi".ts')).toBe('"src/say \\"hi\\".ts"');
        expect(quoteShellPath('src/back\\slash.ts')).toBe('"src/back\\\\slash.ts"');
        // Unescaped, these would be expanded by the shell rather than read.
        expect(quoteShellPath('src/$HOME.ts')).toBe('"src/\\$HOME.ts"');
        expect(quoteShellPath('src/`whoami`.ts')).toBe('"src/\\`whoami\\`.ts"');
    });
});

describe('buildGitDiffCommand', () => {
    it('asks for git defaults when nothing is requested', () => {
        expect(buildGitDiffCommand('src/app.ts')).toBe(
            'git --literal-pathspecs -c core.quotepath=false diff HEAD --no-ext-diff -- "src/app.ts"',
        );
    });

    it('widens the context when asked', () => {
        expect(buildGitDiffCommand('src/app.ts', { contextLines: 25 })).toContain('-U25');
        expect(buildGitDiffCommand('src/app.ts', { contextLines: FULL_FILE_CONTEXT }))
            .toContain(`-U${FULL_FILE_CONTEXT}`);
    });

    it('keeps a context of zero rather than treating it as unset', () => {
        expect(buildGitDiffCommand('src/app.ts', { contextLines: 0 })).toContain('-U0');
    });

    it('folds whitespace-only changes when asked', () => {
        expect(buildGitDiffCommand('src/app.ts', { ignoreWhitespace: true })).toContain(' -w ');
        expect(buildGitDiffCommand('src/app.ts', { ignoreWhitespace: false })).not.toContain('-w');
    });

    it('combines both without losing either', () => {
        const command = buildGitDiffCommand('src/app.ts', { contextLines: 10, ignoreWhitespace: true });
        expect(command).toContain('-U10');
        expect(command).toContain('-w');
        expect(command.endsWith('-- "src/app.ts"')).toBe(true);
    });
});

describe('real shell transport', () => {
    it('keeps metacharacters literal and binary HEAD bytes intact in both command forms', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'diff-shell-'));
        const path = 'binary $HOME `whoami` %TEMP% & [x].png';
        const original = Buffer.from([0, 255, 128, 13, 10, 1]);
        try {
            const git = (...args: string[]) => execFileSync('git', args, { cwd });
            git('init', '-q');
            writeFileSync(join(cwd, path), original);
            git('add', '--', path);
            git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
            writeFileSync(join(cwd, path), Buffer.from([3, 4, 5]));
            expect(execSync(buildGitShowBase64Command(path), { cwd, encoding: 'utf8' })).toBe(original.toString('base64'));
            for (const platform of ['linux', 'win32']) {
                const command = buildGitDiffCommand(path, { platform });
                expect(execSync(command, { cwd, encoding: 'utf8' })).toContain('Binary files');
                if (platform === 'win32') {
                    expect(command).not.toContain(path);
                    expect(command).not.toContain('%TEMP%');
                }
            }
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
