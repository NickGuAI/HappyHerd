#!/usr/bin/env node

import { pmaiCodexPreToolDecision } from '../dist/codex/pmaiCodexPolicy.mjs';

let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  body += chunk;
  if (body.length > 1_048_576) {
    process.stderr.write('PMAI Codex policy input exceeded its limit.\n');
    process.exit(2);
  }
});
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    process.stderr.write('PMAI Codex policy received invalid input.\n');
    process.exit(2);
  }
  const decision = pmaiCodexPreToolDecision(input);
  if (decision) {
    process.stdout.write(`${JSON.stringify(decision)}\n`);
  }
});
