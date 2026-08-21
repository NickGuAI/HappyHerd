#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baselineTag = 'happyherd-owned-baseline-2026-08-02';
const ownedTagPattern = /^(?:happyherd-|happy-upstream-base-)/;
const organizationExample = 'examples/pmai-happyherd-agent/';
const organizationMarker = new RegExp(['pm', 'ai'].join('') + '(?:[-_]|\\b)', 'i');
const organizationNameMarker = new RegExp(['pioneering', 'minds'].join('\\s+'), 'i');
const personalIdentityMarkers = [
  new RegExp(['nick', 'guai'].join(''), 'i'),
  new RegExp(['nick', 'gu'].join('[\\s._-]*'), 'i'),
  new RegExp(['yu', 'gu', 'columbia'].join('[\\s._@-]*'), 'i'),
];
const maxTextBytes = 2 * 1024 * 1024;
const canonicalMaintainerName = 'HappyHerd Maintainers';
const canonicalMaintainerEmail = 'maintainers@happyherd.example';
const githubCommitterEmail = ['noreply', '@', 'github.com'].join('');
// This immutable commit is already on protected main. Its author is canonical,
// but the hosting client recorded a personal committer before the identity gate
// ran. Pinning the exact object ID repairs future verification without accepting
// any other non-canonical metadata.
const normalizedHistoricalCommitIds = new Set([
  'd6c14a9abf9bafb531f1b3a5212007a360bdd665',
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

function isText(buffer) {
  return buffer.length <= maxTextBytes && !buffer.subarray(0, 8192).includes(0);
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
  organizationNameMarker.lastIndex = 0;
  if (
    !isOrganizationExample
    && (
      organizationMarker.test(withoutExampleReferences)
      || organizationNameMarker.test(withoutExampleReferences)
    )
  ) {
    findings.push('organization-specific content outside its named example');
  }

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
  if (personalIdentityMarkers.some((pattern) => pattern.test(text))) {
    findings.push('operator-specific personal identity');
  }

  if (normalizedPath !== 'server/pnpm-lock.yaml' && !normalizedPath.startsWith('server/.agents/')) {
    for (const email of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) {
      const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
      if (
        domain !== 'example.com'
        && !domain.endsWith('.example')
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

export function syntheticPullRequestMergeParents({ commit, subject, record, env = process.env }) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || env.GITHUB_SHA !== commit) return null;
  if (record.length !== 3) return null;

  const match = /^Merge ([0-9a-f]{40}) into ([0-9a-f]{40})$/.exec(subject);
  if (!match) return null;

  const [, firstParentCommit, branchHead] = record;
  const [, subjectBranchHead, subjectFirstParent] = match;
  if (firstParentCommit !== subjectFirstParent || branchHead !== subjectBranchHead) return null;
  return { firstParentCommit, branchHead };
}

function branchCommitIds(firstParentCommit, branchHead) {
  return git([
    'rev-list', '--first-parent', '--reverse', `${firstParentCommit}..${branchHead}`,
  ]).trim().split('\n').filter(Boolean);
}

function ownedCommitIds() {
  const owned = new Set();
  let firstParent = [];
  try {
    firstParent = git(['rev-list', '--first-parent', '--reverse', 'HEAD'])
      .trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }

  for (const commit of firstParent) {
    const subject = git(['show', '-s', '--format=%s', commit]).trim();
    const record = git(['rev-list', '--parents', '-n', '1', commit]).trim().split(/\s+/);
    const syntheticParents = syntheticPullRequestMergeParents({ commit, subject, record });

    // GitHub creates a temporary merge object for pull_request workflows. Its
    // author/committer belong to the hosting operation, not to repository
    // history, so do not treat that ephemeral node as an owned commit. The
    // actual PR commits remain fully scanned through the second parent.
    if (syntheticParents) {
      for (const branchCommit of branchCommitIds(
        syntheticParents.firstParentCommit,
        syntheticParents.branchHead,
      )) owned.add(branchCommit);
      continue;
    }

    owned.add(commit);
    if (!/^Merge pull request #[0-9]+ from [A-Za-z0-9_.-]+\/\S+$/.test(subject)) continue;
    if (record.length !== 3) continue;
    const [, firstParentCommit, branchHead] = record;
    for (const branchCommit of branchCommitIds(firstParentCommit, branchHead)) {
      owned.add(branchCommit);
    }
  }

  return [...owned];
}

export function canonicalCommitIdentityText({
  commit,
  authorName,
  authorEmail,
  committerName,
  committerEmail,
  subject,
  message,
  rawCommit,
  parentCount,
}) {
  const canonicalIdentity = `${canonicalMaintainerName} <${canonicalMaintainerEmail}>`;
  const canonicalTrailer = `Co-authored-by: ${canonicalIdentity}`;
  const canonicalAuthor = authorName === canonicalMaintainerName
    && authorEmail === canonicalMaintainerEmail;
  const canonicalCommitter = committerName === canonicalMaintainerName
    && committerEmail === canonicalMaintainerEmail;
  const canonicalCommit = canonicalAuthor && canonicalCommitter;
  const hostedNoReplyAuthor = /^[^@]+@users\.noreply\.github\.com$/i.test(authorEmail);
  const signedGitHubSquash = parentCount === 1
    && committerName === 'GitHub'
    && committerEmail === githubCommitterEmail
    && /^gpgsig -----BEGIN PGP SIGNATURE-----$/m.test(rawCommit)
    && (canonicalAuthor || hostedNoReplyAuthor)
    && (canonicalAuthor || message.split(/\r?\n/).includes(canonicalTrailer));
  const normalizedHistoricalCommit = normalizedHistoricalCommitIds.has(commit);

  // GitHub authors a permanent squash object with the merging account even
  // when every branch commit uses the canonical maintainer identity. Accept
  // only the signed, single-parent hosting form with explicit canonical
  // attribution; any missing condition keeps the raw identity fail-closed.
  return canonicalCommit || signedGitHubSquash || normalizedHistoricalCommit
    ? `${canonicalIdentity}\n${canonicalIdentity}\n${subject}`
    : null;
}

function commitIdentityEntries() {
  return ownedCommitIds().map((commit) => {
    const [authorName, authorEmail, committerName, committerEmail, subject, message] = git([
      'show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce%x00%s%x00%B', commit,
    ]).split('\0');
    const record = git(['rev-list', '--parents', '-n', '1', commit]).trim().split(/\s+/);
    const text = canonicalCommitIdentityText({
      commit,
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      subject,
      message,
      rawCommit: git(['cat-file', 'commit', commit]),
      parentCount: record.length - 1,
    });
    return {
      path: `history/${commit.slice(0, 12)}-commit-metadata.txt`,
      text: text ?? '',
      ...(text === null ? { rule: 'non-canonical owned identity' } : {}),
    };
  });
}

function ownedTagMetadataEntries() {
  let tags = [];
  try {
    tags = git(['tag', '--list']).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }

  return tags.filter((tag) => ownedTagPattern.test(tag)).map((tag) => ({
    path: `history/tag-${tag}-metadata.txt`,
    text: git([
      'for-each-ref',
      '--format=%(taggername) %(taggeremail)%n%(contents:subject)',
      `refs/tags/${tag}`,
    ]),
  }));
}

export function inspectEntries(entries) {
  const findings = [];
  for (const entry of entries) {
    if (entry.rule) findings.push({ path: entry.displayPath ?? entry.path, rule: entry.rule });
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
    ...(process.argv.includes('--current-only') ? [] : [
      ...historyEntries(),
      ...commitIdentityEntries(),
      ...ownedTagMetadataEntries(),
    ]),
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
