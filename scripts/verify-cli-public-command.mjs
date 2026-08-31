#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cliRoot = join(root, 'server/packages/happy-cli');
const retiredWrapper = join(root, 'server/packages/happyherd-cli');
const manifest = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const workspaceManifest = JSON.parse(readFileSync(join(root, 'server/package.json'), 'utf8'));
const workspaceYaml = readFileSync(join(root, 'server/pnpm-workspace.yaml'), 'utf8');
const cliSmokeWorkflow = readFileSync(join(root, 'server/.github/workflows/cli-smoke-test.yml'), 'utf8');
const qualityWorkflow = readFileSync(join(root, '.github/workflows/quality-gates.yml'), 'utf8');
const hostInstaller = readFileSync(join(root, 'scripts/install-host-cli.sh'), 'utf8');

assert.equal(manifest.name, '@happyherd/cli', 'the maintained CLI must own @happyherd/cli');
assert.equal(manifest.publishConfig?.access, 'public', '@happyherd/cli must publish publicly');
assert.equal(manifest.engines?.node, '>=20', 'the public CLI must reject unsupported Node releases');
assert.equal(manifest.bin?.happyherd, './bin/happy.mjs', 'happyherd must invoke the native CLI entry');
assert(!Object.hasOwn(manifest.bin ?? {}, 'happy'), 'the public package must not install a happy command');
assert.deepEqual(
  Object.keys(manifest.bin ?? {}).sort(),
  ['happy-mcp', 'happyherd', 'happyherd-agent-codex-policy', 'happyherd-agent-mcp'].sort(),
  'the package must expose one primary command and the retained helper commands',
);
assert(!existsSync(retiredWrapper), 'the retired wrapper package must be deleted');
assert.equal(
  workspaceManifest.scripts?.cli,
  'node packages/happy-cli/bin/happy.mjs',
  'the workspace CLI shortcut must execute the public command',
);
assert(workspaceManifest.workspaces?.packages?.includes('packages/happy-cli'), 'the workspace must retain packages/happy-cli');
assert(!workspaceManifest.workspaces?.packages?.includes('packages/happyherd-cli'), 'the workspace must remove the wrapper package');
assert(!workspaceYaml.includes('packages/happyherd-cli'), 'pnpm workspace discovery must remove the wrapper package');
assert(cliSmokeWorkflow.includes('happyherd-cli-prefix/bin/happy'), 'Linux pack smoke must inspect its isolated prefix');
assert(cliSmokeWorkflow.includes('%NPM_PREFIX%\\happy.cmd'), 'Windows pack smoke must inspect its isolated prefix');
assert(!cliSmokeWorkflow.includes('command -v happy >/dev/null'), 'Linux smoke must preserve unrelated happy commands');
assert(!cliSmokeWorkflow.includes('where happy >nul'), 'Windows smoke must preserve unrelated happy commands');
assert.equal(
  cliSmokeWorkflow.match(/pnpm --filter happy-agent --fail-if-no-match build/g)?.length,
  2,
  'Linux and Windows pack smoke must build the CLI workspace dependency',
);
assert(
  qualityWorkflow.includes(
    'pnpm --filter @slopus/happy-wire --fail-if-no-match build\n' +
      '          pnpm --filter happy-agent --fail-if-no-match build\n' +
      '          pnpm --filter @happyherd/cli --fail-if-no-match typecheck',
  ),
  'clean quality typecheck must build CLI workspace dependencies in dependency order',
);
assert(
  hostInstaller.includes('--filter happy-agent --fail-if-no-match build'),
  'host CLI installation must build the CLI workspace dependency',
);

const scanRoots = [
  '.dev',
  '.github',
  'deploy',
  'docs',
  'install.sh',
  'installers',
  'README.md',
  'scripts',
  'server/.agents',
  'server/.github',
  'server/docs',
  'server/environments',
  'server/package.json',
  'server/pnpm-workspace.yaml',
  'server/README.md',
  'server/packages/happy-agent/src',
  'server/packages/happy-app/sources',
  'server/packages/happy-cli',
  'server/packages/happy-server-self-host/README.md',
  'server/packages/happyherd-agent/README.md',
];
const textExtensions = new Set(['.cjs', '.js', '.json', '.md', '.mjs', '.sh', '.ts', '.tsx', '.yml', '.yaml']);
const excluded = [
  /^docs\/owned-patches\.tsv$/,
  /^docs\/upstream-sync-/,
  /^scripts\/test-multiagent-guidance-contract\.mjs$/,
  /^scripts\/verify-cli-public-command\.mjs$/,
  /^server\/\.agents\/skills\/maintain\/checkpoint\.md$/,
  /^server\/docs\/plans\//,
  /^server\/docs\/superpowers\//,
  /^server\/packages\/happy-cli\/docs\//,
  /^server\/packages\/happy-app\/CHANGELOG\.md$/,
  /^server\/packages\/happy-app\/sources\/changelog\/changelog\.json$/,
];
const oldPackage = /npm\s+(?:i|install|upgrade|update|unlink)\s+(?:-g|--global)\s+happy(?:@[A-Za-z0-9_.-]+)?(?=\s|`|$)/g;
const oldFilter = /pnpm\s+--filter\s+happy(?=\s|$)/g;
const subcommands = '(?:-{1,2}[A-Za-z][A-Za-z0-9-]*|auth|accounts|automation|commander|connect|machine|session|sandbox|server|codex|claude|grok|agy|acp|resume|doctor|notify|gemini|daemon|logout|bye)';
const oldQuotedCommand = new RegExp(`(?:\\\`|["'])happy\\s+${subcommands}\\b`, 'g');
const oldProseCommand = /\b(?:run|use|execute|starts?|start using)\s+`happy`/gi;
const oldShellCommand = new RegExp(`^[ \\t]*(?:[A-Z_][A-Z0-9_]*=[^ \\n]+[ \\t]+)*happy(?:[ \\t]+${subcommands}\\b|[ \\t]*$)`, 'gm');

for (const example of ['`happy -v`', '`happy --yolo`', '`happy accounts`']) {
  oldQuotedCommand.lastIndex = 0;
  assert(oldQuotedCommand.test(example), `retired command scanner must reject ${example}`);
}

function walk(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

const violations = [];
for (const path of scanRoots.flatMap((entry) => walk(join(root, entry)))) {
  if (!statSync(path).isFile() || !textExtensions.has(extname(path))) continue;
  const repoPath = relative(root, path).split(sep).join('/');
  if (excluded.some((pattern) => pattern.test(repoPath))) continue;
  const content = readFileSync(path, 'utf8');
  for (const [label, pattern] of [
    ['retired global package', oldPackage],
    ['retired workspace selector', oldFilter],
    ['retired quoted command', oldQuotedCommand],
    ['retired prose command', oldProseCommand],
    ['retired shell command', oldShellCommand],
  ]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      violations.push(`${repoPath}:${line}: ${label}: ${JSON.stringify(match[0])}`);
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
}

assert.equal(
  violations.length,
  0,
  `active public surfaces still advertise the retired package or command:\n${violations.join('\n')}`,
);

process.stdout.write('cli-public-command-contract: ok\n');
