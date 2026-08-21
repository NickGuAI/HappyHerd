#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  canonicalCommitIdentityText,
  inspectEntries,
  syntheticPullRequestMergeParents,
} from './verify-public-boundary.mjs';

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
assert(inspect('README.md', ['Nick', 'GuAI'].join('')).includes(
  'operator-specific personal identity',
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
assert(inspect('docs/organization.md', ['Pioneering', 'Minds'].join(' ')).includes(
  'organization-specific content outside its named example',
));
assert.deepEqual(
  inspect(
    'examples/' + ['pm', 'ai-happyherd-agent/organization.md'].join(''),
    ['Pioneering', 'Minds'].join(' '),
  ),
  [],
);

const base = 'a'.repeat(40);
const head = 'b'.repeat(40);
const merge = 'c'.repeat(40);
const syntheticMerge = {
  commit: merge,
  subject: `Merge ${head} into ${base}`,
  record: [merge, base, head],
  env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: merge },
};
assert.deepEqual(syntheticPullRequestMergeParents(syntheticMerge), {
  firstParentCommit: base,
  branchHead: head,
});
assert.equal(syntheticPullRequestMergeParents({
  ...syntheticMerge,
  env: { GITHUB_EVENT_NAME: 'push', GITHUB_SHA: merge },
}), null);
assert.equal(syntheticPullRequestMergeParents({
  ...syntheticMerge,
  subject: 'Merge pull request #123 from example/feature',
}), null);
assert.equal(syntheticPullRequestMergeParents({
  ...syntheticMerge,
  record: [merge, head, base],
}), null);

const canonicalIdentity = 'HappyHerd Maintainers <maintainers@happyherd.example>';
const hostedSquashIdentity = {
  authorName: 'Hosted Contributor',
  authorEmail: ['123+', 'hosted-contributor', '@users', '.noreply', '.github', '.com'].join(''),
  committerName: 'GitHub',
  committerEmail: ['noreply', '@', 'github.com'].join(''),
  subject: 'fix(runtime): example',
  message: `fix(runtime): example\n\nCo-authored-by: ${canonicalIdentity}\n`,
  rawCommit: 'tree abc\nparent def\ngpgsig -----BEGIN PGP SIGNATURE-----\n signature\n',
  parentCount: 1,
};
assert.deepEqual(inspect(
  'metadata.txt',
  canonicalCommitIdentityText(hostedSquashIdentity),
), []);
assert.deepEqual(inspect(
  'metadata.txt',
  canonicalCommitIdentityText({
    ...hostedSquashIdentity,
    authorName: 'HappyHerd Maintainers',
    authorEmail: 'maintainers@happyherd.example',
    committerName: 'HappyHerd Maintainers',
    committerEmail: 'maintainers@happyherd.example',
    rawCommit: 'tree abc\nparent def\n',
  }),
), []);
for (const unsafeIdentity of [
  { ...hostedSquashIdentity, rawCommit: 'tree abc\nparent def\n' },
  { ...hostedSquashIdentity, message: 'fix(runtime): example\n' },
  { ...hostedSquashIdentity, parentCount: 2 },
]) {
  assert.equal(canonicalCommitIdentityText(unsafeIdentity), null);
}

const normalizedHistoricalIdentity = {
  ...hostedSquashIdentity,
  commit: 'd6c14a9abf9bafb531f1b3a5212007a360bdd665',
  authorName: 'HappyHerd Maintainers',
  authorEmail: 'maintainers@happyherd.example',
  committerName: 'Legacy Hosting Account',
  committerEmail: ['legacy-host', '@users', '.noreply', '.github', '.com'].join(''),
  rawCommit: 'tree abc\nparent def\n',
  message: 'fix(release): example\n',
};
assert.deepEqual(inspect(
  'metadata.txt',
  canonicalCommitIdentityText(normalizedHistoricalIdentity),
), []);
assert.equal(canonicalCommitIdentityText({
  ...normalizedHistoricalIdentity,
  commit: 'd6c14a9abf9bafb531f1b3a5212007a360bdd664',
}), null);

process.stdout.write('public-boundary self-test: ok\n');
