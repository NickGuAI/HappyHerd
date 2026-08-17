#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const requiredTargets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];

function fail(message) {
  throw new Error(`public-release-metadata: ${message}`);
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const assetsDir = resolve(option('assets-dir') ?? fail('--assets-dir is required'));
const outputDir = resolve(option('output') ?? fail('--output is required'));
const version = option('version') ?? fail('--version is required');
const sourceSha = option('source-sha') ?? fail('--source-sha is required');
const publishedAt = option('published-at') ?? fail('--published-at is required');
const releaseBaseUrl = option('release-base-url') ?? fail('--release-base-url is required');
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) fail('--version must be semantic');
if (!/^[0-9a-f]{40}$/.test(sourceSha)) fail('--source-sha must be a full Git SHA');
if (!Number.isFinite(Date.parse(publishedAt))) fail('--published-at must be an ISO timestamp');
const baseUrl = new URL(releaseBaseUrl);
if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
  fail('--release-base-url must be a clean HTTPS URL');
}

const fragments = readdirSync(assetsDir)
  .filter((name) => name.endsWith('.asset.json'))
  .map((name) => JSON.parse(readFileSync(join(assetsDir, name), 'utf8')))
  .sort((left, right) => left.target.localeCompare(right.target));
if (JSON.stringify(fragments.map((entry) => entry.target)) !== JSON.stringify(requiredTargets)) {
  fail(`asset fragments must contain exactly: ${requiredTargets.join(', ')}`);
}
for (const fragment of fragments) {
  if (fragment.sourceSha !== sourceSha) fail(`source SHA mismatch for ${fragment.target}`);
  if (
    typeof fragment.filename !== 'string'
    || fragment.filename !== basename(fragment.filename)
    || !/^[A-Za-z0-9._+-]+\.(?:tar\.gz|zip)$/.test(fragment.filename)
    || !/^[0-9a-f]{64}$/.test(fragment.sha256)
    || !Number.isSafeInteger(fragment.sizeBytes)
    || fragment.sizeBytes < 1
  ) fail(`asset fragment is invalid for ${fragment.target}`);
  const asset = join(assetsDir, fragment.filename);
  if (digest(asset) !== fragment.sha256 || statSync(asset).size !== fragment.sizeBytes) {
    fail(`asset bytes do not match fragment for ${fragment.target}`);
  }
}

mkdirSync(outputDir, { recursive: true });
const placeholderPrefixes = new Map([
  ['darwin-arm64', 'DARWIN_ARM64'],
  ['darwin-x64', 'DARWIN_X64'],
  ['linux-arm64', 'LINUX_ARM64'],
  ['linux-x64', 'LINUX_X64'],
  ['win32-x64', 'WIN32_X64'],
]);
for (const filename of ['install.sh', 'install.ps1']) {
  const templatePath = resolve(import.meta.dirname, '..', 'installers', `${filename}.template`);
  let rendered = readFileSync(templatePath, 'utf8')
    .replaceAll('@RELEASE_BASE_URL@', baseUrl.toString().replace(/\/$/, ''))
    .replaceAll('@RELEASE_VERSION@', version);
  for (const fragment of fragments) {
    const prefix = placeholderPrefixes.get(fragment.target);
    rendered = rendered
      .replaceAll(`@${prefix}_FILENAME@`, fragment.filename)
      .replaceAll(`@${prefix}_SHA256@`, fragment.sha256)
      .replaceAll(`@${prefix}_SIZE@`, String(fragment.sizeBytes))
      .replaceAll(`@${prefix}_SOURCE_SHA@`, fragment.sourceSha);
  }
  if (/@[A-Z0-9_]+@/.test(rendered)) fail(`${filename} contains an unresolved release placeholder`);
  writeFileSync(join(outputDir, filename), rendered, { mode: filename.endsWith('.sh') ? 0o755 : 0o644 });
}

const installers = [
  { shell: 'sh', filename: 'install.sh' },
  { shell: 'powershell', filename: 'install.ps1' },
].map((installer) => ({
  ...installer,
  sha256: digest(join(outputDir, installer.filename)),
}));
const manifest = {
  schemaVersion: 1,
  product: 'HappyHerd',
  version,
  sourceSha,
  publishedAt,
  assets: fragments,
  installers,
};
writeFileSync(join(outputDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const sumFiles = [
  ...fragments.map((fragment) => join(assetsDir, fragment.filename)),
  ...installers.map((installer) => join(outputDir, installer.filename)),
  join(outputDir, 'release-manifest.json'),
].sort((left, right) => basename(left).localeCompare(basename(right)));
writeFileSync(
  join(outputDir, 'SHA256SUMS'),
  `${sumFiles.map((path) => `${digest(path)}  ${basename(path)}`).join('\n')}\n`,
);
process.stdout.write(`public-release-metadata: ok (${version}; ${sourceSha.slice(0, 12)})\n`);
