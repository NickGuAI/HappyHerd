#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function isProposalPath(relative) {
  const parts = relative.split(path.sep);
  return parts.some((part, index) => part === 'rules' && parts[index + 1] === 'proposals');
}

async function exists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function filesUnder(root) {
  const result = [];
  async function visit(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      if (entry.isFile() && /\.(?:md|json|jsonl)$/.test(entry.name)) result.push(candidate);
    }
  }
  await visit(root);
  return result.sort();
}

export async function checkAgentContextAuthority(root, options = {}) {
  const findings = [];
  if (await exists(path.join(root, 'commander'))) {
    findings.push('retired singular Commander root exists');
  }
  for (const filePath of await filesUnder(root)) {
    const relative = path.relative(root, filePath);
    const isKnowledgeAuthority = relative === 'AGENTS.md'
      || relative === 'CLAUDE.md'
      || relative.startsWith(`agentcontext${path.sep}`)
      || relative.startsWith(`commanders${path.sep}`);
    if (!isKnowledgeAuthority) continue;
    if (isProposalPath(relative)) continue;
    if (relative === path.join('agentcontext', 'migration-manifest.json')) continue;
    const content = await readFile(filePath, 'utf8');
    if (/(?:~|\$HOME|\$\{HOME\}|\/home\/[^/]+)\/\.herd(?:\/|\b)/.test(content)) {
      findings.push(`${relative}: live .herd pointer`);
    }
    if (/(?:~|\$HOME|\$\{HOME\}|\/home\/[^/]+)\/\.happyherd\/commander(?:\/|\b)/.test(content)) {
      findings.push(`${relative}: retired singular HappyHerd Commander pointer`);
    }
    if (/(?:~|\/home\/[^/]+)\/tasks\/(?:<task>|<slug>|archive)(?:\/|\b)/.test(content)) {
      findings.push(`${relative}: deprecated task lifecycle path`);
    }
    if (/sign-?off is always [“"']?Nick/i.test(content)) {
      findings.push(`${relative}: unconditional Nick signature rule`);
    }
    if (/^agentcontext\/automations\/[0-9a-f-]+\.json$/.test(relative)) {
      const definition = JSON.parse(content);
      const runtimeFields = ['history', 'lastRun', 'totalCostUsd', 'totalRuns']
        .filter((field) => Object.hasOwn(definition, field));
      if (runtimeFields.length > 0) {
        findings.push(`${relative}: excluded runtime fields remain: ${runtimeFields.join(', ')}`);
      }
      if (definition.agentType && definition.agentType !== 'codex') {
        findings.push(`${relative}: automation provider is ${definition.agentType}, expected codex`);
      }
    }
  }
  const manifestPath = path.join(root, 'agentcontext', 'migration-manifest.json');
  if (!(await exists(manifestPath))) {
    findings.push('migration manifest is missing');
  } else {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    for (const record of manifest.files ?? []) {
      if (record.normalizedSourceSha256 !== record.normalizedDestinationSha256) {
        findings.push(`${record.destination}: normalized migration parity failed`);
      }
      if (record.category === 'automation-definition' && !Array.isArray(record.transforms)) {
        findings.push(`${record.destination}: automation migration transforms are not recorded`);
      }
      if (options.verifyMigrationSnapshot === true) {
        const destinationPath = path.resolve(record.destination ?? '');
        const destinationRelative = path.relative(root, destinationPath);
        if (
          !record.destination
          || destinationRelative.startsWith(`..${path.sep}`)
          || path.isAbsolute(destinationRelative)
          || isProposalPath(destinationRelative)
        ) {
          findings.push(`${record.destination ?? '(missing)'}: invalid manifest destination`);
          continue;
        }
        try {
          const currentDestination = await readFile(destinationPath, 'utf8');
          if (sha256(currentDestination) !== record.destinationSha256) {
            findings.push(`${destinationRelative}: current content differs from migration manifest`);
          }
        } catch (error) {
          findings.push(`${destinationRelative}: cannot verify manifest destination (${error?.code ?? 'read error'})`);
        }
      }
    }
  }
  return findings;
}

async function main() {
  const rootArgument = process.argv.indexOf('--root');
  const root = path.resolve(rootArgument >= 0 ? process.argv[rootArgument + 1] : path.join(os.homedir(), '.happyherd'));
  const findings = await checkAgentContextAuthority(root, {
    verifyMigrationSnapshot: process.argv.includes('--verify-migration-snapshot'),
  });
  if (findings.length > 0) {
    console.error(findings.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ root, status: 'ok' }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
