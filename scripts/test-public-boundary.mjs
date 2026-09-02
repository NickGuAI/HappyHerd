#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  canonicalCommitIdentityText,
  inspectEntries,
  syntheticPullRequestMergeParents,
} from './verify-public-boundary.mjs';
import { hasExactMarkdownLink } from './verify-community-contract.mjs';

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
const approvedSupportUrl = ['https://buymeacoffee.com/', 'nick', 'guy'].join('');
assert.deepEqual(inspect('README.md', `Support HappyHerd at ${approvedSupportUrl}.`), []);
assert(inspect('README.md', `${approvedSupportUrl}-unapproved`).includes(
  'operator-specific personal identity',
));
const approvedRepositoryOwner = ['Nick', 'GuAI'].join('');
for (const url of [
  `https://github.com/${approvedRepositoryOwner}/HappyHerd`,
  `https://raw.githubusercontent.com/${approvedRepositoryOwner}/HappyHerd/main/install.sh`,
]) {
  assert.deepEqual(inspect('README.md', `Install from ${url}.`), []);
}
assert(inspect('README.md', `https://github.com/${approvedRepositoryOwner}/OtherProject`).includes(
  'operator-specific personal identity',
));
assert(inspect('README.md', `https://github.com/${approvedRepositoryOwner}/HappyHerd.evil`).includes(
  'operator-specific personal identity',
));
for (const suffix of ['.evil', ',evil']) {
  assert(inspect('README.md', `${approvedSupportUrl}${suffix}`).includes(
    'operator-specific personal identity',
  ));
}
assert.equal(hasExactMarkdownLink(`[support](${approvedSupportUrl})`, approvedSupportUrl), true);
assert.equal(hasExactMarkdownLink(`[support](${approvedSupportUrl}.evil)`, approvedSupportUrl), false);
assert.equal(hasExactMarkdownLink(`[support](${approvedSupportUrl},evil)`, approvedSupportUrl), false);
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

const hostedMergeIdentity = {
  ...hostedSquashIdentity,
  subject: `Merge pull request #123 from ${['Nick', 'GuAI'].join('')}/feature`,
  message: 'Merge pull request #123\n\nExample change\n',
  rawCommit: 'tree abc\nparent def\nparent ghi\ngpgsig -----BEGIN PGP SIGNATURE-----\n signature\n',
  parentCount: 2,
};
assert.equal(
  canonicalCommitIdentityText(hostedMergeIdentity),
  `${canonicalIdentity}\n${canonicalIdentity}\nMerge pull request #123`,
);
assert.deepEqual(inspect(
  'metadata.txt',
  canonicalCommitIdentityText(hostedMergeIdentity),
), []);
for (const unsafeIdentity of [
  { ...hostedMergeIdentity, rawCommit: 'tree abc\nparent def\nparent ghi\n' },
  { ...hostedMergeIdentity, subject: 'Merge branch feature' },
  { ...hostedMergeIdentity, parentCount: 1 },
  { ...hostedMergeIdentity, parentCount: 3 },
  { ...hostedMergeIdentity, authorEmail: ['person', '@', 'private.example.net'].join('') },
  { ...hostedMergeIdentity, committerName: 'Hosted Contributor' },
  { ...hostedMergeIdentity, committerEmail: 'noreply@example.com' },
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

const normalizedSkillIdentity = {
  ...hostedSquashIdentity,
  commit: '119420c5425a62f37a0aae138f04078830611dfa',
  authorName: 'OpenAI Codex',
  authorEmail: ['assistant', '@', 'pioneering', 'minds', '.ai'].join(''),
  committerName: 'OpenAI Codex',
  committerEmail: ['assistant', '@', 'pioneering', 'minds', '.ai'].join(''),
  rawCommit: 'tree abc\nparent def\n',
  subject: 'docs: add mobile UX regression guardrails',
  message: 'docs: add mobile UX regression guardrails\n',
};
assert.deepEqual(inspect(
  'metadata.txt',
  canonicalCommitIdentityText(normalizedSkillIdentity),
), []);
assert.equal(canonicalCommitIdentityText({
  ...normalizedSkillIdentity,
  commit: '119420c5425a62f37a0aae138f04078830611dfb',
}), null);

process.stdout.write('public-boundary self-test: ok\n');
