import { describe, expect, it } from 'vitest';

import { hostRoot, joinHostPath, parentHostPath } from '@/utils/hostPath';

describe('MachinePathBrowser host paths', () => {
    it('lets Unix users browse from home all the way to filesystem root', () => {
        expect(hostRoot('/home/nick', 'linux')).toBe('/');
        expect(parentHostPath('/home/nick/App', 'linux')).toBe('/home/nick');
        expect(parentHostPath('/home', 'linux')).toBe('/');
        expect(parentHostPath('/', 'linux')).toBe('/');
    });

    it('keeps Windows navigation on the selected home drive', () => {
        expect(hostRoot('C:\\Users\\Nick', 'win32')).toBe('C:\\');
        expect(parentHostPath('C:\\Users\\Nick\\App', 'win32')).toBe('C:\\Users\\Nick');
        expect(parentHostPath('C:\\Users', 'win32')).toBe('C:\\');
    });

    it('joins child names with the host platform separator', () => {
        expect(joinHostPath('/home/nick', 'App', 'linux')).toBe('/home/nick/App');
        expect(joinHostPath('/', 'tmp', 'linux')).toBe('/tmp');
        expect(joinHostPath('C:\\Users\\Nick', 'App', 'win32')).toBe('C:\\Users\\Nick\\App');
    });
});
