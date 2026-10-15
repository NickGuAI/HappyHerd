# #364 source-phase acceptance

Owner: <https://github.com/NickGuAI/HappyHerd/issues/364>.
Base: `632dc24332e49bfd773c5163ab8c045a3b74a5cf`.
Branch: `task/issue-364-astra-20261015`.
Session: `cmva5cvoq157rt01sya3ckx3r`; assigned GPT-6-Astra / medium / yolo.
No additional provider session was created.

## Repair boundary

Antigravity now reaches the existing encrypted machine RPC from the shared
Context window. Without a verified native identity and replay contract it
returns the explicit localized `agy_context_unavailable` receipt and Retry.
No native success, full-content reconstruction, or live provider proof is
claimed. See [the source investigation](skills/happyherd-update-provider/references/antigravity.md#context-window-investigation-364--2026-10-15).

The Human journey is Settings → Features → Experimental → Context window,
then the existing session menu → Context window → explanation → Retry.
Account experiment state remains off by default and survives route reload.
Desktop 1440×900 and Mobile 390×844 are targeted; native platforms are outside
this issue's specified render matrix. Prepared browser tests use the existing
production route/SessionView harness and synthetic unavailable RPC responses.

## Initial evidence, 2026-10-15

- Read the issue and current comments with `gh issue view` once; `gh pr list`
  returned no open task-owned PR. Initial tree was clean at the supplied base.
- Read actual adapter, registration, wire and shared-view source, official
  Antigravity docs and installed IDE package source. No native state content
  was accessed. No provider was started.
- `pnpm --version`: `10.11.0`; host `node --version`: `v26.6.0`.
  Root CI documents Node 20; this host syntax check is not CI proof.
- `pnpm --filter happyherd-app i18n:generate`: passed, 1737 keys in en/cn/de.
- Ran the existing changelog parser via Node's built-in TypeScript stripping
  and CommonJS import adaptation, with no dependency install: 200 entries;
  latest `October 15 — Explain unavailable Antigravity context`.
- Built-in TypeScript syntax stripping passed for all 9 changed `.ts` files;
  this is syntax evidence only, not typechecking.
- `node scripts/lint-source.mjs`: passed. `git diff --check`: passed.

First failures retained: some initial reads and the browser-test insertion
used a redundant `server/` prefix with `server/` as cwd (file-not-found;
corrected before insertion). One source search named a nonexistent
`src/agent/backends` directory; source ownership was located under `src/agy`.
The first parent message send used the root `.task` path while its file was
under `server/.task`; it returned ENOENT, then succeeded with the same message
ID at the correct path. The note was subsequently relocated to ignored
`.artifacts/issue-364`. The first parser attempt used unsupported
`stripTypeScriptTypes` mode `transform`; rerunning in its default strip mode
succeeded. A read of the guessed `generate-i18n.mjs` filename failed; the actual
package script is `validate-i18n.mjs --write`. None was a package/test result.

## Required proof still pending the parent's capacity slot

No dependency installation, package test/build, browser, device or runtime
suite has run. Prepared regressions are unexecuted. Run, in order:

1. Frozen dependencies with pinned pnpm; retain the first failure if any.
2. Wire context schema tests, CLI `readContextWindow` and
   `apiMachine.contextWindow` tests, app `sync/contextWindow` tests.
3. `sideChatHeader.browser.test.ts -t 'Antigravity Context window'`, with
   `HAPPYHERD_CONTEXT_WINDOW_SCREENSHOT_DIR` pointing to task-owned artifacts.
4. App UI inventory/tree regeneration, i18n checks, affected CLI/app package
   checks and web export, then applicable repository contract gates.
5. Review the exact committed head against #364 and these named limitations;
   publication remains separately gated by the parent.

Native compaction/retention/hidden-content/fork/rollback fixtures are **not
available** from the inspected CLI source contract. A synthetic success would
fabricate proof. Authenticated live RPC/render/full-content reads are
**unproved** and no live Antigravity invocation is authorized. No assertion or
budget was weakened to turn these gaps green.

## Provisional lane classification

- Shared protocol / daemon-resident CLI: additive error receipt through the
  existing handler; package and encrypted RPC evidence pending.
- Web/frontend: provider dispatch and en/cn/de notice; rendered desktop/mobile
  proof and export pending. Existing shared view/Retry is reused.
- Provider reference / recipe / changelog: source-derived documentation.
- No central server, provider installation, transcript, or ordinary chat change.

Status: **Not signed off**. Merge, deployment, restart, issue closure and
publication were not performed. Parent owns final coordination and handoff.


## Exclusive no-browser validation — 2026-10-15

This later authorized stage supersedes only the earlier pending no-browser
checks, not its historical source-only receipt or native/rendering limits.
Tested source: `606190d7bfbd3ae382df3668d2c98ad9c4f4440d`, tree
`c29a6027bf453c201ceece0cf620eaf8a6e2ab3d`; initial tracked tree clean.
Input and final lockfile SHA-256 both
`79bd621c488cbabaab545159e95b9c685be430e0573eac3d8b7cc10a750fcae4`.
Node **20.20.2**, pnpm **10.11.0**, selected through task-owned PATH wrappers
for the parent-specified existing binaries. No tool install or HOME override.

One filtered frozen install used `--filter @happyherd/cli... --filter
happyherd-app... --ignore-scripts` and the own store
`/private/tmp/happyherd-364-astra-20261015-pnpm-store`. Lifecycle scripts were
not broadly enabled. The unchanged root postinstall ran once (maintained
patches and wire build), followed by explicit control-agent and CLI builds.
No separate explicit wire build ran. The existing CLI global setup remained
intact and printed its own build output; the prior explicit build independently
proved natural success.

| Assigned stage | Natural exit | Seconds |
|---|---:|---:|
| install | 0 | 25.42 |
| root-postinstall | 0 | 4.47 |
| control-build | 0 | 3.40 |
| cli-build | 0 | 9.74 |
| wire-test | 0 | 1.03 |
| cli-test | 0 | 20.58 |
| app-unit | 0 | 1.16 |
| cli-typecheck | 0 | 5.37 |
| app-typecheck | 0 | 17.49 |
| inventory | 0 | 2.18 |
| i18n | 0 | 3.29 |
| parser | 0 | 1.08 |

Focused evidence: wire `src/contextWindow.test.ts` **4 passed**; CLI
`src/contextWindow/readContextWindow.test.ts` and
`src/api/apiMachine.contextWindow.test.ts` **29 passed**; app
`sources/sync/contextWindow.test.ts` **28 passed**. Total **61 tests**.
Both declared package typechecks passed. No tests or failed stages were retried;
no test assertions, budgets, worker policy or configs changed. There was no
natural stage failure. Preserved warnings include the workspace expo-tailcat
Node >=22 engine warning on the assigned Node20 and pkgroll bin/empty-chunk
warnings; all assigned commands exited 0.

The maintained inventory generator and full `i18n:check` passed: **45 routes,
349 surfaces, 84 smoke cases, 1737 catalog keys**, zero production hardcoded-copy
exceptions. Generated JSON and HTML differ only in their source fingerprint;
all route/surface/key/smoke content is identical to the committed input.
New source fingerprint: `afad531377518b9b65231feff7000746e52ce64aae902d16e4c0fc7ef9bbb43c`.
Artifact fingerprint:
`1324e3fbe00fd14be387b96afe8693f8ef172d046b363d65c76aee08b804fe97`.
The official `pnpm --filter happyherd-app exec tsx
sources/scripts/parseChangelog.ts` produced **200 entries**, latest
**October 15 — Explain unavailable Antigravity context**, with no JSON diff
from the source-phase result. No manual parser adaptation was used this stage.

Complete per-stage command argv, cwd, stdout/stderr, exit, timing, PID/PGID,
space samples and final parity receipt are retained under the task-owned
`.artifacts/issue-364/validation/`; `logs.sha256.json` fingerprints every full
stdout/stderr file. The finite runner charged **185.59s**, including
its conservative 90-second preflight allowance, against the single 1800s
budget. No stage budget reset. Minimum observed free bytes:
**13987229696**; stage-final free bytes **13993631744** (both >8 GiB).
All recorded owned process groups were absent at terminal inspection; no
process cleanup or signals were needed. Targeted footprint: root node_modules
3,600,548 KiB; app-local node_modules 15,152 KiB; CLI-local 164 KiB; own store
3,451,560 KiB. These `du` figures must not be summed as physical consumption
because pnpm can hard-link store and installation files.

Only the two expected generated artifacts changed during validation. Every
other tracked source/config/lock file retained input parity. The subsequent
local commit contains those generated outputs plus this evidence and the
required ledger line; it does not change the tested production/test sources.
Exact-head independent review remains pending. Browser screenshots/gestures,
web export, full app/package/contract/CI checks and authenticated live reads
are **not run in this stage**, and are not implied by these passes. Native
full-context recovery remains unproved; implemented support is the authorized
unavailable-with-Retry alternative. No push, PR, deployment, restart or provider
invocation occurred. Status remains **Not signed off** pending later evidence.


## Rendered fixture and capture follow-up — 2026-10-15

Parent independently reviewed source head `5cfbff006c44df1355871be8fc2e4b2b0afadca8`
against `632dc24332e49bfd773c5163ab8c045a3b74a5cf` and reported no actionable
source findings. The first assigned browser run on that head naturally passed
**2 cases, 164 unselected (166 collected)** at 1440×900 and 390×844. Its eight
original captures and complete logs remain unchanged in
`.artifacts/issue-364/render-first/` and `render-validation/`. The desktop
switch capture looked off despite its checked-state assertion and persisted
session entry; the parent independently viewed all eight and classified this
as a capture proof gap, not an established product defect.

The authorized follow-up adds only `animations: 'disabled'` to the optional
screenshot helper for these two cases. Installed Playwright screenshot types
(documentation at `types/types.d.ts:12174`) specify that finite CSS transitions
fast-forward to completion. There is no sleep, altered assertion, selector,
fixture algorithm, production behavior, timeout, worker setting or image edit.
The option operates only when the screenshot environment variable is present.

The changed capture source SHA-256 tested before this commit is
`7499f7ed46d5669cb00f257e2de76b9abe21172211aa9519a39cdf723d4c40f4`. All production source remains byte-identical to the earlier
61-test `606190d7` input. The new run is evidence after this source correction,
not a reproduction of the original screenshots or an unchanged retry.

Exactly once, with own pinned Node20.20.2/pnpm10.11.0, from `server/`:

```sh
HAPPYHERD_CONTEXT_WINDOW_SCREENSHOT_DIR=/Users/bot/Projects/happyherd-issue-364-astra-20261015/.artifacts/issue-364/render-settled-first pnpm --filter happyherd-app exec vitest run sources/components/sideChatHeader.browser.test.ts -t 'Antigravity Context window'
pnpm --filter happyherd-app typecheck
pnpm --filter happyherd-app i18n:check
```

All three naturally exited **0**. Browser: **2 passed, 164 unselected**;
1440×900 case 2269 ms, 390×844 case 2717 ms. Original beforeAll/case/default
runner budgets remain unchanged. No install, download, executable override,
provider/IDE invocation or account access. Standard Chrome channel launched
an isolated ephemeral profile. App typecheck validates the actual screenshot
option type. Full i18n check passed with the current maintained inventory;
no stale inventory or generated diff occurred. Changelog/parser were unchanged
and were not rerun.

All eight new images were visually reviewed: both Context window switches
visibly on; both entry menus readable; full unavailable notice and Retry fit
both viewports; reload preserves the notice. These are production-host
**synthetic RPC fixture** journeys, not authenticated live/native context
reads. Root independent screenshot acceptance and new-head review remain
pending. Full browser/package/contract/export/CI coverage is not implied.

| Actual new capture | Dimensions | SHA-256 |
|---|---|---|
| agy-1440-entry.png | 1440×900 | `2b403cad993fc120cc9a998a036ab1f645bf5464406c8c3cda4bb5848658a2d2` |
| agy-1440-retry-reload.png | 1440×900 | `1768318b8a4486bee4cc6f70d7a65b72c6527135c8e902ddbb546d7378619914` |
| agy-1440-switch.png | 1440×900 | `3c804930a18ca24a5b0785a7cd36cc460f1c165dfa1037f863f286f98c9300dd` |
| agy-1440-unavailable.png | 1440×900 | `1768318b8a4486bee4cc6f70d7a65b72c6527135c8e902ddbb546d7378619914` |
| agy-390-entry.png | 390×844 | `17467f57a25e903f709eff9feadcb53df7351b191b48e5bb1f497301f3a4b887` |
| agy-390-retry-reload.png | 390×844 | `05cf0173d00f4ed18493c72329610cbbe420cb11fb1a0108f995c1c09dce2351` |
| agy-390-switch.png | 390×844 | `81ce6e382ba7a5df2fac37af898f7b663a3a087b4a8bacafee45ce22232ec88f` |
| agy-390-unavailable.png | 390×844 | `05cf0173d00f4ed18493c72329610cbbe420cb11fb1a0108f995c1c09dce2351` |

The complete paths, dimensions, capture source hash and logs are retained in
`.artifacts/issue-364/render-settled-validation/screenshots.json`,
`receipt.json`, and per-stage stdout/stderr files. Startup records are retained
without replacing the first run. Historical artifact hashes were rechecked
unchanged. Minimum free bytes through this evidence step:
**13433069568**, final **16111427584** (>8 GiB).
Charged elapsed **137.74s** including preflight allowance
within the single 600s follow-up budget. No remaining owned process-group
members; own temporary profile removed/no active members; observed loopback
ports refused connections. Teardown needed no manual signals or cleanup.

The local capture commit contains only the one screenshot option, this
truthful evidence and its exact ledger entry. No push/PR or full native
recovery acceptance. Status remains **Not signed off** for final delivery
pending the parent's remaining staged checks and exact-head review.


## Public capture evidence

After the parent independently reviewed the two settled switch images and
matched the other six images byte-for-byte to its earlier visual review, the
eight exact settled PNGs were copied to `docs/acceptance/issue-364/` with a
sanitary relative-filename manifest and README. Copy hashes were verified;
no image was edited, resized or recaptured. The manifest identifies the actual
pre-commit capture source (`5cfbff00` plus the one screenshot option, later
committed as `71b3ff9c`), not the later evidence-publication head. No private
paths, process information, account content or raw logs are included there.
