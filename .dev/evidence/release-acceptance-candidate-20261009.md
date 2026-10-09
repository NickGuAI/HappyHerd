# Local stacked release acceptance candidate — UNVERIFIED

This is a local, unpushed review candidate, not a release revision or a new PR.
Parent explicitly approved only source composition of:

- base main `3a3773303a5539f6c9deddbd04197b92cbab9a76`;
- #418 `2a1493ae9226bfe54c425eef4eccf8d29724134d`;
- #416 `5b946b4af9760194d964fa2829974a9b3abfd643`.

No #369, #413, or other unmerged code is included. No dependency install,
build, capture, runtime action, provider turn, push, merge, tag, publication,
or deployment is authorized by this candidate's creation.

## Resolution record

This stack starts at exact #416 head `5b946b4af9760194d964fa2829974a9b3abfd643`,
then applies #418's two commits with their original subjects. Original PR
branches remain unchanged. Its source is byte-identical to the previously
reviewed local composition `2cc8d3f02a9136eb49290c75fbc8b13e808b4406`,
excluding this provenance record. Text conflicts occurred
in `docs/public-launcher-release.md`, app `CHANGELOG.md`, and generated
`changelog.json`. The guide retains the first-run link and October 8 availability
check. Both October 8 entries survive, release identity first and first-run
second. The existing parser, run with the already installed pinned Bun,
produced 193 entries with release identity as `latestTitle`.

README navigation/availability and all unique ledger rows merged without a
content conflict. The nine overlapping paths were reviewed according to the
parent's explicit path plan. The four binary conflicts were resolved by
retaining the existing #418 images solely as known historical baselines.

## Golden status: UNVERIFIED FOR THIS COMBINED TREE

These four files still describe **#418 source only**, from its reviewed
`38512f8892525ac67a1245b1ba17416073c881e9` capture, accepted in
`2a1493ae9226bfe54c425eef4eccf8d29724134d`:

- `docs/acceptance/issue-287/golden/production-changelog-latest-entries-dark-1440.png`
- `docs/acceptance/issue-287/golden/production-changelog-latest-entries-dark-390.png`
- `docs/acceptance/issue-287/golden/production-changelog-latest-entries-light-1440.png`
- `docs/acceptance/issue-287/golden/production-changelog-latest-entries-light-390.png`

They do not contain #416's extra first-run changelog entry. Neither original
PR's golden pass transfers to this combined candidate. No new captures were
ingested. The other 24 baseline PNGs remain byte-identical to base main.
A future separately approved combined-source comparison must preserve its
first failure and review every expected/actual/diff before accepting exactly
the supported changes. No assertion, timeout, skip or expected-image threshold
has changed.

## Evidence boundaries

Original #416 and #418 source/CI receipts apply only to their own recorded
heads. The #378 guide's stable 1.2.4 preflight remains historical evidence,
not an authenticated journey on this composition. This candidate has no
archive identity, build proof, golden pass, CI pass, device proof or live
acceptance. Source-only parser, parity, link and conflict checks are permitted.

Next decision belongs to parent: review exact stack head/tree and independent
review, then explicitly authorize any scoped update of existing PR #418 and
its base to #416. No push or PR-base update is authorized by this preparation.
The actual future merged main SHA and publication remain unselected and
unauthorized. No source-only result satisfies original #383 or #378 acceptance.
