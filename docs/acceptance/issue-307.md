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
