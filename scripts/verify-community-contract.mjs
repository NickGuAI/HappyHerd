#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const supportUrl = ['https://buymeacoffee.com/', 'nick', 'guy'].join('');

function read(path) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function requireText(text, expected, owner) {
  if (!text.includes(expected)) {
    throw new Error(`${owner} is missing ${JSON.stringify(expected)}`);
  }
}

export function hasExactMarkdownLink(markdown, expectedHref) {
  const markdownLinkPattern = /!?\[[^\]]*\]\(\s*(?:<([^>\s]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  return [...markdown.matchAll(markdownLinkPattern)]
    .some((match) => (match[1] ?? match[2]) === expectedHref);
}

export function verifyCommunityContract() {
  const license = read('LICENSE');
  for (const expected of [
    'MIT License',
    'Copyright (c) 2026 Happy Coder Contributors',
    'Copyright (c) 2026 HappyHerd Maintainers',
    'Permission is hereby granted, free of charge',
    'THE SOFTWARE IS PROVIDED "AS IS"',
  ]) {
    requireText(license, expected, 'LICENSE');
  }

  const readme = read('README.md');
  for (const expected of [
    '.github/workflows/quality-gates.yml',
    '.github/workflows/contract-suite.yml',
    'Clean install',
    'Lint',
    'Typecheck',
    'Unit tests',
    'Production build',
    'Contract suite',
    '[MIT](LICENSE)',
    '$5 coffee',
  ]) {
    requireText(readme, expected, 'README.md');
  }
  if (!hasExactMarkdownLink(readme, supportUrl)) {
    throw new Error('README.md must link the exact approved support endpoint');
  }

  const funding = read('.github/FUNDING.yml').trim();
  const expectedFunding = `custom: ["${supportUrl}"]`;
  if (funding !== expectedFunding) {
    throw new Error('.github/FUNDING.yml must contain only the approved support endpoint');
  }

  const qualityWorkflow = read('.github/workflows/quality-gates.yml');
  for (const expected of [
    'pull_request:',
    'name: Clean install',
    'name: Lint',
    'name: Typecheck',
    'name: Unit tests',
    'name: Production build',
    'node scripts/verify-community-contract.mjs',
  ]) {
    requireText(qualityWorkflow, expected, '.github/workflows/quality-gates.yml');
  }

  const contractWorkflow = read('.github/workflows/contract-suite.yml');
  for (const expected of ['pull_request:', 'name: Contract suite']) {
    requireText(contractWorkflow, expected, '.github/workflows/contract-suite.yml');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  verifyCommunityContract();
  process.stdout.write('community-contract: ok\n');
}
