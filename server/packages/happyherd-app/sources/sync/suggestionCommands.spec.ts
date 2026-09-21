import { describe, expect, it, vi } from 'vitest';
import type { Session } from './storageTypes';

const mockSessions: Record<string, Partial<Session>> = {};

vi.mock('./storage', () => ({
    storage: {
        getState: () => ({ sessions: mockSessions }),
    },
}));

import { getAllCommands } from './suggestionCommands';

const translations: Record<string, string> = {
    'uiCopy.compactTheConversationHistory': 'Compact the conversation history',
    'uiCopy.clearTheConversation': 'Clear the conversation',
    'uiCopy.setASessionGoal': 'Set a session goal',
    'uiCopy.showConnectedMcpServers': 'Show connected MCP servers',
    'uiCopy.showAvailableSkills': 'Show available skills',
};
const translate = (key: string) => translations[key] ?? key;

describe('suggestionCommands', () => {
    it('includes /goal in the default slash command suggestions', () => {
        const commands = getAllCommands('missing-session', translate);

        expect(commands).toEqual(expect.arrayContaining([
            expect.objectContaining({
                command: 'goal',
                description: 'Set a session goal',
            }),
        ]));
    });

    it('includes skills from session metadata in slash command suggestions', () => {
        mockSessions['codex-session'] = {
            metadata: {
                path: '/tmp/project',
                host: 'localhost',
                skills: ['plan-to-beads', 'superpowers:brainstorming'],
            },
        } as Partial<Session>;

        const commands = getAllCommands('codex-session', translate);

        expect(commands).toEqual(expect.arrayContaining([
            expect.objectContaining({ command: 'plan-to-beads' }),
            expect.objectContaining({ command: 'superpowers:brainstorming' }),
        ]));
    });
});
