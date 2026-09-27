import type { HappyHerdCommanderSummary } from '@happyherd/wire';

import { decodeBase64 } from '@/encryption/base64';
import { decodeUTF8 } from '@/encryption/text';

/**
 * Commander memory files shown on the Commanders page. They live in the
 * Commander's AgentContext on its machine and are read through the daemon's
 * root-bounded file read, the same transport Workspace uses.
 */
export const COMMANDER_MEMORY_FILES = [
    'memory/1-working-memory.md',
    'memory/2-long-term-memory.md',
] as const;

export type CommanderMemoryFile = typeof COMMANDER_MEMORY_FILES[number];

export function commanderMemoryPath(commander: Pick<HappyHerdCommanderSummary, 'agentContextPath'>, file: CommanderMemoryFile): string {
    const root = commander.agentContextPath.replace(/[\\/]+$/, '');
    return `${root}/${file}`;
}

type ReadWithinRoot = (machineId: string, path: string, rootPath: string) => Promise<{
    success: boolean;
    content?: string;
    error?: string;
}>;

/** Reads one memory file as UTF-8 text; throws with the daemon's message on failure. */
export async function readCommanderMemory(
    read: ReadWithinRoot,
    machineId: string,
    commander: Pick<HappyHerdCommanderSummary, 'agentContextPath'>,
    file: CommanderMemoryFile,
): Promise<string> {
    const result = await read(machineId, commanderMemoryPath(commander, file), commander.agentContextPath);
    if (!result.success || typeof result.content !== 'string') {
        throw new Error(result.error || file);
    }
    return decodeUTF8(decodeBase64(result.content));
}

const MEMORY_LINE_LIMIT = 180;

/**
 * The first readable statement in a memory file, for the card's memory line:
 * skips front matter, headings, quotes, tables, fences and rules, and strips
 * list markers and inline Markdown.
 */
export function commanderMemoryLine(markdown: string): string | null {
    const lines = markdown.split(/\r?\n/);
    let index = 0;
    if (lines[0]?.trim() === '---') {
        index = lines.findIndex((line, lineIndex) => lineIndex > 0 && line.trim() === '---') + 1;
        if (index <= 0) return null;
    }
    let fenced = false;
    for (; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (line.startsWith('```') || line.startsWith('~~~')) {
            fenced = !fenced;
            continue;
        }
        if (fenced || !line || /^(#|>|\||<)/.test(line) || /^([-*_])(\s*\1){2,}$/.test(line)) continue;
        const text = line
            .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[*_`~]+/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (text.length < 8) continue;
        return text.length > MEMORY_LINE_LIMIT
            ? `${text.slice(0, MEMORY_LINE_LIMIT - 1).trimEnd()}…`
            : text;
    }
    return null;
}
