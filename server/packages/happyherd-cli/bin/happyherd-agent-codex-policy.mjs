#!/usr/bin/env node

import { happyHerdAgentCodexPreToolDecision } from '../dist/codex/agentCodexPolicy.mjs';

let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  body += chunk;
  if (body.length > 1_048_576) {
    process.stderr.write('HappyHerd Agent Codex policy input exceeded its limit.\n');
    process.exit(2);
  }
});
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(body);
  } catch {
    process.stderr.write('HappyHerd Agent Codex policy received invalid input.\n');
    process.exit(2);
  }
  const decision = happyHerdAgentCodexPreToolDecision(input);
  if (decision) {
    process.stdout.write(`${JSON.stringify(decision)}\n`);
  }
});
