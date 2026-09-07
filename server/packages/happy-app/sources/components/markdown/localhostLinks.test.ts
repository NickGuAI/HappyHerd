import { describe, expect, it } from 'vitest';
import { normalizeExternalMarkdownLink, resolveWorkspaceLocalhostLink } from './linkUtils';
import { EMPTY_DESKTOP_FILE_WORKSPACE, openDesktopLocalhost } from '../desktopFileWorkspaceModel';

const provenance = { originSessionId: 'main-chat', machineId: 'machine-one' };

describe('chat localhost links', () => {
    it.each(['localhost', '127.0.0.1', '[::1]'])('resolves HTTP and HTTPS on %s', (host) => {
        for (const protocol of ['http', 'https']) {
            const url = `${protocol}://${host}:8766/validation-map.html?view=full#diagram`;
            expect(resolveWorkspaceLocalhostLink({ ...provenance, url })).toEqual({
                kind: 'localhost', ...provenance, url,
            });
        }
    });

    it('canonicalizes the URL without replacing the originating chat or machine', () => {
        expect(resolveWorkspaceLocalhostLink({
            ...provenance,
            url: ' HTTP://LOCALHOST:80/map?machineId=other&originSessionId=other#main ',
        })).toEqual({
            kind: 'localhost', ...provenance,
            url: 'http://localhost/map?machineId=other&originSessionId=other#main',
        });
    });

    it.each(['http', 'https'])('restores Markdown-encoded IPv6 brackets for %s without decoding the resource', (protocol) => {
        const resource = '/map%2Fdetail?q=a%26b#section%20one';
        expect(resolveWorkspaceLocalhostLink({
            ...provenance, url: `${protocol}://%5B::1%5D:8766${resource}`,
        })).toEqual({
            kind: 'localhost', ...provenance, url: `${protocol}://[::1]:8766${resource}`,
        });
    });

    it.each([
        'https://example.com/', 'http://localhost.example.com/',
        'http://localhost@evil.example/', 'http://user:password@localhost/',
        'http://127.1/', 'http://2130706433/', 'http://0x7f000001/',
        'file:///tmp/map.html', 'javascript:alert(1)', '//localhost:8766/map',
        'http://192.168.1.10/', 'http://localhost:99999/',
        'http://%5B::1%5D.evil.example/', 'http://%5B::1%5D@evil.example/',
        'http://user@%5B::1%5D/', 'http://%5B%3A%3A1%5D/',
        'http://%6cocalhost/', 'http://%5B::2%5D/',
    ])('does not admit unsupported live target %s', (url) => {
        expect(resolveWorkspaceLocalhostLink({ ...provenance, url })).toBeNull();
    });

    it.each([
        { originSessionId: undefined, machineId: 'machine-one' },
        { originSessionId: 'main-chat', machineId: undefined },
        { originSessionId: ' ', machineId: 'machine-one' },
        { originSessionId: 'main-chat', machineId: ' ' },
    ])('requires host-supplied provenance %j', (owner) => {
        expect(resolveWorkspaceLocalhostLink({ ...owner, url: 'http://localhost:8766/map' })).toBeNull();
    });

    it('retains ordinary external normalization', () => {
        expect(normalizeExternalMarkdownLink('https://example.com/docs')).toBe('https://example.com/docs');
        expect(normalizeExternalMarkdownLink('//example.com/docs')).toBe('https://example.com/docs');
    });

    it('reuses one tab per machine and canonical URL, not one tab per URL globally', () => {
        const first = resolveWorkspaceLocalhostLink({ ...provenance, url: 'HTTP://LOCALHOST:80/map' })!;
        const same = resolveWorkspaceLocalhostLink({ ...provenance, url: 'http://localhost/map' })!;
        const other = resolveWorkspaceLocalhostLink({ ...provenance, machineId: 'machine-two', url: same.url })!;
        const state = openDesktopLocalhost(EMPTY_DESKTOP_FILE_WORKSPACE, first.machineId, first.url);
        expect(openDesktopLocalhost(state, same.machineId, same.url)).toBe(state);
        expect(openDesktopLocalhost(state, other.machineId, other.url).paths).toHaveLength(2);
    });
});
