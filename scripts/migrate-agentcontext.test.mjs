import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { migrateAgentContext } from './migrate-agentcontext.mjs';
import { checkAgentContextAuthority } from './check-agentcontext-authority.mjs';

test('copies only allowlisted knowledge and records root-normalized parity', async () => {
  const sourceHome = await mkdtemp(path.join(os.tmpdir(), 'happyherd-migration-'));
  const herdRoot = path.join(sourceHome, '.herd');
  const destinationRoot = path.join(sourceHome, '.happyherd');
  const commanderId = 'd66a5217-ace6-4f00-b2ac-bbd64a9a7e7e';

  await mkdir(path.join(herdRoot, 'agentcontext', 'rules', 'proposals'), { recursive: true });
  await mkdir(path.join(herdRoot, 'agentcontext', 'automations', commanderId), { recursive: true });
  await mkdir(path.join(herdRoot, 'commanders', commanderId, 'agentcontext', 'memory'), { recursive: true });
  await mkdir(path.join(herdRoot, 'commanders', commanderId, 'agentcontext', 'rules'), { recursive: true });
  await mkdir(path.join(herdRoot, 'commanders', commanderId, 'agentcontext', 'rules', 'proposals'), { recursive: true });
  await writeFile(path.join(sourceHome, 'AGENTS.md'), 'Read ~/.herd/agentcontext/USER.md\n');
  await writeFile(path.join(herdRoot, 'agentcontext', 'USER.md'), 'Canonical: $HOME/.herd\n');
  await writeFile(path.join(herdRoot, 'agentcontext', 'rules', 'proposals', 'secret.md'), 'exclude\n');
  await writeFile(path.join(herdRoot, 'agentcontext', 'automations', `${commanderId}.json`), JSON.stringify({
    agentType: 'codex',
    instruction: 'Read ~/.herd/agentcontext/USER.md',
    history: [{ status: 'success' }],
    lastRun: '2026-08-07T00:00:00.000Z',
    totalRuns: 1,
    totalCostUsd: 0.25,
  }));
  await writeFile(path.join(herdRoot, 'agentcontext', 'automations', commanderId, 'memory.md'), 'runtime\n');
  await writeFile(
    path.join(herdRoot, 'commanders', commanderId, 'COMMANDER.md'),
    'Workspace: `/tmp`\nRead ~/.herd/commander/example/COMMANDER.md\n',
  );
  await writeFile(path.join(herdRoot, 'commanders', commanderId, 'agentcontext', 'memory', '1-working-memory.md'), 'active lane\n');
  await writeFile(
    path.join(herdRoot, 'commanders', commanderId, 'agentcontext', 'rules', 'proposals', 'private.md'),
    'exclude private proposal\n',
  );
  await writeFile(path.join(herdRoot, 'commanders', commanderId, 'avatar.png'), 'not an image');

  const manifest = await migrateAgentContext({ sourceHome, herdRoot, destinationRoot, apply: true });
  assert.equal(manifest.files.length, 5);
  assert.ok(manifest.files.every((record) => record.normalizedSourceSha256 === record.normalizedDestinationSha256));
  assert.match(await readFile(path.join(destinationRoot, 'AGENTS.md'), 'utf8'), /~\/\.happyherd\/agentcontext/);
  assert.match(
    await readFile(path.join(destinationRoot, 'commanders', commanderId, 'COMMANDER.md'), 'utf8'),
    /~\/\.happyherd\/commanders\/example\/COMMANDER\.md/,
  );
  const migratedAutomation = JSON.parse(await readFile(
    path.join(destinationRoot, 'agentcontext', 'automations', `${commanderId}.json`),
    'utf8',
  ));
  assert.equal(migratedAutomation.agentType, 'codex');
  assert.match(migratedAutomation.instruction, /~\/\.happyherd\/agentcontext/);
  assert.equal('history' in migratedAutomation, false);
  assert.equal('lastRun' in migratedAutomation, false);
  assert.deepEqual(
    manifest.files.find((record) => record.category === 'automation-definition')?.transforms,
    [{
      type: 'exclude-automation-run-state',
      fields: ['history', 'lastRun', 'totalCostUsd', 'totalRuns'],
    }],
  );
  await assert.rejects(readFile(path.join(destinationRoot, 'agentcontext', 'rules', 'proposals', 'secret.md')));
  await assert.rejects(readFile(
    path.join(destinationRoot, 'commanders', commanderId, 'agentcontext', 'rules', 'proposals', 'private.md'),
  ));
  await assert.rejects(readFile(path.join(destinationRoot, 'agentcontext', 'automations', commanderId, 'memory.md')));
  await assert.rejects(readFile(path.join(destinationRoot, 'commanders', commanderId, 'avatar.png')));

  assert.deepEqual(await checkAgentContextAuthority(destinationRoot, { verifyMigrationSnapshot: true }), []);
  await writeFile(path.join(destinationRoot, 'agentcontext', 'USER.md'), 'unexpected drift\n');
  assert.match(
    (await checkAgentContextAuthority(destinationRoot, { verifyMigrationSnapshot: true })).join('\n'),
    /current content differs from migration manifest/,
  );
});
