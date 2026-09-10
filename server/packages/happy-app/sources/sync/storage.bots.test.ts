import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native-mmkv', () => ({
    MMKV: class { getString() { return undefined; } set() {} delete() {} },
}));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('@/realtime/RealtimeSession', () => ({}));
vi.mock('@/components/tools/knownTools', () => ({ isMutableTool: () => false }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

import { storage } from './storage';
import type { Machine, Session } from './storageTypes';
import type { Project } from './projectTypes';
import { rigMetadataFixture } from './__testdata__/rigMetadata';

const personalProject: Project = {
    id: 'personal-project',
    externalId: 'personal-external',
    name: 'Launch',
    kind: 'personal',
    metadataVersion: 1,
    avatar: null,
    createdAt: 1,
    updatedAt: 1,
};

function machine(id: string, displayName: string): Machine {
    return {
        id,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: Date.now(),
        metadata: {
            host: `${id}.example`,
            platform: 'linux',
            happyCliVersion: '1.0.0',
            happyHomeDir: '/srv/happy',
            homeDir: '/srv',
            displayName,
        },
        metadataVersion: 1,
        daemonState: null,
        daemonStateVersion: 1,
    };
}

function botSession(options: {
    id: string;
    machineId: string;
    orderKey: string;
    projectId?: string | null;
    archived?: boolean;
    superSession?: boolean;
}): Session {
    return {
        id: options.id,
        projectId: options.projectId ?? null,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: !options.archived,
        activeAt: 1,
        metadata: {
            ...rigMetadataFixture,
            path: `/srv/${options.id}`,
            machineId: options.machineId,
            ...(options.archived ? { lifecycleState: 'archived' } : {}),
            ...(options.superSession ? { isSuperSession: true, commanderId: 'commander-one' } : {}),
            bot: {
                id: `bot-${options.id}`,
                name: 'Build assistant',
                username: `user-${options.id}`,
                workspaceId: `workspace-${options.id}`,
                orderKey: options.orderKey,
            },
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: options.archived ? Date.now() : 'online',
    };
}

beforeEach(() => {
    storage.setState({ sessions: {}, projects: {}, machines: {}, sessionListViewData: null });
    storage.getState().applyProjects([personalProject]);
    storage.getState().applyMachines([
        machine('machine-b', 'Beta machine'),
        machine('machine-a', 'Alpha machine'),
    ]);
});

describe('bot sessions in the production session projection', () => {
    it('places bots before projects in stable machine/order/id order while retaining assignment', () => {
        storage.getState().applySessions([
            botSession({ id: 'z', machineId: 'machine-a', orderKey: 'A0' }),
            botSession({ id: 'b', machineId: 'machine-b', orderKey: 'a' }),
            botSession({ id: 'c', machineId: 'machine-a', orderKey: 'a0' }),
            botSession({ id: 'a', machineId: 'machine-a', orderKey: 'a0', projectId: personalProject.id }),
        ]);

        const data = storage.getState().sessionListViewData!;
        expect(data[0]).toMatchObject({
            type: 'bots',
            sessions: [
                { id: 'z' },
                {
                    id: 'a',
                    name: 'Build assistant',
                    botId: 'bot-a',
                    botUsername: 'user-a',
                    machineName: 'Alpha machine',
                    projectId: personalProject.id,
                    avatarId: 'machine-a:bot:bot-a',
                },
                { id: 'c' },
                { id: 'b', machineName: 'Beta machine' },
            ],
        });
        expect(data.filter((item) => item.type === 'project')).toEqual([]);
    });

    it('extracts a bot-marked Super Session once into the pinned slot', () => {
        storage.getState().applySessions([
            botSession({ id: 'assistant', machineId: 'machine-a', orderKey: 'a', superSession: true }),
        ]);

        const data = storage.getState().sessionListViewData!;
        expect(data.map((item) => item.type)).toEqual(['super-session']);
        expect(data[0]).toMatchObject({
            type: 'super-session',
            session: { id: 'assistant', botId: 'bot-assistant', commanderId: 'commander-one' },
        });
    });

    it('keeps archived bot identity in the chronological archive tail', () => {
        storage.getState().applySessions([
            botSession({ id: 'archived', machineId: 'machine-b', orderKey: 'a', archived: true }),
        ]);

        const data = storage.getState().sessionListViewData!;
        expect(data.at(-1)).toMatchObject({
            type: 'session',
            session: {
                id: 'archived',
                archived: true,
                botId: 'bot-archived',
                botUsername: 'user-archived',
                machineName: 'Beta machine',
            },
        });
    });
});
