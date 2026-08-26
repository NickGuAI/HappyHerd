import { describe, expect, it } from 'vitest';
import {
    buildSessionFileGitDiffCommand,
    parseExplicitSessionFileLink,
    parseSessionFileLink,
    resolveSessionFilePath,
    splitSessionFileText,
} from './sessionFileLinks';

describe('sessionFileLinks', () => {
    const sessionRoot = '/Users/kirilldubovitskiy/projects/happy';

    it('parses absolute file refs with line numbers', () => {
        const result = parseSessionFileLink('/Users/kirilldubovitskiy/projects/happy/packages/happy-cli/src/codex/runCodex.ts:594', {
            sessionRoot,
        });

        expect(result).toEqual({
            path: '/Users/kirilldubovitskiy/projects/happy/packages/happy-cli/src/codex/runCodex.ts',
            absolutePath: '/Users/kirilldubovitskiy/projects/happy/packages/happy-cli/src/codex/runCodex.ts',
            relativePath: 'packages/happy-cli/src/codex/runCodex.ts',
            withinSessionRoot: true,
            line: 594,
            column: null,
        });
    });

    it('parses relative file refs with line and column numbers', () => {
        const result = parseSessionFileLink('packages/happy-cli/src/codex/runCodex.ts:594:2', {
            sessionRoot,
        });

        expect(result).toEqual({
            path: 'packages/happy-cli/src/codex/runCodex.ts',
            absolutePath: '/Users/kirilldubovitskiy/projects/happy/packages/happy-cli/src/codex/runCodex.ts',
            relativePath: 'packages/happy-cli/src/codex/runCodex.ts',
            withinSessionRoot: true,
            line: 594,
            column: 2,
        });
    });

    it('rejects external urls', () => {
        expect(parseSessionFileLink('https://openai.com', { sessionRoot })).toBeNull();
        expect(parseSessionFileLink('mailto:test@example.com', { sessionRoot })).toBeNull();
    });

    describe('explicit Markdown targets', () => {
        it('resolves relative files and folder-looking targets against the session root', () => {
            expect(parseExplicitSessionFileLink('./packages/../docs', { sessionRoot })).toEqual({
                path: 'docs',
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs',
                relativePath: 'docs',
                withinSessionRoot: true,
                line: null,
                column: null,
            });
        });

        it.each([
            ['POSIX', '/', 'linux', '/images/chart.png'],
            ['Windows drive', 'C:\\', 'win32', 'C:/images/chart.png'],
        ])('resolves relative files from a %s filesystem root', (_name, root, platform, absolutePath) => {
            expect(parseExplicitSessionFileLink('images/chart.png', {
                sessionRoot: root,
                platform,
            })).toEqual({
                path: 'images/chart.png',
                absolutePath,
                relativePath: 'images/chart.png',
                withinSessionRoot: true,
                line: null,
                column: null,
            });
        });

        it('decodes percent-encoded Markdown paths before resolving them', () => {
            expect(parseExplicitSessionFileLink('docs/My%20File-%E6%96%B9%E6%A1%88.md:17:2', { sessionRoot })).toEqual({
                path: 'docs/My File-方案.md',
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/My File-方案.md',
                relativePath: 'docs/My File-方案.md',
                withinSessionRoot: true,
                line: 17,
                column: 2,
            });
        });

        it('preserves malformed percent encodings instead of throwing', () => {
            expect(parseExplicitSessionFileLink('docs/bad%2name.md', { sessionRoot })).toMatchObject({
                path: 'docs/bad%2name.md',
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/bad%2name.md',
            });
        });

        it('normalizes absolute targets without imposing a session-root scope gate', () => {
            expect(parseExplicitSessionFileLink('/tmp/other/../notes.md:41:7', { sessionRoot })).toEqual({
                path: '/tmp/notes.md',
                absolutePath: '/tmp/notes.md',
                relativePath: null,
                withinSessionRoot: false,
                line: 41,
                column: 7,
            });
        });

        it('treats UNC targets as absolute and preserves their coordinates', () => {
            expect(parseExplicitSessionFileLink('\\\\server\\share\\folder\\file.ts:27:4', { sessionRoot })).toEqual({
                path: '//server/share/folder/file.ts',
                absolutePath: '//server/share/folder/file.ts',
                relativePath: null,
                withinSessionRoot: false,
                line: 27,
                column: 4,
            });
        });

        it('does not normalize a UNC path above its server and share root', () => {
            expect(parseExplicitSessionFileLink('\\\\server\\share\\..\\file.ts', { sessionRoot }))
                .toMatchObject({
                    path: '//server/share/file.ts',
                    absolutePath: '//server/share/file.ts',
                    relativePath: null,
                    withinSessionRoot: false,
                });
        });

        it('preserves line and column from the target or its label', () => {
            expect(parseExplicitSessionFileLink('src/index.ts:12:3', { sessionRoot })).toMatchObject({
                line: 12,
                column: 3,
            });
            expect(parseExplicitSessionFileLink('README.md:18', { sessionRoot })).toMatchObject({
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/README.md',
                line: 18,
                column: null,
            });
            expect(parseExplicitSessionFileLink('src/index.ts', {
                label: 'src/index.ts:24:9',
                sessionRoot,
            })).toMatchObject({
                line: 24,
                column: 9,
            });
        });

        it.each([
            ['docs/My Report.md:31:4 "Project docs"', 31, 4],
            ["docs/My Report.md:32:5 'Project docs'", 32, 5],
            ['docs/My Report.md:33:6 (Project docs)', 33, 6],
        ])('strips a valid Markdown title from %s without losing path spaces or coordinates', (target, line, column) => {
            expect(parseExplicitSessionFileLink(target, { sessionRoot })).toEqual({
                path: 'docs/My Report.md',
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/My Report.md',
                relativePath: 'docs/My Report.md',
                withinSessionRoot: true,
                line,
                column,
            });
        });

        it('keeps an invalid unterminated Markdown title as part of the path', () => {
            expect(parseExplicitSessionFileLink('docs/My Report.md "Project docs', { sessionRoot })).toMatchObject({
                path: 'docs/My Report.md "Project docs',
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/My Report.md "Project docs',
                line: null,
                column: null,
            });
        });

        it('removes raw query and fragment syntax before path decoding without losing coordinates', () => {
            expect(parseExplicitSessionFileLink('docs/README.md:44:2?view=source#install', { sessionRoot }))
                .toMatchObject({
                    path: 'docs/README.md',
                    absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/README.md',
                    line: 44,
                    column: 2,
                });
        });

        it('preserves percent-encoded query and fragment characters inside filenames', () => {
            expect(parseExplicitSessionFileLink('docs/README%23draft%3Fcopy.md', { sessionRoot }))
                .toMatchObject({
                    path: 'docs/README#draft?copy.md',
                    absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/README#draft?copy.md',
                });
        });

        it('unwraps angle-bracket Markdown destinations before resolving paths with spaces', () => {
            expect(parseExplicitSessionFileLink('<docs/My File.md#install> "Project docs"', { sessionRoot }))
                .toMatchObject({
                    path: 'docs/My File.md',
                    absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/My File.md',
                });
        });

        it('preserves percent-encoded angle brackets that belong to a filename', () => {
            expect(parseExplicitSessionFileLink('docs/%3Cdraft%3E.md', { sessionRoot }))
                .toMatchObject({
                    path: 'docs/<draft>.md',
                    absolutePath: '/Users/kirilldubovitskiy/projects/happy/docs/<draft>.md',
                });
        });

        it('preserves a percent-encoded colon that belongs to a local filename', () => {
            expect(parseExplicitSessionFileLink('notes%3Afinal.md:17:2', { sessionRoot }))
                .toMatchObject({
                    path: 'notes:final.md',
                    absolutePath: '/Users/kirilldubovitskiy/projects/happy/notes:final.md',
                    line: 17,
                    column: 2,
                });
        });

        it('preserves decoded backslashes as filename data on POSIX machines', () => {
            expect(parseExplicitSessionFileLink('notes%5Cfinal.md', {
                sessionRoot: '/srv/projects/happy',
                platform: 'linux',
            })).toEqual({
                path: 'notes\\final.md',
                absolutePath: '/srv/projects/happy/notes\\final.md',
                relativePath: 'notes\\final.md',
                withinSessionRoot: true,
                line: null,
                column: null,
            });
            expect(parseExplicitSessionFileLink('dir%5C..%5Cfile.md', {
                sessionRoot: '/srv/projects/happy',
                platform: 'darwin',
            })).toMatchObject({
                path: 'dir\\..\\file.md',
                absolutePath: '/srv/projects/happy/dir\\..\\file.md',
            });
            expect(parseExplicitSessionFileLink('C%3A/docs%5Cnotes.md', {
                sessionRoot: '/srv/projects/happy',
                platform: 'linux',
            })).toMatchObject({
                path: 'C:/docs\\notes.md',
                absolutePath: '/srv/projects/happy/C:/docs\\notes.md',
            });
        });

        it('continues to treat decoded backslashes as separators on Windows machines', () => {
            expect(parseExplicitSessionFileLink('notes%5Cfinal.md', {
                sessionRoot: 'C:\\srv\\happy',
                platform: 'win32',
            })).toMatchObject({
                path: 'notes/final.md',
                absolutePath: 'C:/srv/happy/notes/final.md',
                relativePath: 'notes/final.md',
            });
        });

        it('expands a backslash home prefix only on the recorded Windows platform', () => {
            expect(parseExplicitSessionFileLink('~\\Documents\\notes.txt', {
                sessionRoot: 'C:\\Users\\alice\\project',
                platform: 'win32',
            })).toMatchObject({
                path: '~/Documents/notes.txt',
                absolutePath: 'C:/Users/alice/Documents/notes.txt',
                relativePath: null,
            });
            expect(parseExplicitSessionFileLink('~\\Documents\\notes.txt', {
                sessionRoot: '/srv/project',
                homeDir: '/srv/agent-home',
                platform: 'linux',
            })).toMatchObject({
                path: '~\\Documents\\notes.txt',
                absolutePath: '/srv/project/~\\Documents\\notes.txt',
                relativePath: '~\\Documents\\notes.txt',
            });
        });

        it('prefers the recorded home directory over a home inferred from the session root', () => {
            expect(parseExplicitSessionFileLink('~/notes.md', {
                sessionRoot: '/srv/build/project',
                homeDir: '/srv/agent-home',
                platform: 'linux',
            })).toMatchObject({
                path: '~/notes.md',
                absolutePath: '/srv/agent-home/notes.md',
                relativePath: null,
            });
        });

        it('rejects external schemes and raw page-local targets', () => {
            expect(parseExplicitSessionFileLink('https://openai.com', { sessionRoot })).toBeNull();
            expect(parseExplicitSessionFileLink('https%3A%2F%2Fopenai.com', { sessionRoot })).toBeNull();
            expect(parseExplicitSessionFileLink('mailto:test@example.com', { sessionRoot })).toBeNull();
            expect(parseExplicitSessionFileLink('data:text/plain,hello', { sessionRoot })).toBeNull();
            expect(parseExplicitSessionFileLink('notes:final.md', { sessionRoot })).toBeNull();
            expect(parseExplicitSessionFileLink('#details', { sessionRoot })).toBeNull();
            expect(parseExplicitSessionFileLink('?tab=details', { sessionRoot })).toBeNull();
        });

        it('preserves encoded leading query and fragment characters as filenames', () => {
            expect(parseExplicitSessionFileLink('%23details', { sessionRoot })).toMatchObject({
                path: '#details',
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/#details',
            });
            expect(parseExplicitSessionFileLink('%3Ftab', { sessionRoot })).toMatchObject({
                path: '?tab',
                absolutePath: '/Users/kirilldubovitskiy/projects/happy/?tab',
            });
        });
    });

    it('splits bare text into plain and linked segments', () => {
        const result = splitSessionFileText('Open packages/happy-cli/src/codex/runCodex.ts:594 please.', sessionRoot);

        expect(result).toEqual([
            { text: 'Open ', link: null },
            {
                text: 'packages/happy-cli/src/codex/runCodex.ts:594',
                link: {
                    path: 'packages/happy-cli/src/codex/runCodex.ts',
                    absolutePath: '/Users/kirilldubovitskiy/projects/happy/packages/happy-cli/src/codex/runCodex.ts',
                    relativePath: 'packages/happy-cli/src/codex/runCodex.ts',
                    withinSessionRoot: true,
                    line: 594,
                    column: null,
                },
            },
            { text: ' please.', link: null },
        ]);
    });

    it('splits absolute bare file refs with spaces into linked segments', () => {
        const retinaFilePath = '/Users/kirilldubovitskiy/Library/Application Support/CleanShot/media/test/'
            + 'CleanShot 2026-03-19 at 00.54.37'
            + String.fromCharCode(64)
            + '2x.png';
        const result = splitSessionFileText(
            `Image: ${retinaFilePath}`,
            sessionRoot,
        );

        expect(result).toEqual([
            { text: 'Image: ', link: null },
            {
                text: retinaFilePath,
                link: {
                    path: retinaFilePath,
                    absolutePath: retinaFilePath,
                    relativePath: null,
                    withinSessionRoot: false,
                    line: null,
                    column: null,
                },
            },
        ]);
    });

    it('does not turn version numbers into file refs', () => {
        expect(splitSessionFileText('Version 1.2.3 shipped.', sessionRoot)).toEqual([
            { text: 'Version 1.2.3 shipped.', link: null },
        ]);
    });

    it('does not turn slash-separated prose into file refs', () => {
        expect(splitSessionFileText(
            'Codex then starts/resumes turns with backend default model. I’m checking CLI docs/tests to confirm there is intentionally no happy codex model set or --model surface today.',
            sessionRoot,
        )).toEqual([
            {
                text: 'Codex then starts/resumes turns with backend default model. I’m checking CLI docs/tests to confirm there is intentionally no happy codex model set or --model surface today.',
                link: null,
            },
        ]);
    });

    it('resolves viewer input to an absolute path', () => {
        expect(resolveSessionFilePath('packages/happy-app/README.md', sessionRoot)).toEqual({
            path: 'packages/happy-app/README.md',
            absolutePath: '/Users/kirilldubovitskiy/projects/happy/packages/happy-app/README.md',
            relativePath: 'packages/happy-app/README.md',
            withinSessionRoot: true,
            line: null,
            column: null,
        });
    });

    it('builds diffs only for shell-inert relative paths', () => {
        expect(buildSessionFileGitDiffCommand('packages/happy app/.mcp.json')).toBe(
            'git diff --no-ext-diff -- "packages/happy app/.mcp.json"',
        );
        expect(buildSessionFileGitDiffCommand('x"$(touch /tmp/hh-pwn)".db')).toBeNull();
        expect(buildSessionFileGitDiffCommand('config/%TEMP%/value.txt')).toBeNull();
        expect(buildSessionFileGitDiffCommand('../outside.txt')).toBeNull();
    });
});
