#!/usr/bin/env node
// Tracked source only: never traverse runtime homes, dependencies or build output.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, lstatSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function renameText(text, from, to, preserve = []) {
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = (name) => [name.toLowerCase(), name, name.toUpperCase(), name[0].toLowerCase() + name.slice(1)];
  const sources = variants(from);
  const targets = variants(to);
  const replacements = new Map();
  sources.forEach((value, index) => { if (!replacements.has(value)) replacements.set(value, targets[index]); });
  // Longest first protects existing target substrings, in one non-recursive pass.
  const protectedValues = [...preserve, ...targets];
  const pattern = new RegExp([...new Set([...protectedValues, ...sources])]
    .sort((a, b) => b.length - a.length).map(escape).join('|'), 'g');
  return text.replace(pattern, (value) => protectedValues.includes(value) ? value : replacements.get(value));
}

export function planRename(root, from, to, manifest) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const sourceDir = `server/packages/${from.toLowerCase()}-cli/`;
  const targetDir = `server/packages/${to.toLowerCase()}-cli/`;
  const changes = [];
  for (const path of paths) {
    if (!existsSync(resolve(root, path)) || !lstatSync(resolve(root, path)).isFile()) continue;
    if (manifest.exclude.some((prefix) => path.startsWith(prefix))) continue;
    const buffer = readFileSync(resolve(root, path));
    const before = buffer.toString('utf8');
    const owned = path.startsWith(sourceDir) || path.startsWith(targetDir) || manifest.owned.some((prefix) => path.startsWith(prefix));
    const preserve = [...manifest.preserve, ...(before.match(/https?:\/\/[^\s<>"'`)]+/g) ?? [])];
    preserve.push(...(before.match(/<!-- rename:preserve -->[\s\S]*?<!-- \/rename:preserve -->/g) ?? []));
    for (const match of before.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      if (!match[2].startsWith('.') && !match[2].startsWith('@/')) {
        for (const item of match[1].split(',')) {
          const symbol = item.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
          if (symbol) preserve.push(symbol);
        }
      }
    }
    const opaque = buffer.includes(0) || !Buffer.from(before).equals(buffer) || /\/(?:tools|__fixtures__)\//.test(path);
    const migration = path.endsWith('/legacyCompatibility.ts') || path.endsWith('/legacyCompatibility.test.ts');
    let after = owned && !opaque && !migration ? renameText(before, from, to, preserve) : before;
    if (!owned && path.endsWith('.md')) {
      after = renameText(after, `${from.toLowerCase()}-cli`, `${to.toLowerCase()}-cli`, preserve);
      after = renameText(after, `${from} CLI`, `${to} CLI`, preserve);
    }
    // Shared files: rewrite only CLI path references, not their owners' branding.
    for (const [oldPath, newPath] of [[sourceDir.slice(0, -1), targetDir.slice(0, -1)],
      [`packages/${from.toLowerCase()}-cli`, `packages/${to.toLowerCase()}-cli`],
      [`../${from.toLowerCase()}-cli/`, `../${to.toLowerCase()}-cli/`]]) {
      after = renameText(after, oldPath, newPath, preserve);
    }
    // Path.join-style references only; a bare CLI-looking string may be a wire enum.
    after = after.replace(new RegExp(`(["'])packages\\1,\\s*(["'])${from.toLowerCase()}-cli\\2`, 'g'),
      (_match, quote, cliQuote) => `${quote}packages${quote}, ${cliQuote}${to.toLowerCase()}-cli${cliQuote}`);
    after = after.replace(new RegExp(`(["'])bin\\1,\\s*(["'])${from.toLowerCase()}\\.mjs\\2`, 'g'),
      (_match, quote, entryQuote) => `${quote}bin${quote}, ${entryQuote}${to.toLowerCase()}.mjs${entryQuote}`);
    const cliReference = /(?:server\/)?packages\/[A-Za-z0-9]+-cli\/[^\s"'`<>):]+/g;
    after = after.split(/(https?:\/\/[^\s<>"'`)]+)/g).map((part) => part.startsWith('http') ? part :
      part.replace(cliReference, (reference) => reference.includes(`/${from.toLowerCase()}-cli/`) || reference.includes(`/${to.toLowerCase()}-cli/`)
        ? renameText(reference, from, to) : reference)).join('');
    const destination = owned ? renameText(path, from, to) : path;
    if (before !== after || path !== destination) changes.push({ path, destination, before, after: opaque ? buffer : after });
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const from = option('--from');
  const to = option('--to');
  if (!from || !to || !/^[A-Za-z][A-Za-z0-9]*$/.test(from) || !/^[A-Za-z][A-Za-z0-9]*$/.test(to) || from.toLowerCase() === to.toLowerCase()) {
    throw new Error('Usage: node scripts/rename-cli.mjs --from Happy --to HappyHerd [--root PATH] [--manifest PATH] [--check | --apply | --patch]');
  }
  const root = resolve(option('--root', resolve(dirname(fileURLToPath(import.meta.url)), '..')));
  const manifest = JSON.parse(readFileSync(resolve(root, option('--manifest', 'scripts/cli-rename-scope.json')), 'utf8'));
  const changes = planRename(root, from, to, manifest);
  if (args.includes('--apply')) {
    for (const { path, destination, after } of changes) {
      mkdirSync(dirname(resolve(root, destination)), { recursive: true });
      if (path !== destination) renameSync(resolve(root, path), resolve(root, destination));
      writeFileSync(resolve(root, destination), after);
    }
    console.log(`Renamed ${changes.length} tracked files`);
  } else if (args.includes('--patch')) {
    // Emit the harness patch format; applying it is a separate explicit operation.
    process.stdout.write('*** Begin Patch\n');
    for (const { path, destination, before, after } of changes) {
      process.stdout.write(`*** Update File: ${resolve(root, path)}\n`);
      if (path !== destination) process.stdout.write(`*** Move to: ${resolve(root, destination)}\n`);
      if (Buffer.isBuffer(after)) continue;
      process.stdout.write('@@\n' + before.replace(/\n$/, '').split('\n').map((line) => `-${line}`).join('\n') + '\n');
      process.stdout.write(after.replace(/\n$/, '').split('\n').map((line) => `+${line}`).join('\n') + '\n');
    }
    process.stdout.write('*** End Patch\n');
  } else {
    for (const change of changes) console.log(`${change.path} -> ${change.destination}`);
    console.log(`${changes.length} files need renaming`);
    if (args.includes('--check') && changes.length) process.exitCode = 1;
  }
}
