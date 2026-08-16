import { describe, expect, it } from 'vitest';

import { hostRoot, joinHostPath, parentHostPath } from '@/utils/hostPath';

describe('MachinePathBrowser host paths', () => {
    it('lets Unix users browse from home all the way to filesystem root', () => {
        expect(hostRoot('/home/example-user', 'linux')).toBe('/');
        expect(parentHostPath('/home/example-user/App', 'linux')).toBe('/home/example-user');
        expect(parentHostPath('/home', 'linux')).toBe('/');
        expect(parentHostPath('/', 'linux')).toBe('/');
    });

    it('keeps Windows navigation on the selected home drive', () => {
        expect(hostRoot('C:\\Users\\ExampleUser', 'win32')).toBe('C:\\');
        expect(parentHostPath('C:\\Users\\ExampleUser\\App', 'win32')).toBe('C:\\Users\\ExampleUser');
        expect(parentHostPath('C:\\Users', 'win32')).toBe('C:\\');
    });

    it('joins child names with the host platform separator', () => {
        expect(joinHostPath('/home/example-user', 'App', 'linux')).toBe('/home/example-user/App');
        expect(joinHostPath('/', 'tmp', 'linux')).toBe('/tmp');
        expect(joinHostPath('C:\\Users\\ExampleUser', 'App', 'win32')).toBe('C:\\Users\\ExampleUser\\App');
    });
});
