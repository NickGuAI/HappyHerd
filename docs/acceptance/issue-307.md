# #307 non-CLI naming evidence

Owning issue: https://github.com/NickGuAI/HappyHerd/issues/307
PR: https://github.com/NickGuAI/HappyHerd/pull/318
Dependency: #316 through `0fd296d2fd5210b1e2d85eb4332cd480e4f41887`.

## Golden refresh

The production job in run
https://github.com/NickGuAI/HappyHerd/actions/runs/35549258903/job/106180873686
built and executed source head `983b8caabadf07be1dc29e53903db2b6818bd6c4`.
Artifact `kilv-golden-35549258903` (`10617996693`) reported 28 comparisons,
12 differences, no dimension changes. The other 16 panels were pixel-identical.

Reviewed all 12 actual images plus representative readable diffs. The changes
are the new changelog entry and HappyHerd copy on restore-device and terminal
pairing, including the natural mobile text reflow. Preserve the full-raster
comparison, all 28 cases, existing tolerance, and synthetic/offline fixtures.
The 12 reviewed `*-actual.png` files replace only their corresponding canonical
baselines in `docs/acceptance/issue-287/golden/` (three panels × two widths × two
themes). Subsequent CI comparison is the acceptance gate for the new revision.

## Compatibility proof

- `scripts/rename-product.test.mjs`: complete baseline repository transformed
  twice, with collisions/idempotence and exact auth/crypto/history/binary bytes.
- App `normalizeProductLink.test.ts` and `reducer/messageToEvent.test.ts`: current
  and historical schemes/tool names; payload/user-title byte preservation.
- Control-agent `config.test.ts`: historical environment selects the existing
  credential file without mutation, canonical configuration wins when present.
- Control-agent `session.test.ts`: retained encrypted `sentFrom` metadata.
- App `ops.rigSpawn.test.ts`: retains external Rig request discriminators.
- Codium `app-storage.test.ts`: historical platform-specific storage roots.
- Native identities, SecureStore/MMKV keys, server token namespaces, migrations,
  existing bridge/daemon homes and data mount locations stay stable.

## Verification commands

Use Node 20.20.2, pnpm 10.11.0, Bun 1.3.11 and ShellCheck. On macOS the shell
contracts need GNU sed and a canonical `/private/...` TMPDIR for realpath-based
fixtures. Set `TZ=UTC` for server date fixtures and `HAPPYHERD_LINT_BASE=origin/main`
to use the same source comparison as this PR.

The repository contract now includes both scoped naming checks and the full
non-CLI two-rename regression. Run `scripts/contract-suite.sh` from a clean tree,
then the independent i18n, production Web export/smoke, self-host Web bundle and
native installer checks described in `.dev/VERIFY.md`. PR check conclusions and
exact-head sign-off belong in the PR; a source assertion is not a live migration
or native signing receipt.

## Reviewed implementation revision

Implementation head: `7d5ad1ce` (comparison base `0fd296d2`). The review traced
package/module providers and CLI consumers, exact encryption domains and stored
identity fields, both generations of pairing/title messages, external Rig spawn
payloads, and deployed bridge/daemon homes. The control-agent naming collision
is resolved without changing the governed bridge identity. No runtime migration
of existing records is performed.

Verified package results:

| Surface | Files | Passed tests |
| --- | ---: | ---: |
| App | 288 | 2,884 (one additional skipped test) |
| Wire | 14 | 80 |
| Control agent | 11 | 253 |
| Governed agent | 11 | 52 |
| CLI | 182 | 1,799 |
| Server | 31 | 176 |
| Codium | 4 | 100 |

The full local contract passed on `cb0ef920`; the later Codium symbol change
passed its complete typecheck/test suite and both full-repository rename
regressions. On `7d5ad1ce`, actual CI passed the full Contract suite
([job](https://github.com/NickGuAI/HappyHerd/actions/runs/35551571326/job/106188318423)),
clean install, lint, typecheck/i18n, production build including the 28-case golden
comparison, server/Web image, and all four native installer build/smoke targets.
Local self-host runtime/Web bundling and the production iOS JavaScript export
also passed. Changelog parsing produced 150 entries with the #307 entry newest.

The independent CI Unit job on that same revision failed two unchanged CLI
`run.preSpawn.test.ts` scheduler settlement waits, while the full Contract job
passed the same CLI suite. The failure and #297 ownership were recorded in
[the coordination receipt](https://github.com/NickGuAI/HappyHerd/pull/316#issuecomment-5754417574).
GitHub denied a failed-job rerun to the non-admin account. Final CI status must
therefore be read from the PR's latest head; this historical receipt does not
convert that failed attempt into a pass. A local parallel app run also exposed
the existing canvas-edge measurement timing failure; the corresponding CI app
suites and the focused local browser rerun passed.

## Build and activation boundary

The four installer targets prove packaged CLI/self-host execution and their
upgrade/auth smoke contracts. They are distinct from compiled iOS/Tauri app
artifacts. This host has Xcode 27 but no CocoaPods or Rust/Cargo installation, so
an Xcode native Release build and Tauri DMG were not verified. The production iOS
JavaScript bundle was verified. Apple signing/notarization, real account/provider
upgrade journeys, and deployment remain unproved and were not performed.

The user authorized implementation, commits, push and PR delivery only; no merge,
deployment, email, real-host installation, or service/daemon restart was done.
