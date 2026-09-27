import { describe, expect, it, vi } from 'vitest';

import {
    commanderMemoryLine,
    commanderMemoryPath,
    readCommanderMemory,
} from './commanderMemory';

describe('commanderMemoryPath', () => {
    it('joins the memory file to the AgentContext root without doubling separators', () => {
        expect(commanderMemoryPath({ agentContextPath: '/home/me/.happyherd/commanders/athena/agentcontext/' }, 'memory/1-working-memory.md'))
            .toBe('/home/me/.happyherd/commanders/athena/agentcontext/memory/1-working-memory.md');
    });
});

describe('readCommanderMemory', () => {
    it('reads within the AgentContext root and decodes UTF-8', async () => {
        const read = vi.fn(async () => ({ success: true, content: Buffer.from('记忆 — memory', 'utf8').toString('base64') }));
        await expect(readCommanderMemory(read, 'machine-a', { agentContextPath: '/c/agentcontext' }, 'memory/2-long-term-memory.md'))
            .resolves.toBe('记忆 — memory');
        expect(read).toHaveBeenCalledWith('machine-a', '/c/agentcontext/memory/2-long-term-memory.md', '/c/agentcontext');
    });

    it('surfaces the daemon error when the read fails', async () => {
        const read = vi.fn(async () => ({ success: false, error: 'Path escapes root' }));
        await expect(readCommanderMemory(read, 'machine-a', { agentContextPath: '/c/agentcontext' }, 'memory/1-working-memory.md'))
            .rejects.toThrow('Path escapes root');
    });
});

describe('commanderMemoryLine', () => {
    it('skips front matter, headings, quotes, tables, fences, and rules', () => {
        expect(commanderMemoryLine([
            '---',
            'title: memory',
            '---',
            '# Athena — Current Operational Memory',
            '',
            '> Read USER.md first.',
            '| a | b |',
            '```',
            'code block text that is long enough',
            '```',
            '---',
            '- The **cutover** completed on [Aug 25](https://example.invalid) across all nine Commanders.',
        ].join('\n'))).toBe('The cutover completed on Aug 25 across all nine Commanders.');
    });

    it('returns null when nothing readable remains and truncates long statements', () => {
        expect(commanderMemoryLine('# Only a heading\n\n> and a quote\n')).toBeNull();
        const line = commanderMemoryLine(`- ${'word '.repeat(80)}`);
        expect(line?.length).toBe(180);
        expect(line?.endsWith('…')).toBe(true);
    });
});
