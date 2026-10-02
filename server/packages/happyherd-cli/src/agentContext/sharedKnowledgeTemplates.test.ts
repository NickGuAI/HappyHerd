import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { globalAgentsMarkdown, SHARED_CLI_MARKDOWN, SHARED_ENTRY_MARKDOWN } from './sharedKnowledgeTemplates';

describe('portable shared knowledge', () => {
  it('resolves every seeded Markdown link within the same configured home', () => {
    const home = '/disposable/custom home';
    const files = new Map([
      [path.join(home, 'AGENTS.md'), globalAgentsMarkdown()],
      [path.join(home, 'agentcontext/README.md'), SHARED_ENTRY_MARKDOWN],
      [path.join(home, 'agentcontext/happyherd-cli.md'), SHARED_CLI_MARKDOWN],
    ]);
    for (const [filename, content] of files) {
      const links = [...content.matchAll(/\]\(([^)]+)\)/g)];
      expect(links.length).toBeGreaterThan(0);
      for (const [, target] of links) {
        expect(path.isAbsolute(target)).toBe(false);
        expect(files.has(path.resolve(path.dirname(filename), target))).toBe(true);
      }
      expect(content).not.toMatch(/\/Users\/|\/home\/bot|App\/external-projects/);
    }
  });

  it('keeps the executable help block distinct from provider launches and operational examples', () => {
    const helpBlock = SHARED_CLI_MARKDOWN.match(/~~~sh\n([\s\S]*?)\n~~~/)?.[1];
    expect(helpBlock).toBeDefined();
    const commands = helpBlock!.split('\n');
    expect(commands).toContain('happyherd session send --help');
    expect(commands).toContain('happyherd server --help');
    expect(commands).toContain('happyherd commander --help');
    expect(commands.every(command => command.endsWith(' --help'))).toBe(true);
    expect(commands.some(command => /^happyherd (acp|agy|gemini|grok|dsh|codex)\b/.test(command))).toBe(false);
  });
});
