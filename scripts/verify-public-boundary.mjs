#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baselineTag = 'happyherd-owned-baseline-2026-08-02';
const organizationExample = 'examples/pmai-happyherd-agent/';
const organizationMarker = new RegExp(['pm', 'ai'].join('') + '(?:[-_]|\\b)', 'i');
const maxTextBytes = 2 * 1024 * 1024;

// Hash exact private identifiers so the denylist does not reproduce them in
// the public source it protects. Labels describe the class, never the value.
const forbiddenTokenDigests = new Map([
  ['5d0e4fa0973bc777d16d5a8ba3101018e7e7b051bb2497a10e7abff6c78cf8bf', 'personal repository owner'],
  ['eff24d49d883b4c51cc6324154c5d2e4a7848a00014de7519ee751eb0826bed9', 'private infrastructure name'],
  ['4eae95b5f193ff6ebab5fdd60975eff022b47ec1d5237f4bb1c95eb5dfb35fb9', 'private infrastructure domain'],
  ['555e0c8e02ffa6fac93197636c4df86abc47b011c4f4f8125b984ff4fd514619', 'private deployment nickname'],
  ['e40d9ee0f679bea99929df03c2e101a489e1eb0bd7b797d6f5cfb9847cc42951', 'operator account name'],
  ['af935c5d4ab604ac4dc3797ad367d25f565bff78e364fbec5270ac6e04342acb', 'private object-store bucket'],
]);

const secretPatterns = [
  ['OpenAI-style secret', /\bsk-(?:proj|ant|live|test)-[A-Za-z0-9_-]{16,}\b/g],
  ['Brevo-style secret', /\bxkeysib-[A-Za-z0-9_-]{24,}\b/g],
  ['Tavily-style secret', /\btvly-(?:dev|prod)-[A-Za-z0-9_-]{16,}\b/g],
  ['GitHub-style secret', /\bgh[opusr]_[A-Za-z0-9]{20,}\b/g],
  ['Vercel-style secret', /\bvcp_[A-Za-z0-9_-]{20,}\b/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{30,}\b/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['Discord-style token', /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,}\b/g],
];

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: options.binary ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function nulList(value) {
  return value.split('\0').filter(Boolean);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isText(buffer) {
  return buffer.length <= maxTextBytes && !buffer.subarray(0, 8192).includes(0);
}

function tokenFindings(text) {
  const findings = [];
  for (const token of text.match(/[A-Za-z0-9][A-Za-z0-9_.-]{2,}/g) ?? []) {
    const label = forbiddenTokenDigests.get(sha256(token.toLowerCase()));
    if (label) findings.push(label);
  }
  return findings;
}

function inspectText(path, text) {
  const findings = [];
  const normalizedPath = path.replaceAll('\\', '/');
  const isOrganizationExample = normalizedPath.startsWith(organizationExample);

  if (/\.env(?:\.|$)/i.test(normalizedPath) && !/\.env\.example$/i.test(normalizedPath)) {
    findings.push('tracked environment file is not an example');
  }
  if (!isOrganizationExample && organizationMarker.test(normalizedPath)) {
    findings.push('organization-specific path outside its named example');
  }

  const withoutExampleReferences = text.replaceAll(organizationExample, '');
  organizationMarker.lastIndex = 0;
  if (!isOrganizationExample && organizationMarker.test(withoutExampleReferences)) {
    findings.push('organization-specific content outside its named example');
  }

  findings.push(...tokenFindings(text));

  for (const match of text.matchAll(/\/home\/([A-Za-z0-9._-]+)/g)) {
    if (!['user', 'example-user', 'runner', 'me', 'test', 'second'].includes(match[1].toLowerCase())
      && !match[1].startsWith('.')) {
      findings.push('operator-specific POSIX home path');
    }
  }
  for (const match of text.matchAll(/[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)/gi)) {
    if (!['user', 'exampleuser'].includes(match[1].toLowerCase())) {
      findings.push('operator-specific Windows home path');
    }
  }
  if (/\.happyherd\/commanders\/[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(text)) {
    findings.push('concrete private Commander identifier');
  }

  if (normalizedPath !== 'server/pnpm-lock.yaml' && !normalizedPath.startsWith('server/.agents/')) {
    for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
      const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
      if (
        domain !== 'example.com'
        && domain !== 'users.noreply.github.com'
        && !domain.endsWith('.invalid')
        && !domain.endsWith('.local')
      ) {
        findings.push('non-example email address');
      }
    }
  }
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(label);
  }
  return [...new Set(findings)];
}

export function inspectEntries(entries) {
  const findings = [];
  for (const entry of entries) {
    for (const rule of inspectText(entry.path, entry.text)) {
      findings.push({ path: entry.displayPath ?? entry.path, rule });
    }
  }
  return findings;
}

function currentOwnedPaths() {
  const tracked = nulList(git(['ls-files', '-z']));
  let changed = [];
  try {
    git(['rev-parse', '--verify', `${baselineTag}^{commit}`]);
    changed = nulList(git(['diff', '--name-only', '-z', baselineTag, '--']));
  } catch {
    changed = tracked;
  }
  const untracked = nulList(git(['ls-files', '--others', '--exclude-standard', '-z']));
  return [...new Set([
    ...tracked.filter((path) => !path.startsWith('server/')),
    ...changed,
    ...untracked,
  ])].sort();
}

function currentEntries() {
  const entries = [];
  for (const path of currentOwnedPaths()) {
    try {
      const buffer = readFileSync(resolve(repoRoot, path));
      if (isText(buffer)) entries.push({ path, text: buffer.toString('utf8') });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return entries;
}

function historyEntries() {
  let commits = [];
  try {
    // Inspect the distribution's first-parent series. Merged upstream commits
    // are independently constrained to the trusted public remote by the patch
    // discipline gate; scanning their raw, unprefixed source would incorrectly
    // classify upstream contributor identities as HappyHerd-owned content.
    commits = git(['rev-list', '--first-parent', '--reverse', `${baselineTag}..HEAD`]).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const entries = [];
  for (const commit of commits) {
    const paths = nulList(git(['diff-tree', '--no-commit-id', '--name-only', '--diff-filter=AMCR', '-r', '-z', commit]));
    for (const path of paths) {
      let buffer;
      try {
        buffer = git(['show', `${commit}:${path}`], { binary: true });
      } catch {
        continue;
      }
      if (isText(buffer)) entries.push({
        path,
        displayPath: `${commit.slice(0, 12)}:${path}`,
        text: buffer.toString('utf8'),
      });
    }
  }
  return entries;
}

function main() {
  const findings = inspectEntries([
    ...currentEntries(),
    ...(process.argv.includes('--current-only') ? [] : historyEntries()),
  ]);
  if (findings.length > 0) {
    for (const finding of findings.slice(0, 100)) {
      process.stderr.write(`public-boundary: ${finding.path}: ${finding.rule}\n`);
    }
    if (findings.length > 100) {
      process.stderr.write(`public-boundary: ${findings.length - 100} additional findings omitted\n`);
    }
    process.exit(1);
  }
  process.stdout.write('public-boundary: ok\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
