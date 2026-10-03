import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SHARED_CLI_MARKDOWN } from './agentContext/sharedKnowledgeTemplates';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-guide-help-'));
  await mkdir(path.join(root, 'empty-bin'));
  await writeFile(path.join(root, 'claude-help.cjs'), "if (!process.argv.includes('--help')) process.exit(97); console.log('Isolated Claude help fixture');\n");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const commands = SHARED_CLI_MARKDOWN.match(/~~~sh\n([\s\S]*?)\n~~~/)![1].split('\n');

describe('installed shared guide help against the built CLI', () => {
  it.each(commands)('%s shows usage without login, daemon, or provider startup', command => {
    const happyherdHome = path.join(root, 'happyherd');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../dist/index.mjs', import.meta.url)),
      ...command.split(' ').slice(1),
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        CI: '1',
        HOME: path.join(root, 'home'),
        HAPPYHERD_HOME_DIR: happyherdHome,
        HAPPYHERD_SERVER_URL: 'http://127.0.0.1:9',
        HAPPYHERD_WEBAPP_URL: 'http://127.0.0.1:9',
        HAPPYHERD_VARIANT: 'stable',
        // Explicitly override provider discovery, including its Homebrew fallback.
        HAPPYHERD_CLAUDE_PATH: path.join(root, 'claude-help.cjs'),
        PATH: path.join(root, 'empty-bin'),
      },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).not.toContain('Doctor diagnosis complete!');
    if (command === 'happyherd --help') {
      expect(result.stdout).toContain('Isolated Claude help fixture');
    }
    expect(result.stderr).toBe('');
    for (const state of ['access.key', 'agent.key', 'daemon.state.json', 'daemon.state.json.lock', 'sessions.json']) {
      expect(existsSync(path.join(happyherdHome, state))).toBe(false);
    }
  }, 15_000);
});
