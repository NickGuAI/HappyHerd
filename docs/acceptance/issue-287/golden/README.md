# KILV golden-image gate

Owner: #287 / PR #289. Approved scope: [golden-image brief](https://github.com/NickGuAI/HappyHerd/issues/287#issuecomment-5750033647).

The existing required **Production build** check runs strict pixelmatch against
28 committed PNG baselines: five production-export panels (landing, secret-key
restore with synthetic draft, mobile-device restore offline, server configuration
with synthetic draft, changelog) and two component fixtures (Appearance and
Connect Terminal). Each runs at desktop/mobile widths and in light/dark themes.
The workflow names this subset. PR events always compare; they cannot regenerate.

The browser is lockfile-pinned Playwright Chromium on the GitHub Ubuntu runner.
Fonts come from the repository. Carets and animations are disabled at capture;
comparison includes antialiasing and permits **zero changed pixels**. Geometry
and colors are evaluated through screenshots, without CSS pixel/hex assertions.

## Regenerate

Push the intended source to the PR branch, then from `server/` run:

```sh
pnpm --filter happy-app golden:update
```

This one command waits for the existing PR quality workflow on local HEAD and
downloads its complete capture artifact, including from a comparison that failed
against outdated/missing baselines. Requires authenticated `gh` with read-only
Actions access. Review the changed PNGs, add the exact
conventional commit subject to `docs/owned-patches.tsv`, and make one owned commit.
The command does not commit/push and does not change the 380 historical review PNGs.
Regeneration is intentionally done in CI's Linux browser environment, avoiding
macOS/Linux rasterization differences.

## Failures and sensitivity proof

Every comparison uploads `kilv-golden-RUN_ID` (30-day retention): `summary.json`,
captured images, and `index.html` with linked expected/actual/diff triptychs for
failures. Download and open `index.html`. Missing baselines and changed dimensions
also fail. Reproduce on the same Linux environment with a production `dist-ci`
export, `pnpm --filter happy-app exec playwright-core install --with-deps chromium`,
then `pnpm --filter happy-app golden:test`.

The explicit workflow-dispatch `golden_mode=one-pixel` diagnostic changes exactly
one screenshot pixel after rendering, runs the **same comparator**, and must fail
Production build with one differing pixel and a diff image. It never changes the
baseline or production code. The final PR run uses normal compare mode.

## Evidence boundaries

The five production panels use the actual exported Web application with its
backend offline. Appearance/Terminal use the existing production components,
theme, fonts and icons through documented synthetic service/state and Web/native
adapters. These snapshots do not prove live authentication or native behavior.
The old gallery retains its original capture revision and 380 PNGs unchanged.

Still unproved: native `OAuthView.tsx` has no screenshot; device-pairing QR
ready/success, physical iPhone Safari keyboard/zoom, installed-client surfaces,
and authenticated/live journeys. Green CI does not close those acceptance gaps.

## Latest-head unit/contract repair

On `11dd44bb`, all seven Connections browser tests timed out before mounting.
Local page-error instrumentation exposed `Typography.mono is not a function`:
the old fixture replaced Typography with a default-only object. It now imports
production Typography and the production light theme instead of incomplete
copies. All seven original behavior tests pass with their original timeouts.
