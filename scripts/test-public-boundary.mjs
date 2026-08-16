#!/usr/bin/env node

import assert from 'node:assert/strict';
import { inspectEntries } from './verify-public-boundary.mjs';

const inspect = (path, text) => inspectEntries([{ path, text }]).map(({ rule }) => rule);

assert.deepEqual(inspect('README.md', 'Generic public documentation.'), []);
assert.deepEqual(
  inspect('docs/example.md', 'See examples/' + ['pm', 'ai-happyherd-agent/'].join('') + ' for an organization example.'),
  [],
);
assert(inspect('packages/core.ts', ['PM', 'AI-specific route'].join('')).includes(
  'organization-specific content outside its named example',
));
assert.deepEqual(
  inspect('examples/' + ['pm', 'ai-happyherd-agent/README.md'].join(''), ['PM', 'AI example'].join('')),
  [],
);
assert(inspect('docs/path.md', ['/home/', 'real-person', '/workspace'].join('')).includes(
  'operator-specific POSIX home path',
));
assert(inspect('config.txt', ['sk-', 'proj-', 'a'.repeat(32)].join('')).includes(
  'OpenAI-style secret',
));
assert(inspect('contact.md', ['person', '@', 'private.example.net'].join('')).includes(
  'non-example email address',
));
assert.deepEqual(inspect('metadata.txt', 'HappyHerd Maintainers <maintainers@happyherd.example>'), []);
assert(inspect('metadata.txt', ['private-person', '@', 'real-company.com'].join('')).includes(
  'non-example email address',
));

process.stdout.write('public-boundary self-test: ok\n');
