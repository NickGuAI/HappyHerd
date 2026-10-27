# Changelog capture import from diagnostic revision

Capture source: 391cfa01870c0c88809389ae84a6921c2062274e, tree c1f8aeaf02fa154011f7e7ee2dd5ffbe57f69399. Quality run 38972231544, first attempt, artifact 12077662954 (`kilv-golden-38972231544`, archive digest SHA-256 44eea7702de3fd616f651ce30ca1937eb25cff59ff065ca5db6dc924d9977abd), browser 1.62.1, normal compare mode with 28 variants.

All four first workflow logs and terminal job catalogs were retained before import. Quality failed only at golden comparison; Native (including prepared darwin-x64), Image and Contracts succeeded, with the actual `contract-suite: ok` marker. These source-changed results do not explain or erase the original native failure on e099. Full #414 signoff and reported-session/live-provider proof remain pending.

Root reviewed all four actual/diff image pairs and verified the four expected images against previously reviewed baselines. The two October 15 changelog entries are readable at 1440/390 widths in light/dark themes; differences are entry content and displacement of older text. All other 24 payload images are byte-identical to tracked baselines.

The unchanged maintained `scripts/kilv-golden-update.mjs` ran once under Node 20.20.2, exited 0 and imported the exact-head CI artifact through its supported internal download. This download is separate from the earlier one-time inspection download. No manual image copy, old e099 capture reuse, browser run, config/assertion/budget change or package retest occurred. The importer writes 28 images, but only the four approved changelog PNG bytes changed; all 28 paths and modes remain unchanged. All source/tests/config/lock/changelog and original evidence receipts remain unchanged by import.

The actual tested diagnostic packet remains 5f12aa9f: 10 Node tests, 30 focused Vitest tests, explicit CLI build and typecheck passed before the ten comment/blank-line whitespace removals. Normalized parity remains valid; no claim is made that PNG import reran these tests. The 201-entry changelog parser result remains historical source proof. The original lint and unsupported-style-subject gate failures are preserved.

Approved imported PNG SHA-256 values:

- `production-changelog-latest-entries-dark-1440.png`: `884e8e78c567bba7778479387192c4154ac1cc28dfecc704bafc23b567629ad7`
- `production-changelog-latest-entries-dark-390.png`: `a674614547a16688067e7e99097a2b4fbd3e969c480bb94fc1ec8b410700c1d2`
- `production-changelog-latest-entries-light-1440.png`: `b39aff469d86897af756a8ace1368cacf84c927b8796d6f6c362aded0f916ac6`
- `production-changelog-latest-entries-light-390.png`: `7714dc94544198bbdf6886c41481ad829ce5ae5403a1f70971826c225653e99d`

This local capture commit is subject to exact-head light gates and independent review. No publication, new CI, merge or runtime activation is claimed here.
