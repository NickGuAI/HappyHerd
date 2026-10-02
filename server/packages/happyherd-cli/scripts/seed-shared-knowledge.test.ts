import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import packageJson from '../package.json';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
let root: string;
let stagedPackage: string;
let happyherdHome: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'happyherd-package-guidance-'));
  stagedPackage = path.join(root, 'package');
  happyherdHome = path.join(root, 'custom happyherd home');
  await mkdir(path.join(stagedPackage, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'empty-bin'));
  await copyFile(path.join(packageRoot, 'scripts', 'seed-shared-knowledge.cjs'), path.join(stagedPackage, 'scripts', 'seed-shared-knowledge.cjs'));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function runPackageSeed() {
  return spawnSync(process.execPath, [path.join(stagedPackage, 'scripts', 'seed-shared-knowledge.cjs')], {
    cwd: stagedPackage,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      HOME: path.join(root, 'os-home'),
      HAPPYHERD_HOME_DIR: happyherdHome,
      HAPPYHERD_SERVER_URL: 'http://127.0.0.1:9',
      HAPPYHERD_WEBAPP_URL: 'http://127.0.0.1:9',
      PATH: path.join(root, 'empty-bin'),
      CI: '1',
    },
  });
}

function expectSuccess(result: ReturnType<typeof runPackageSeed>) {
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('');
}

describe('npm package postinstall shared guidance', () => {
  it('chains guide seeding after tool unpacking and tolerates a source checkout before build', () => {
    expect(packageJson.scripts.postinstall).toBe('node scripts/unpack-tools.cjs && node scripts/seed-shared-knowledge.cjs');
    expectSuccess(runPackageSeed());
    expect(existsSync(happyherdHome)).toBe(false);
  });

  it('seeds a built package in a blank home and preserves guides and private state on reinstall', async () => {
    // Reproduce the published layout using the exact build and installed
    // dependencies, without invoking npm or touching the user's package home.
    await cp(path.join(packageRoot, 'dist'), path.join(stagedPackage, 'dist'), { recursive: true });
    await copyFile(path.join(packageRoot, 'package.json'), path.join(stagedPackage, 'package.json'));
    await symlink(path.join(packageRoot, 'node_modules'), path.join(stagedPackage, 'node_modules'), 'junction');
    // pnpm hoists some direct dependencies (for example axios) at workspace
    // root; reproduce that lookup without mutating either dependency tree.
    await symlink(path.resolve(packageRoot, '../../node_modules'), path.join(root, 'node_modules'), 'junction');
    expectSuccess(runPackageSeed());
    const guides = ['AGENTS.md', 'agentcontext/README.md', 'agentcontext/happyherd-cli.md'];
    const initial = await Promise.all(guides.map(file => readFile(path.join(happyherdHome, file), 'utf8')));
    expect(initial[0]).toContain('agentcontext/README.md');
    expect(initial[1]).toContain('happyherd-cli.md');
    expect(initial[2]).toContain('happyherd session send');
    expectSuccess(runPackageSeed());
    expect(await Promise.all(guides.map(file => readFile(path.join(happyherdHome, file), 'utf8')))).toEqual(initial);

    const privateFiles = ['commanders/private/COMMANDER.md', 'commanders/private/agentcontext/memory/1-working-memory.md'];
    const existingFiles = [...guides, ...privateFiles];
    for (const file of existingFiles) {
      await mkdir(path.dirname(path.join(happyherdHome, file)), { recursive: true });
      await writeFile(path.join(happyherdHome, file), `Owner content: ${file}\n`);
    }
    expectSuccess(runPackageSeed());
    for (const file of existingFiles) {
      expect(await readFile(path.join(happyherdHome, file), 'utf8')).toBe(`Owner content: ${file}\n`);
    }
    for (const state of ['access.key', 'agent.key', 'daemon.state.json', 'sessions.json']) {
      expect(existsSync(path.join(happyherdHome, state))).toBe(false);
    }
  }, 30_000);
});
