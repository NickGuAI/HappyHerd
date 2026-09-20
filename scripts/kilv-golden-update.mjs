// Regenerate from the exact pushed PR revision in CI's Linux browser, including
// a comparison run that failed because its old baselines no longer match.
// Requires read-only Actions access; never commits, pushes, or bypasses the gate.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { repoRoot } from './kilv-capture/common.mjs';
const repo = 'NickGuAI/HappyHerd';
const run = (command, args) => execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8' }).trim();
const sha = run('git', ['rev-parse', 'HEAD']);
let workflow;
const deadline = Date.now() + 45 * 60 * 1000;
while (Date.now() < deadline) {
    const runs = JSON.parse(run('gh', ['run', 'list', '--repo', repo, '--workflow', 'quality-gates.yml', '--event', 'pull_request', '--commit', sha, '--limit', '20', '--json', 'databaseId,headSha,status,conclusion,url']));
    workflow = runs[0];
    if (workflow?.status === 'completed') break;
    await new Promise(done => setTimeout(done, 15000));
}
if (!workflow || workflow.status !== 'completed' || workflow.headSha !== sha) throw new Error('No completed PR comparison on this SHA; push the source and ensure PR CI can run');
console.log(`Capture run: ${workflow.url} (${workflow.conclusion})`);
const temp = mkdtempSync(resolve(tmpdir(), 'kilv-baselines-'));
try {
    run('gh', ['run', 'download', String(workflow.databaseId), '--repo', repo, '--name', `kilv-golden-${workflow.databaseId}`, '--dir', temp]);
    const summary = JSON.parse(readFileSync(resolve(temp, 'summary.json')));
    if (summary.sourceRevision !== sha || summary.variants !== 28 || summary.mode !== 'compare') throw new Error('Expected a complete, normal comparison capture on this revision (not a sensitivity probe)');
    const destination = resolve(repoRoot, 'docs/acceptance/issue-287/golden');
    mkdirSync(destination, { recursive: true });
    for (const group of ['production', 'routes']) {
        const manifest = JSON.parse(readFileSync(resolve(temp, group, 'manifest.json')));
        for (const { filename } of manifest) copyFileSync(resolve(temp, group, filename), resolve(destination, `${group}-${filename}`));
    }
    console.log(`Regenerated 28 baselines from ${sha}. Review and commit with an owned-patches.tsv entry.`);
} finally {
    rmSync(temp, { recursive: true, force: true });
}
