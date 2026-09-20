// Use the same Linux runner and lockfile-pinned Chromium as the blocking gate.
// Requires gh authentication and a pushed branch; never commits or pushes.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { repoRoot } from './kilv-capture/common.mjs';
const repo = 'NickGuAI/HappyHerd';
const run = (command, args) => execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const ref = process.argv[2] || run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
const sha = run('git', ['rev-parse', 'HEAD']);
const remoteSha = JSON.parse(run('gh', ['api', `repos/${repo}/commits/${ref}`])).sha;
if (sha !== remoteSha) throw new Error(`Push your intended source first: local ${sha}, ${ref} ${remoteSha}`);
const request = `kilv-regenerate-${randomUUID()}`;
run('gh', ['workflow', 'run', 'quality-gates.yml', '--repo', repo, '--ref', ref, '-f', 'golden_mode=regenerate', '-f', `golden_request=${request}`]);
let workflow;
const deadline = Date.now() + 45 * 60 * 1000;
while (Date.now() < deadline) {
    const runs = JSON.parse(run('gh', ['run', 'list', '--repo', repo, '--workflow', 'quality-gates.yml', '--event', 'workflow_dispatch', '--limit', '30', '--json', 'databaseId,displayTitle,headSha,status,conclusion,url']));
    workflow = runs.find(item => item.displayTitle.endsWith(request));
    if (workflow?.status === 'completed') break;
    await new Promise(done => setTimeout(done, 15000));
}
if (!workflow || workflow.status !== 'completed' || workflow.headSha !== sha) throw new Error('Regeneration did not finish on the requested SHA');
console.log(`Regeneration run: ${workflow.url} (${workflow.conclusion})`);
// A failed unrelated suite must still be fixed, but cannot substitute for or
// manufacture the explicitly uploaded successful regeneration artifact.
const temp = mkdtempSync(resolve(tmpdir(), 'kilv-baselines-'));
try {
    run('gh', ['run', 'download', String(workflow.databaseId), '--repo', repo, '--name', `kilv-baselines-${workflow.databaseId}`, '--dir', temp]);
    const files = readdirSync(temp).filter(name => name.endsWith('.png'));
    if (files.length !== 28) throw new Error(`Incomplete baseline artifact: ${files.length}`);
    const destination = resolve(repoRoot, 'docs/acceptance/issue-287/golden');
    mkdirSync(destination, { recursive: true });
    for (const file of files) copyFileSync(resolve(temp, file), resolve(destination, file));
    console.log(`Downloaded ${files.length} baselines from ${sha}. Review and commit with an owned-patches.tsv entry.`);
} finally {
    rmSync(temp, { recursive: true, force: true });
}
