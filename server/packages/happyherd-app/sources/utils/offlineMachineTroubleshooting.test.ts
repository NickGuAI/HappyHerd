import { describe, expect, it } from 'vitest';
import type { MachineChoice } from '@/sync/machineChoices';
import type { Session } from '@/sync/storageTypes';
import { buildOfflineMachineTroubleshooting } from './offlineMachineTroubleshooting';

function choice(options: {
    id: string;
    name: string;
    activeAt: number;
    happyHomeDir?: string;
}): MachineChoice {
    return {
        id: options.id,
        name: options.name,
        machineIds: [options.id],
        happyherdMachine: {
            id: options.id,
            active: false,
            activeAt: options.activeAt,
            metadata: options.happyHomeDir ? { happyHomeDir: options.happyHomeDir } : null,
        } as MachineChoice['happyherdMachine'],
        rigMachine: null,
        online: false,
        activeAt: options.activeAt,
    };
}

function session(options: {
    machineId: string;
    path: string;
    projectName?: string;
    updatedAt: number;
}): Session {
    return {
        id: `${options.machineId}-${options.updatedAt}`,
        updatedAt: options.updatedAt,
        metadata: {
            machineId: options.machineId,
            path: options.path,
            project: options.projectName
                ? { id: 'project-id', kind: 'project', name: options.projectName }
                : undefined,
        },
    } as Session;
}

describe('offline machine troubleshooting', () => {
    it('points the AI at the HappyHerd folder and names the machine and project', () => {
        const guide = buildOfflineMachineTroubleshooting([
            choice({ id: 'mac', name: 'Kirill’s Mac', activeAt: 10, happyHomeDir: '/Users/kirill/.happyherd' }),
        ], [
            session({ machineId: 'mac', path: '/Users/kirill/Developer/happyherd', projectName: 'HappyHerd', updatedAt: 20 }),
        ]);

        expect(guide.aiPrompt).toBe('In /Users/kirill/.happyherd, diagnose why HappyHerd cannot reach "Kirill’s Mac" for project "HappyHerd".');
    });

    it('uses the newest known project to choose which offline machine to troubleshoot', () => {
        const guide = buildOfflineMachineTroubleshooting([
            choice({ id: 'desktop', name: 'Desktop', activeAt: 100, happyHomeDir: '/desktop/.happyherd' }),
            choice({ id: 'laptop', name: 'Laptop', activeAt: 50, happyHomeDir: '/laptop/.happyherd' }),
        ], [
            session({ machineId: 'desktop', path: '/work/older', updatedAt: 20 }),
            session({ machineId: 'laptop', path: 'C:\\work\\current-project', updatedAt: 30 }),
        ]);

        expect(guide.machineName).toBe('Laptop');
        expect(guide.projectName).toBe('current-project');
        expect(guide.happyHomeDir).toBe('/laptop/.happyherd');
    });

    it('still produces a useful prompt before any session exists', () => {
        const guide = buildOfflineMachineTroubleshooting([
            choice({ id: 'mac', name: 'Mac', activeAt: 10 }),
        ], []);

        expect(guide.projectName).toBe('HappyHerd');
        expect(guide.happyHomeDir).toBe('~/.happyherd');
    });
});
