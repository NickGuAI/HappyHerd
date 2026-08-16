/**
 * Suggestion commands functionality for slash commands
 * Reads commands directly from session metadata storage
 */

import Fuse from 'fuse.js';
import { storage } from './storage';

export interface CommandItem {
    command: string;        // The command without slash (e.g., "compact")
    description?: string;   // Optional description of what the command does
}

interface SearchOptions {
    limit?: number;
    threshold?: number;
}

type Translate = (key: any) => string;

// Commands to ignore/filter out
export const IGNORED_COMMANDS = [
    "add-dir",
    "agents",
    "config",
    "statusline",
    "bashes",
    "settings",
    "cost",
    "doctor",
    "exit",
    "help",
    "ide",
    "init",
    "install-github-app",
    "memory",
    "migrate-installer",
    "model",
    "pr-comments",
    "release-notes",
    "resume",
    "status",
    "bug",
    "review",
    "security-review",
    "terminal-setup",
    "upgrade",
    "vim",
    "permissions",
    "hooks",
    "export",
    "logout",
    "login"
];

// Default commands always available
const getDefaultCommands = (translate: Translate): CommandItem[] => [
    { command: 'compact', description: translate('uiCopy.compactTheConversationHistory') },
    { command: 'clear', description: translate('uiCopy.clearTheConversation') },
    { command: 'goal', description: translate('uiCopy.setASessionGoal') },
    { command: 'mcp', description: translate('uiCopy.showConnectedMcpServers') },
    { command: 'skills', description: translate('uiCopy.showAvailableSkills') },
];

// Command descriptions for known tools/commands
const COMMAND_DESCRIPTIONS: Record<string, string> = {
    // Default commands
    compact: 'Compact the conversation history',
    goal: 'Set a session goal',
    
    // Common tool commands
    help: 'Show available commands',
    clear: 'Clear the conversation',
    reset: 'Reset the session',
    export: 'Export conversation',
    debug: 'Show debug information',
    status: 'Show connection status',
    stop: 'Stop current operation',
    abort: 'Abort current operation',
    cancel: 'Cancel current operation',
    
    // Add more descriptions as needed
};

// Get commands from session metadata
function getCommandsFromSession(sessionId: string, translate: Translate): CommandItem[] {
    const state = storage.getState();
    const session = state.sessions[sessionId];
    if (!session || !session.metadata) {
        return getDefaultCommands(translate);
    }

    const commands: CommandItem[] = getDefaultCommands(translate);

    const metadataCommands = [
        ...(session.metadata.slashCommands ?? []),
        ...(session.metadata.skills ?? []),
    ];

    for (const cmd of metadataCommands) {
        // Skip if in ignore list
        if (IGNORED_COMMANDS.includes(cmd)) continue;

        // Check if it's already in default commands or slash commands
        if (!commands.find(c => c.command === cmd)) {
            commands.push({
                command: cmd,
                description: COMMAND_DESCRIPTIONS[cmd]  // Optional description
            });
        }
    }
    
    return commands;
}

// Main export: search commands with fuzzy matching
export async function searchCommands(
    sessionId: string,
    query: string,
    translate: Translate,
    options: SearchOptions = {}
): Promise<CommandItem[]> {
    const { limit = 10, threshold = 0.3 } = options;
    
    // Get commands from session metadata (no caching)
    const commands = getCommandsFromSession(sessionId, translate);
    
    // If query is empty, return all commands
    if (!query || query.trim().length === 0) {
        return commands.slice(0, limit);
    }
    
    // Setup Fuse for fuzzy search
    const fuseOptions = {
        keys: [
            { name: 'command', weight: 0.7 },
            { name: 'description', weight: 0.3 }
        ],
        threshold,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 1,
        ignoreLocation: true,
        useExtendedSearch: true
    };
    
    const fuse = new Fuse(commands, fuseOptions);
    const results = fuse.search(query, { limit });
    
    return results.map(result => result.item);
}

// Get all available commands for a session
export function getAllCommands(sessionId: string, translate: Translate): CommandItem[] {
    return getCommandsFromSession(sessionId, translate);
}
