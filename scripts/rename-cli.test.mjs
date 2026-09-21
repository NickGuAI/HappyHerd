import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { renameText } from './rename-cli.mjs';

test('case-safe one-pass replacement preserves nested target names', () => {
  assert.equal(renameText('happy Happy HAPPY happyherd HappyHerd HAPPYHERD happyHerd', 'Happy', 'HappyHerd'),
    'happyherd HappyHerd HAPPYHERD happyherd HappyHerd HAPPYHERD happyHerd');
  assert.equal(renameText('HappyHerd happyherd HAPPYHERD happyHerd', 'HappyHerd', 'Meadow'), 'Meadow meadow MEADOW meadow');
  assert.equal(renameText('Happy EnCoder happy-agent Happy', 'Happy', 'HappyHerd', ['Happy EnCoder', 'happy-agent']), 'Happy EnCoder happy-agent HappyHerd');
});

test('full baseline repository supports two consecutive tracked renames with binary/provenance integrity', () => {
  const root = resolve(import.meta.dirname, '..');
  const temp = mkdtempSync(join(tmpdir(), 'cli-rename-'));
  try {
    // Base revision contains the first name and pre-existing target substrings.
    const archive = join(temp, 'baseline.tar');
    execFileSync('git', ['archive', '--output', archive, process.env.CLI_RENAME_BASE ?? 'c1dd1b1e'], { cwd: root });
    execFileSync('tar', ['-xf', archive, '-C', temp]);
    rmSync(archive);
    execFileSync('git', ['init', '-q'], { cwd: temp });
    // git archive contains tracked files, including files matched by ignore rules.
    execFileSync('git', ['add', '--force', '.'], { cwd: temp });
    mkdirSync(join(temp, 'scripts'), { recursive: true });
    writeFileSync(join(temp, 'scripts/cli-rename-scope.json'), readFileSync(join(root, 'scripts/cli-rename-scope.json')));
    const run = (from, to) => execFileSync(process.execPath, [join(root, 'scripts/rename-cli.mjs'), '--root', temp, '--from', from, '--to', to, '--apply']);
    const originalLicense = readFileSync(join(temp, 'LICENSE'));
    const originalChangelog = readFileSync(join(temp, 'server/packages/happy-app/CHANGELOG.md'));
    // Assert every packaged binary, not just text snapshots.
    const binaries = execFileSync('git', ['ls-files', 'server/packages/happy-cli/tools'], { cwd: temp, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const bytes = binaries.map((path) => [path, readFileSync(join(temp, path))]);
    const ignoredTracked = execFileSync('git', ['ls-files', '--cached', '--ignored', '--exclude-standard', 'server/packages/happy-cli'], { cwd: temp, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    assert(ignoredTracked.includes('server/packages/happy-cli/CLAUDE.md'));
    assert(ignoredTracked.includes('server/packages/happy-cli/.env.dev'));
    run('Happy', 'HappyHerd');
    for (const file of ['apiMachine.ts', 'apiSession.ts']) {
      assert.match(readFileSync(join(temp, 'server/packages/happyherd-cli/src/api', file), 'utf8'), /\bhappyClient:/);
    }
    assert(existsSync(join(temp, 'server/packages/happyherd-cli/bin/happyherd.mjs')));
    assert(!existsSync(join(temp, 'server/packages/happyherd-cli/bin/happy.mjs')));
    const manifest = JSON.parse(readFileSync(join(temp, 'server/packages/happyherd-cli/package.json')));
    assert.equal(manifest.name, '@happyherd/cli');
    assert.deepEqual(Object.keys(manifest.bin).sort(), ['happyherd', 'happyherd-agent-codex-policy', 'happyherd-agent-mcp', 'happyherd-mcp']);
    execFileSync('git', ['add', '-A'], { cwd: temp });
    const firstTracked = execFileSync('git', ['ls-files'], { cwd: temp, encoding: 'utf8' }).split('\n');
    for (const path of ignoredTracked) assert(firstTracked.includes(path.replace('/happy-cli/', '/happyherd-cli/')), path);
    run('HappyHerd', 'Meadow');
    for (const file of ['apiMachine.ts', 'apiSession.ts']) {
      assert.match(readFileSync(join(temp, 'server/packages/meadow-cli/src/api', file), 'utf8'), /\bhappyClient:/);
    }
    assert(existsSync(join(temp, 'server/packages/meadow-cli/bin/meadow.mjs')));
    assert.equal(JSON.parse(readFileSync(join(temp, 'server/packages/meadow-cli/package.json'))).name, '@meadow/cli');
    assert.match(readFileSync(join(temp, 'AGENTS.md'), 'utf8'), /https:\/\/github.com\/slopus\/happy.git/);
    assert.deepEqual(readFileSync(join(temp, 'LICENSE')), originalLicense);
    assert.deepEqual(readFileSync(join(temp, 'server/packages/happy-app/CHANGELOG.md')), originalChangelog);
    for (const [path, expected] of bytes) assert.deepEqual(readFileSync(join(temp, path.replace('/happy-cli/', '/meadow-cli/'))), expected);
    execFileSync('git', ['add', '-A'], { cwd: temp });
    const secondTracked = execFileSync('git', ['ls-files'], { cwd: temp, encoding: 'utf8' }).split('\n');
    for (const path of ignoredTracked) {
      const destination = path.replace('/happy-cli/', '/meadow-cli/');
      assert(secondTracked.includes(destination), destination);
      assert(existsSync(join(temp, destination)), destination);
      assert(!existsSync(join(temp, path.replace('/happy-cli/', '/happyherd-cli/'))), path);
    }
    const idempotent = execFileSync(process.execPath, [join(root, 'scripts/rename-cli.mjs'), '--root', temp, '--from', 'HappyHerd', '--to', 'Meadow', '--check'], { encoding: 'utf8' });
    assert.match(idempotent, /0 files need renaming/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('destination collision fails before mutating source', async () => {
  const { planRename } = await import('./rename-cli.mjs');
  const root = mkdtempSync(join(tmpdir(), 'cli-collision-'));
  try {
    mkdirSync(join(root, 'server/packages/happy-cli'), { recursive: true });
    mkdirSync(join(root, 'server/packages/happyherd-cli'), { recursive: true });
    writeFileSync(join(root, 'server/packages/happy-cli/file'), 'Happy');
    writeFileSync(join(root, 'server/packages/happyherd-cli/file'), 'existing');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    assert.throws(() => planRename(root, 'Happy', 'HappyHerd', { owned: [], exclude: [], preserve: [] }), /collision/);
    assert.equal(readFileSync(join(root, 'server/packages/happy-cli/file'), 'utf8'), 'Happy');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
