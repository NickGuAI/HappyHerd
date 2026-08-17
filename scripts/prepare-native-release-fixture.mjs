#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`--${name} is required`);
  return process.argv[index + 1];
}

const fragment = JSON.parse(readFileSync(resolve(option('fragment')), 'utf8'));
const asset = resolve(option('asset'));
const output = resolve(option('output'));
const version = option('version');
const base = new URL(option('base-url'));
const shell = option('shell');
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/') throw new Error('--base-url must be loopback HTTP');
if (!['sh', 'powershell'].includes(shell)) throw new Error('--shell is invalid');
if (fragment.filename !== basename(asset) || fragment.target === undefined || fragment.sourceSha === undefined) throw new Error('asset fragment does not match asset');
if ((shell === 'powershell') !== (fragment.target === 'win32-x64')) throw new Error('installer shell does not match the fixture target');
mkdirSync(output, { recursive: true });
copyFileSync(asset, join(output, fragment.filename));
writeFileSync(join(output, 'release-manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  product: 'HappyHerd',
  version,
  sourceSha: fragment.sourceSha,
  publishedAt: '2026-08-17T00:00:00Z',
  assets: [fragment],
  installers: [],
}, null, 2)}\n`);
const filename = shell === 'sh' ? 'install.sh' : 'install.ps1';
const template = readFileSync(resolve(import.meta.dirname, '..', 'installers', `${filename}.template`), 'utf8');
const targets = new Map([
  ['darwin-arm64', 'DARWIN_ARM64'],
  ['darwin-x64', 'DARWIN_X64'],
  ['linux-arm64', 'LINUX_ARM64'],
  ['linux-x64', 'LINUX_X64'],
  ['win32-x64', 'WIN32_X64'],
]);
let rendered = template
  .replaceAll('@RELEASE_BASE_URL@', base.origin)
  .replaceAll('@RELEASE_VERSION@', version);
for (const [target, prefix] of targets) {
  const selected = target === fragment.target
    ? fragment
    : {
        filename: `unused-${target}.${target === 'win32-x64' ? 'zip' : 'tar.gz'}`,
        sha256: '0'.repeat(64),
        sizeBytes: 1,
        sourceSha: fragment.sourceSha,
      };
  rendered = rendered
    .replaceAll(`@${prefix}_FILENAME@`, selected.filename)
    .replaceAll(`@${prefix}_SHA256@`, selected.sha256)
    .replaceAll(`@${prefix}_SIZE@`, String(selected.sizeBytes))
    .replaceAll(`@${prefix}_SOURCE_SHA@`, selected.sourceSha);
}
if (/@[A-Z0-9_]+@/.test(rendered)) throw new Error('rendered installer contains unresolved placeholders');
writeFileSync(join(output, filename), rendered);
