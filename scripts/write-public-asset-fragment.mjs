#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function fail(message) {
  throw new Error(`public-asset-fragment: ${message}`);
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
}

const assetPath = resolve(option('asset') ?? fail('--asset is required'));
const output = resolve(option('output') ?? fail('--output is required'));
const target = option('target') ?? fail('--target is required');
const sourceSha = option('source-sha') ?? fail('--source-sha is required');
const format = option('format') ?? fail('--format is required');
if (!['tar.gz', 'zip'].includes(format)) fail('--format must be tar.gz or zip');
if (!/^[0-9a-f]{40}$/.test(sourceSha)) fail('--source-sha must be a full Git SHA');
const bytes = readFileSync(assetPath);
writeFileSync(output, `${JSON.stringify({
  target,
  filename: basename(assetPath),
  format,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sizeBytes: statSync(assetPath).size,
  sourceSha,
}, null, 2)}\n`);
