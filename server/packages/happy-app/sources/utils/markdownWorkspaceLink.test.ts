import { describe, expect, it } from 'vitest';
import {
    buildWorkspaceLinkRoute,
    resolveMarkdownWorkspaceImageReference,
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

    it('resolves a sibling link from the viewed file directory without changing session provenance', () => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url: 'john-mccarthy.md:12',
            originSessionId: 'session-origin',
            metadata,
            relativeTo: '/srv/projects/happy/myboken/4. Daily/2026/09-01',
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'machine-origin',
                absolutePath: '/srv/projects/happy/myboken/4. Daily/2026/09-01/john-mccarthy.md',
                line: '12',
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
                path: 'D:\\work\\project',
                homeDir: 'D:\\Profiles\\alice',
                os: 'win32',
            },
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'windows-origin',
                absolutePath: 'D:/Profiles/alice/Documents/notes.txt',
            },
        });
    });

    it('expands a POSIX home target from a recorded custom home directory', () => {
        expect(resolveMarkdownWorkspaceLinkRoute({
            url: '~/notes.md',
            originSessionId: 'session-origin',
            metadata: {
                machineId: 'root-origin',
                path: '/srv/agent-home/project',
                homeDir: '/srv/agent-home',
                os: 'linux',
            },
        })).toEqual({
            pathname: '/workspace',
            params: {
                mode: 'link',
                originSessionId: 'session-origin',
                machineId: 'root-origin',
                absolutePath: '/srv/agent-home/notes.md',
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

    it('resolves an inline image only inside the originating session root', () => {
        expect(resolveMarkdownWorkspaceImageReference({
            url: 'images/../screenshots/result.png',
            originSessionId: 'session-origin',
            metadata,
        })).toEqual({
            rootPath: '/srv/projects/happy',
            workspaceRoute: {
                pathname: '/workspace',
                params: {
                    mode: 'link',
                    originSessionId: 'session-origin',
                    machineId: 'machine-origin',
                    absolutePath: '/srv/projects/happy/screenshots/result.png',
                },
            },
        });
    });

    it('resolves a sibling image from the viewed file directory but retains the session-root read boundary', () => {
        expect(resolveMarkdownWorkspaceImageReference({
            url: 'images/chart.png',
            originSessionId: 'session-origin',
            metadata,
            relativeTo: '/srv/projects/happy/docs',
        })).toEqual({
            rootPath: '/srv/projects/happy',
            workspaceRoute: {
                pathname: '/workspace',
                params: {
                    mode: 'link',
                    originSessionId: 'session-origin',
                    machineId: 'machine-origin',
                    absolutePath: '/srv/projects/happy/docs/images/chart.png',
                },
            },
        });
    });

    it.each([
        ['POSIX', { machineId: 'posix-root', path: '/', os: 'linux' }, '/images/chart.png'],
        ['Windows drive', { machineId: 'windows-root', path: 'C:\\', os: 'win32' }, 'C:/images/chart.png'],
    ])('resolves an inline image from a %s filesystem root', (_name, rootMetadata, absolutePath) => {
        expect(resolveMarkdownWorkspaceImageReference({
            url: 'images/chart.png',
            originSessionId: 'session-origin',
            metadata: rootMetadata,
        })).toEqual({
            rootPath: rootMetadata.path,
            workspaceRoute: {
                pathname: '/workspace',
                params: {
                    mode: 'link',
                    originSessionId: 'session-origin',
                    machineId: rootMetadata.machineId,
                    absolutePath,
                },
            },
        });
    });

    it.each([
        '../outside.png',
        '/var/tmp/outside.png',
        'C:\\Temp\\outside.png',
        '~/outside.png',
        'data:image/png;base64,AAAA',
        'file:///tmp/outside.png',
        'javascript:alert',
    ])('rejects the inline image target %s before a machine read', (url) => {
        expect(resolveMarkdownWorkspaceImageReference({
            url,
            originSessionId: 'session-origin',
            metadata,
        })).toBeNull();
    });

    it('fails closed for an inline image without immutable session provenance', () => {
        expect(resolveMarkdownWorkspaceImageReference({
            url: 'images/result.png',
            originSessionId: 'session-origin',
            metadata: { machineId: 'machine-origin', path: '' },
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
