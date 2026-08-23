import { describe, expect, it } from 'vitest';

import {
    classifyWorkspaceLinkTree,
    findPinnedWorkspaceLinkMachine,
    resolveWorkspaceLinkPresentation,
} from './WorkspaceLinkViewerModel';

describe('WorkspaceLinkViewer model', () => {
    it('uses a desktop side panel only on desktop-class platforms at 900px or wider', () => {
        expect(resolveWorkspaceLinkPresentation({ width: 900, platform: 'web', runningOnMac: false })).toBe('side-panel');
        expect(resolveWorkspaceLinkPresentation({ width: 899, platform: 'web', runningOnMac: false })).toBe('full-screen');
        expect(resolveWorkspaceLinkPresentation({ width: 1200, platform: 'ios', runningOnMac: false })).toBe('full-screen');
        expect(resolveWorkspaceLinkPresentation({ width: 900, platform: 'ios', runningOnMac: true })).toBe('side-panel');
    });

    it('pins the requested machine and never falls back to another online machine', () => {
        const machines = [
            { id: 'other', active: true },
            { id: 'owner', active: false },
        ];

        expect(findPinnedWorkspaceLinkMachine(machines, 'owner')).toEqual(machines[1]);
        expect(findPinnedWorkspaceLinkMachine(machines, 'missing')).toBeNull();
    });

    it('opens a directory at its exact path', () => {
        const tree = {
            type: 'directory' as const,
            name: 'reports',
            path: '/work/reports',
            children: [],
        };

        expect(classifyWorkspaceLinkTree(tree, () => '/unused')).toEqual({
            kind: 'directory',
            absolutePath: '/work/reports',
            tree,
        });
    });

    it('opens a file as the selected file in its containing directory', () => {
        expect(classifyWorkspaceLinkTree({
            type: 'file',
            name: 'report.md',
            path: '/work/reports/report.md',
        }, () => '/work/reports')).toEqual({
            kind: 'file',
            absolutePath: '/work/reports/report.md',
            directoryPath: '/work/reports',
        });
    });
});
