import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SHARED_ENTRY_MARKDOWN, SHARED_CLI_MARKDOWN, globalAgentsMarkdown } from './sharedKnowledgeTemplates';

/** Seed missing public guidance only. Existing files remain user-owned. */
export async function ensureSharedKnowledge(root: string): Promise<{
  files: Array<{ path: string; status: 'created' | 'preserved' }>;
}> {
  const files: Array<{ path: string; status: 'created' | 'preserved' }> = [];
  for (const [relativePath, content] of [
    ['agentcontext/README.md', SHARED_ENTRY_MARKDOWN],
    ['agentcontext/happyherd-cli.md', SHARED_CLI_MARKDOWN],
    ['AGENTS.md', globalAgentsMarkdown()],
  ]) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      await writeFile(target, content, { flag: 'wx', mode: 0o600 });
      files.push({ path: target, status: 'created' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      files.push({ path: target, status: 'preserved' });
    }
  }
  return { files };
}
