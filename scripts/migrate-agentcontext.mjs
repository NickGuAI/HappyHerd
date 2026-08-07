#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MANIFEST_VERSION = 1;
const UUID_JSON = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;
const UUID_DIRECTORY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMORY_FILES = new Set([
  '0-observations.jsonl',
  '1-working-memory.md',
  '2-long-term-memory.md',
]);
const AUTOMATION_RUNTIME_FIELDS = [
  'history',
  'lastRun',
  'totalCostUsd',
  'totalRuns',
];

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function isFile(filePath) {
  try {
    return (await lstat(filePath)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function listFiles(root) {
  const files = [];
  async function visit(current) {
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      if (entry.isFile()) files.push(candidate);
    }
  }
  await visit(root);
  return files;
}

function rootForms(home, herdRoot, destinationRoot) {
  return {
    source: [
      herdRoot,
      path.join(home, '.herd'),
      '~/.herd',
      '$HOME/.herd',
      '${HOME}/.herd',
    ],
    destination: [
      destinationRoot,
      path.join(home, '.happyherd'),
      '~/.happyherd',
      '$HOME/.happyherd',
      '${HOME}/.happyherd',
    ],
  };
}

function pointerPairs(home, herdRoot, destinationRoot) {
  const forms = rootForms(home, herdRoot, destinationRoot);
  const pairs = [
    {
      before: path.join(herdRoot, 'commander'),
      after: path.join(destinationRoot, 'commanders'),
      normalized: '<HAPPYHERD_AGENTCONTEXT_ROOT>/commanders',
    },
    {
      before: path.join(home, '.herd', 'commander'),
      after: path.join(home, '.happyherd', 'commanders'),
      normalized: '<HAPPYHERD_AGENTCONTEXT_ROOT>/commanders',
    },
    {
      before: '~/.herd/commander',
      after: '~/.happyherd/commanders',
      normalized: '<HAPPYHERD_AGENTCONTEXT_ROOT>/commanders',
    },
    {
      before: '$HOME/.herd/commander',
      after: '$HOME/.happyherd/commanders',
      normalized: '<HAPPYHERD_AGENTCONTEXT_ROOT>/commanders',
    },
    {
      before: '${HOME}/.herd/commander',
      after: '${HOME}/.happyherd/commanders',
      normalized: '<HAPPYHERD_AGENTCONTEXT_ROOT>/commanders',
    },
    ...forms.source.map((before, index) => ({
      before,
      after: forms.destination[index],
      normalized: '<HAPPYHERD_AGENTCONTEXT_ROOT>',
    })),
  ];
  return pairs
    .filter((pair, index) => pairs.findIndex((candidate) => (
      candidate.before === pair.before && candidate.after === pair.after
    )) === index)
    .sort((left, right) => right.before.length - left.before.length);
}

function replaceLiteral(content, before, after) {
  if (!before || before === after) return { content, count: 0 };
  const pieces = content.split(before);
  return {
    content: pieces.join(after),
    count: pieces.length - 1,
  };
}

function rewritePointers(content, options) {
  let rewritten = content;
  const rewrites = [];
  for (const pair of pointerPairs(options.sourceHome, options.herdRoot, options.destinationRoot)) {
    const result = replaceLiteral(rewritten, pair.before, pair.after);
    rewritten = result.content;
    if (result.count > 0) {
      rewrites.push({ before: pair.before, after: pair.after, count: result.count });
    }
  }
  return { content: rewritten, rewrites };
}

function normalizeRoots(content, options) {
  let normalized = content;
  const forms = pointerPairs(options.sourceHome, options.herdRoot, options.destinationRoot)
    .flatMap((pair) => [
      { literal: pair.before, normalized: pair.normalized },
      { literal: pair.after, normalized: pair.normalized },
    ])
    .filter((entry, index, entries) => entries.findIndex((candidate) => (
      candidate.literal === entry.literal && candidate.normalized === entry.normalized
    )) === index)
    .sort((left, right) => right.literal.length - left.literal.length);
  for (const form of forms) normalized = normalized.split(form.literal).join(form.normalized);
  return normalized;
}

function stripExcludedRuntimeState(content, category) {
  if (category !== 'automation-definition') return { content, transforms: [] };
  const definition = JSON.parse(content);
  const removedFields = AUTOMATION_RUNTIME_FIELDS.filter((field) => Object.hasOwn(definition, field));
  for (const field of removedFields) delete definition[field];
  return {
    content: `${JSON.stringify(definition, null, 2)}\n`,
    transforms: removedFields.length > 0
      ? [{ type: 'exclude-automation-run-state', fields: removedFields }]
      : [],
  };
}

async function collectInventory(options) {
  const inventory = [];
  const add = async (source, destinationRelative, category) => {
    if (await isFile(source)) inventory.push({ source, destinationRelative, category });
  };

  await add(path.join(options.sourceHome, 'AGENTS.md'), 'AGENTS.md', 'global-entrypoint');

  const sharedRoot = path.join(options.herdRoot, 'agentcontext');
  for (const relative of ['USER.md', 'rules/WORKSPACE.md', 'rules/SKILLS_INDEX.md']) {
    await add(path.join(sharedRoot, relative), path.join('agentcontext', relative), 'shared-agentcontext');
  }
  for (const directory of ['rules/learnings', 'rules/methodologies']) {
    for (const source of await listFiles(path.join(sharedRoot, directory))) {
      if (!source.endsWith('.md')) continue;
      const relative = path.relative(sharedRoot, source);
      await add(source, path.join('agentcontext', relative), 'shared-agentcontext');
    }
  }

  const automationRoot = path.join(sharedRoot, 'automations');
  let automationEntries = [];
  try {
    automationEntries = await readdir(automationRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const entry of automationEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !UUID_JSON.test(entry.name)) continue;
    await add(
      path.join(automationRoot, entry.name),
      path.join('agentcontext', 'automations', entry.name),
      'automation-definition',
    );
  }

  const commandersRoot = path.join(options.herdRoot, 'commanders');
  let commanderEntries = [];
  try {
    commanderEntries = await readdir(commandersRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const entry of commanderEntries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !UUID_DIRECTORY.test(entry.name)) continue;
    const sourceRoot = path.join(commandersRoot, entry.name);
    const destinationRoot = path.join('commanders', entry.name);
    await add(path.join(sourceRoot, 'COMMANDER.md'), path.join(destinationRoot, 'COMMANDER.md'), 'commander-definition');
    for (const memoryFile of MEMORY_FILES) {
      await add(
        path.join(sourceRoot, 'agentcontext', 'memory', memoryFile),
        path.join(destinationRoot, 'agentcontext', 'memory', memoryFile),
        'commander-memory',
      );
    }
    const rulesRoot = path.join(sourceRoot, 'agentcontext', 'rules');
    for (const source of await listFiles(rulesRoot)) {
      if (!source.endsWith('.md')) continue;
      const relative = path.relative(rulesRoot, source);
      if (relative.split(path.sep).includes('proposals')) continue;
      await add(
        source,
        path.join(destinationRoot, 'agentcontext', 'rules', relative),
        'commander-rule',
      );
    }
  }

  await add(
    path.join(commandersRoot, 'COMMANDER.template.md'),
    path.join('commanders', 'COMMANDER.template.md'),
    'commander-template',
  );

  return inventory.sort((left, right) => left.destinationRelative.localeCompare(right.destinationRelative));
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function migrateAgentContext(rawOptions = {}) {
  const sourceHome = path.resolve(rawOptions.sourceHome ?? os.homedir());
  const herdRoot = path.resolve(rawOptions.herdRoot ?? path.join(sourceHome, '.herd'));
  const destinationRoot = path.resolve(rawOptions.destinationRoot ?? path.join(sourceHome, '.happyherd'));
  const manifestPath = path.resolve(rawOptions.manifestPath ?? path.join(destinationRoot, 'agentcontext', 'migration-manifest.json'));
  const apply = rawOptions.apply === true;
  if (herdRoot === destinationRoot) throw new Error('Source and destination AgentContext roots must differ');

  const singularCommanderRoot = path.join(destinationRoot, 'commander');
  try {
    if ((await lstat(singularCommanderRoot)).isDirectory()) {
      throw new Error(`Retired singular Commander root still exists: ${singularCommanderRoot}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const inventory = await collectInventory({ sourceHome, herdRoot, destinationRoot });
  const records = [];
  for (const item of inventory) {
    const sourceContent = await readFile(item.source, 'utf8');
    const knowledgeOnlySource = stripExcludedRuntimeState(sourceContent, item.category);
    const transformed = rewritePointers(knowledgeOnlySource.content, { sourceHome, herdRoot, destinationRoot });
    const destinationPath = path.join(destinationRoot, item.destinationRelative);
    if (apply) await atomicWrite(destinationPath, transformed.content);
    const destinationContent = apply ? await readFile(destinationPath, 'utf8') : transformed.content;
    const sourceNormalized = normalizeRoots(knowledgeOnlySource.content, { sourceHome, herdRoot, destinationRoot });
    const destinationNormalized = normalizeRoots(destinationContent, { sourceHome, herdRoot, destinationRoot });
    const record = {
      category: item.category,
      source: item.source,
      destination: destinationPath,
      sourceSha256: sha256(sourceContent),
      migrationInputSha256: sha256(knowledgeOnlySource.content),
      destinationSha256: sha256(destinationContent),
      normalizedSourceSha256: sha256(sourceNormalized),
      normalizedDestinationSha256: sha256(destinationNormalized),
      rewrites: transformed.rewrites,
      transforms: knowledgeOnlySource.transforms,
    };
    if (record.normalizedSourceSha256 !== record.normalizedDestinationSha256) {
      throw new Error(`Unexplained semantic difference after root normalization: ${item.source}`);
    }
    records.push(record);
  }

  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    sourceHome,
    herdRoot,
    destinationRoot,
    knowledgeOnly: true,
    excludedClasses: [
      'credentials', 'credential-pools', 'runtime-databases', 'sessions', 'transcripts',
      'telemetry', 'logs', 'quests', 'profiles', 'avatars', 'heartbeat-ledgers',
      'cost-ledgers', 'automation-run-history', 'memory-html', 'rule-proposals',
    ],
    files: records,
  };
  if (apply) await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseArgs(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--source-home') options.sourceHome = argv[++index];
    else if (argument === '--herd-root') options.herdRoot = argv[++index];
    else if (argument === '--destination-root') options.destinationRoot = argv[++index];
    else if (argument === '--manifest') options.manifestPath = argv[++index];
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/migrate-agentcontext.mjs [--apply] [options]',
    '',
    'Without --apply, performs a read-only inventory and parity check.',
    '--source-home <path>       Home containing AGENTS.md and .herd',
    '--herd-root <path>         Explicit Herd migration source',
    '--destination-root <path>  Canonical HappyHerd root',
    '--manifest <path>          Manifest output path (with --apply)',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const manifest = await migrateAgentContext(options);
  console.log(JSON.stringify({
    mode: options.apply ? 'applied' : 'dry-run',
    files: manifest.files.length,
    rewrites: manifest.files.reduce(
      (total, file) => total + file.rewrites.reduce((sum, rewrite) => sum + rewrite.count, 0),
      0,
    ),
    destinationRoot: manifest.destinationRoot,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
