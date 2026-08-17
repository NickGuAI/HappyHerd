#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const requiredTargets = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64'];

function fail(message) {
  throw new Error(`public-launcher-release: ${message}`);
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} has unexpected keys`);
  }
}

function embeddedReceipt(releaseDir, asset) {
  const path = join(releaseDir, asset.filename);
  const bytes = asset.format === 'zip'
    ? execFileSync('unzip', ['-p', path, 'happyherd/release.json'])
    : execFileSync('tar', ['-xOzf', path, 'happyherd/release.json']);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`embedded receipt is invalid JSON: ${asset.filename}`);
  }
}

export function verifyPublicLauncherRelease(releaseDirInput) {
  const releaseDir = resolve(releaseDirInput);
  const manifest = JSON.parse(readFileSync(join(releaseDir, 'release-manifest.json'), 'utf8'));
  exactKeys(
    manifest,
    ['schemaVersion', 'product', 'version', 'sourceSha', 'publishedAt', 'assets', 'installers'],
    'manifest',
  );
  if (
    manifest.schemaVersion !== 1
    || manifest.product !== 'HappyHerd'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
    || !/^[0-9a-f]{40}$/.test(manifest.sourceSha)
    || !Number.isFinite(Date.parse(manifest.publishedAt))
  ) fail('manifest identity or provenance is invalid');
  if (!Array.isArray(manifest.assets) || !Array.isArray(manifest.installers)) {
    fail('manifest assets and installers must be arrays');
  }
  const assets = [...manifest.assets].sort((left, right) => left.target.localeCompare(right.target));
  if (JSON.stringify(assets.map((asset) => asset.target)) !== JSON.stringify(requiredTargets)) {
    fail(`manifest must contain exactly: ${requiredTargets.join(', ')}`);
  }
  for (const asset of assets) {
    exactKeys(asset, ['target', 'filename', 'format', 'sha256', 'sizeBytes', 'sourceSha'], `asset ${asset.target}`);
    const expectedFormat = asset.target === 'win32-x64' ? 'zip' : 'tar.gz';
    const expectedFilename = `happyherd-v${manifest.version}-${asset.target}.${expectedFormat}`;
    const path = join(releaseDir, asset.filename);
    if (
      asset.filename !== expectedFilename
      || asset.format !== expectedFormat
      || asset.sourceSha !== manifest.sourceSha
      || !/^[0-9a-f]{64}$/.test(asset.sha256)
      || sha256(path) !== asset.sha256
      || statSync(path).size !== asset.sizeBytes
    ) fail(`asset contract failed for ${asset.target}`);
    const receipt = embeddedReceipt(releaseDir, asset);
    const receiptKeys = [
      'schemaVersion',
      'product',
      'version',
      'target',
      'sourceSha',
      'nodeRuntime',
      'pythonRuntime',
      'pythonVersion',
      'tzdataVersion',
      'toolLauncher',
    ];
    if (asset.target === 'win32-x64') receiptKeys.push('trustVerifier');
    if (asset.target.startsWith('darwin-')) receiptKeys.push('keychainHost');
    exactKeys(receipt, receiptKeys, `receipt ${asset.target}`);
    if (
      receipt.schemaVersion !== 1
      || receipt.product !== 'HappyHerd'
      || receipt.version !== manifest.version
      || receipt.target !== asset.target
      || receipt.sourceSha !== manifest.sourceSha
      || receipt.nodeRuntime !== (asset.target === 'win32-x64' ? 'native/node.exe' : 'native/node')
      || typeof receipt.pythonRuntime !== 'string'
      || !/^python\/[A-Za-z0-9._+@/-]+$/.test(receipt.pythonRuntime)
      || typeof receipt.pythonVersion !== 'string'
      || !/^3\.(?:1\d|[2-9]\d)\.\d+$/.test(receipt.pythonVersion)
      || typeof receipt.tzdataVersion !== 'string'
      || !/^\d{4}\.\d+$/.test(receipt.tzdataVersion)
      || receipt.toolLauncher !== (asset.target === 'win32-x64'
        ? 'service/happyherd-tool-launcher.exe'
        : 'service/happyherd-tool-launcher')
      || (asset.target === 'win32-x64' && receipt.trustVerifier !== 'service/happyherd-acl-check.exe')
      || (asset.target.startsWith('darwin-') && receipt.keychainHost !== 'service/happyherd-keychain-broker')
    ) fail(`embedded receipt does not match manifest for ${asset.target}`);
  }
  const installers = [...manifest.installers].sort((left, right) => left.shell.localeCompare(right.shell));
  if (
    installers.length !== 2
    || installers[0].shell !== 'powershell'
    || installers[0].filename !== 'install.ps1'
    || installers[1].shell !== 'sh'
    || installers[1].filename !== 'install.sh'
  ) fail('manifest must contain the PowerShell and sh installers');
  for (const installer of installers) {
    exactKeys(installer, ['shell', 'filename', 'sha256'], `installer ${installer.shell}`);
    const path = join(releaseDir, installer.filename);
    const text = readFileSync(path, 'utf8');
    if (sha256(path) !== installer.sha256 || /@[A-Z0-9_]+@/.test(text)) {
      fail(`installer failed digest or rendering validation: ${installer.filename}`);
    }
  }

  const expectedSums = [
    ...assets.map((asset) => asset.filename),
    ...installers.map((item) => item.filename),
    'release-manifest.json',
  ].sort();
  const sums = readFileSync(join(releaseDir, 'SHA256SUMS'), 'utf8')
    .trim().split('\n').filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64})  ([A-Za-z0-9._+-]+)$/.exec(line);
      if (!match) fail('SHA256SUMS contains an invalid line');
      return { sha256: match[1], filename: match[2] };
    })
    .sort((left, right) => left.filename.localeCompare(right.filename));
  if (JSON.stringify(sums.map((entry) => entry.filename)) !== JSON.stringify(expectedSums)) {
    fail('SHA256SUMS does not cover exactly the five assets, two installers, and release manifest');
  }
  for (const entry of sums) {
    if (sha256(join(releaseDir, entry.filename)) !== entry.sha256) {
      fail(`SHA256SUMS mismatch for ${entry.filename}`);
    }
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const releaseDir = process.argv[2];
  if (!releaseDir) fail('usage: verify-public-launcher-release.mjs RELEASE_DIR');
  const manifest = verifyPublicLauncherRelease(releaseDir);
  process.stdout.write(`public-launcher-release: ok (${manifest.version}; ${manifest.sourceSha.slice(0, 12)})\n`);
}
