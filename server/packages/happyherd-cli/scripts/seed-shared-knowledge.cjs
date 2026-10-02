#!/usr/bin/env node

// Published packages include dist. Source checkouts may install dependencies
// before building; their first Commander context preparation seeds the guides.
const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const entry = join(__dirname, '..', 'dist', 'index.mjs');
if (existsSync(entry)) {
  const result = spawnSync(process.execPath, [entry, 'commander', 'guide', '--json'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: process.env,
  });
  if (result.error) {
    console.error(`Unable to seed HappyHerd shared guidance: ${result.error.message}`);
  }
  process.exitCode = result.status ?? 1;
}
