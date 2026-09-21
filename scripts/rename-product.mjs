#!/usr/bin/env node
// Source-only non-CLI rename. Runtime data is never traversed.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renameText } from './rename-cli.mjs';

export function planProductRename(root, from, to, scope) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
  const changes = [];
  const lower = from.toLowerCase();
  const target = to.toLowerCase();
  const packages = [
    [`${lower}-control-agent`, `${target}-control-agent`],
    ...(lower === 'happy' ? [['happy-agent', `${target}-control-agent`]] : []),
    [`@slopus/${lower}-wire`, `@${target}/wire`],
    [`@${lower}/wire`, `@${target}/wire`],
    ...['app-logs', 'app', 'server-self-host', 'server', 'wire'].map(name => [`${lower}-${name}`, `${target}-${name}`]),
    [`${from}ControlClient`, `${to}ControlClient`],
  ];
  for (const path of paths) {
    const stat = lstatSync(resolve(root, path), { throwIfNoEntry: false });
    if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) continue;
    if (scope.exclude.some(prefix => path.startsWith(prefix))) continue;
    const symbolic = stat.isSymbolicLink();
    const buffer = symbolic ? Buffer.from(readlinkSync(resolve(root, path))) : readFileSync(resolve(root, path));
    const before = buffer.toString('utf8');
    const opaque = symbolic || buffer.includes(0) || !Buffer.from(before).equals(buffer);
    const cli = /server\/packages\/[^/]+-cli\//.test(path) || /^scripts\/[^/]*(?:cli|native-installer|public-launcher)[^/]*$/.test(path) || scope.cli.some(prefix => path.startsWith(prefix));
    const historical = /(?:CHANGELOG\.md|changelog\.json|LICENSE|NOTICE)$/.test(path) || /\/(?:__fixtures__|prisma\/migrations)\//.test(path) || /\/__testdata__\/.*\.(?:json|jsonl)$/.test(path) || /\/autocomplete\/(?:applySuggestion|findActiveWord)\.test\.ts$/.test(path);
    const storageModule = /\/app-storage(?:\.test)?\.ts$/.test(path);
    const protectedValues = [...scope.preserve.filter(value => !storageModule || value !== 'happyHomeDir'), ...(scope.stable ?? []),
      ...(before.match(/https?:\/\/[^\s<>"'`)]+/g) ?? []),
      ...(before.match(/<!-- rename:preserve -->[\s\S]*?<!-- \/rename:preserve -->/g) ?? []),
      ...(before.match(/\/\* rename:preserve \*\/[\s\S]*?\/\* \/rename:preserve \*\//g) ?? []),
      ...(before.match(/^# rename:preserve\n[\s\S]*?^# \/rename:preserve/gm) ?? []),
      ...(before.match(/(?:Copyright|copyright)[^\n]*/g) ?? []),
    ];
    // Preserve the serialized auth key, while internal client symbols still rename.
    if (/\/(?:sync\/apiSocket(?:\.test)?|app\/api\/socket\.test)\.ts$/.test(path)) protectedValues.push('happyClient:');
    // The product rename excludes the CLI, including the dev environment's wrapper.
    if (path === 'server/environments/environments.ts') protectedValues.push('name: "happyherd"', '"# - happyherd"');
    if (storageModule) protectedValues.push("'Happy'", "'happy'", ...(before.match(/['"][^'"\n]*\/(?:Happy|happy)['"]/g) ?? []));
    if (/\/storageTypes\.ts$/.test(path)) protectedValues.push("'happy-app'", "'happy-cli'");
    if (path.endsWith('/dev/input-styles.tsx')) protectedValues.push('name="happy"', 'name="happy-outline"');
    let after = before;
    let destination = path;
    if (path === 'docs/owned-patches.tsv') {
      after = before.split('\n').map(line => {
        const fields = line.split('\t');
        if (fields.length !== 4 || line.startsWith('#')) return line;
        for (const [source, targetName] of packages) fields[3] = renameText(fields[3], source, targetName);
        if (!/\/[^/]+-cli\//.test(fields[3])) fields[3] = renameText(fields[3], from, to);
        return fields.join('\t');
      }).join('\n');
      if (after !== before) changes.push({ path, destination, before: buffer, after: Buffer.from(after) });
      continue;
    }
    // CLI-owned files receive only provider package/path/export updates.
    if (!opaque && !historical) {
      for (const [source, targetName] of packages) after = renameText(after, source, targetName, protectedValues);
      if (!cli) after = renameText(after, from, to, protectedValues);
      for (const value of cli ? [] : scope.stable ?? []) {
        let renamed = value;
        for (const [source, targetName] of packages) renamed = renameText(renamed, source, targetName);
        renamed = renameText(renamed, from, to);
        if (renamed !== value) after = after.replaceAll(renamed, value);
      }
    }
    if (!cli) {
      for (const [source, targetName] of packages) destination = renameText(destination, source, targetName);
      destination = renameText(destination, from, to);
    }
    if (before !== after || path !== destination) changes.push({ path, destination, symbolic, before: buffer, after: opaque || historical ? buffer : Buffer.from(after) });
  }
  const destinations = new Set();
  for (const change of changes) {
    if (destinations.has(change.destination) || (change.path !== change.destination && existsSync(resolve(root, change.destination)))) {
      throw new Error(`Rename collision: ${change.destination}`);
    }
    destinations.add(change.destination);
  }
  return changes;
}

export function applyProductRename(root, changes) {
  for (const { path, destination, after, symbolic } of changes) {
    mkdirSync(dirname(resolve(root, destination)), { recursive: true });
    // Git must keep moved, already-tracked ignored files (e.g. .env.dev and
    // CLAUDE.md) discoverable for a subsequent rename. Content stays unstaged.
    if (path !== destination) execFileSync('git', ['mv', '--', path, destination], { cwd: root });
    if (!symbolic) writeFileSync(resolve(root, destination), after);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const from = option('--from');
  const to = option('--to');
  if (!from || !to || !/^[A-Za-z][A-Za-z0-9]*$/.test(from) || !/^[A-Za-z][A-Za-z0-9]*$/.test(to) || from.toLowerCase() === to.toLowerCase()) {
    throw new Error('Usage: node scripts/rename-product.mjs --from Happy --to HappyHerd [--root PATH] [--manifest PATH] [--apply | --check]');
  }
  const root = resolve(option('--root', resolve(import.meta.dirname, '..')));
  const scope = JSON.parse(readFileSync(resolve(root, option('--manifest', 'scripts/product-rename-scope.json')), 'utf8'));
  const changes = planProductRename(root, from, to, scope);
  if (args.includes('--apply')) applyProductRename(root, changes);
  else for (const change of changes) console.log(`${change.path} -> ${change.destination}`);
  console.log(`${changes.length} files ${args.includes('--apply') ? 'renamed' : 'need renaming'}`);
  if (args.includes('--check') && changes.length) process.exitCode = 1;
}
