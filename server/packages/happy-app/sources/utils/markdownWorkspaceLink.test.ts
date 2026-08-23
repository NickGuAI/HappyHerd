import { describe, expect, it } from 'vitest';
import {
    buildWorkspaceLinkRoute,
    resolveMarkdownWorkspaceLinkRoute,
} from './markdownWorkspaceLink';

describe('markdownWorkspaceLink', () => {
    const metadata = {
        machineId: 'machine-origin',
        path: '/srv/projects/happy',
        os: 'linux',
    };

    it('builds typed route params without encoding special path names', () => {
        expect(buildWorkspaceLinkRoute({
            originSessionId: 'session-origin',
            machineId: 'machine-origin',
            absolutePath: '/srv/projects/happy/研究/My File.ts',
            line: 8,
            column: 13,
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'machine-origin',
                absolutePath: '/srv/projects/happy/研究/My File.ts',
                line: '8',
                column: '13',
            },
        });
    });

    it.each([
        ['relative file', 'src/../docs/readme.md', '/srv/projects/happy/docs/readme.md'],
        ['folder-looking target', 'docs', '/srv/projects/happy/docs'],
        ['absolute target', '/var/tmp/../log/output.txt', '/var/log/output.txt'],
    ])('resolves a %s from originating session metadata', (_name, url, absolutePath) => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url,
            originSessionId: 'session-origin',
            metadata,
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'machine-origin',
                absolutePath,
            },
        });
    });

    it('preserves line and column while deriving ownership only from session provenance', () => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url: '../machine-other/file.ts:27:4',
            label: 'machine-label:99:8',
            originSessionId: 'session-origin',
            metadata,
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'machine-origin',
                absolutePath: '/srv/projects/machine-other/file.ts',
                line: '27',
                column: '4',
            },
        });
    });

    it('routes percent-encoded filename colons on the originating machine', () => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url: 'notes%3Afinal.md:17:2',
            originSessionId: 'session-origin',
            metadata,
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'machine-origin',
                absolutePath: '/srv/projects/happy/notes:final.md',
                line: '17',
                column: '2',
            },
        });
    });

    it('preserves a percent-encoded POSIX filename backslash from session OS provenance', () => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url: 'notes%5Cfinal.md',
            originSessionId: 'session-origin',
            metadata,
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'machine-origin',
                absolutePath: '/srv/projects/happy/notes\\final.md',
            },
        });
    });

    it('expands a Windows backslash home target on the exact originating machine', () => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url: '~\\Documents\\notes.txt',
            originSessionId: 'session-origin',
            metadata: {
                machineId: 'windows-origin',
                path: 'C:\\Users\\alice\\project',
                os: 'win32',
            },
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'windows-origin',
                absolutePath: 'C:/Users/alice/Documents/notes.txt',
            },
        });
    });

    it('leaves HTTP links to the external-link handler', () => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url: 'https://example.com/docs',
            originSessionId: 'session-origin',
            metadata,
        })).toBeNull();
    });

    it.each([
        ['origin session', { url: 'src/index.ts', metadata }],
        ['machine', { url: 'src/index.ts', originSessionId: 'session-origin', metadata: { path: metadata.path } }],
        ['working directory', { url: 'src/index.ts', originSessionId: 'session-origin', metadata: { machineId: metadata.machineId, path: '' } }],
    ])('fails closed without the %s', (_name, input) => {
        expect(resolveMarkdownWorkspaceLinkRoute(input)).toBeNull();
    });
});
