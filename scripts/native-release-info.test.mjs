import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./native-release-info.mjs', import.meta.url));
test('archive and release notes retain built revision and independent package versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'happyherd-release-info-'));
  try {
    const source = join(root, 'source');
    mkdirSync(source);
    execFileSync('git', ['init', '-q', source]);
    execFileSync('git', ['-C', source, '-c', 'user.name=HappyHerd Maintainers', '-c', 'user.email=maintainers@happyherd.example', 'commit', '-q', '--allow-empty', '-m', 'fixture']);
    const revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const runtime = join(root, 'happyherd/runtime');
    mkdirSync(join(runtime, 'node_modules/happyherd-server-self-host'), { recursive: true });
    writeFileSync(join(runtime, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(join(runtime, 'node_modules/happyherd-server-self-host/package.json'), JSON.stringify({ version: '1.1.0' }));
    for (const target of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']) {
      execFileSync(process.execPath, [script, 'build', source, runtime, target]);
      const info = JSON.parse(readFileSync(join(runtime, 'build-info.json'), 'utf8'));
      assert.deepEqual(info, { revision, target, cliVersion: '1.2.3', serverVersion: '1.1.0', nodeVersion: process.version });
      execFileSync('tar', ['-czf', join(root, `happyherd-${target}.tar.gz`), '-C', root, 'happyherd']);
    }
    const notes = execFileSync(process.execPath, [script, 'notes', 'happyherd-v1.2.4', root], { encoding: 'utf8' });
    assert.match(notes, /Installer release: `happyherd-v1\.2\.4`/);
    assert.match(notes, new RegExp(`/tree/${revision}`));
    assert.equal((notes.match(/\| 1\.2\.3 \| 1\.1\.0 \|/g) || []).length, 4);
    assert.match(notes, /macOS GUI.*iOS.*not distributed/);
    assert.match(notes, /does not establish.*first-task/);
    assert.ok(!notes.includes('/releases/latest/'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
