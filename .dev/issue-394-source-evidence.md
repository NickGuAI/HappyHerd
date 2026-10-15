# Issue #394: source-phase evidence

Owner: https://github.com/NickGuAI/HappyHerd/issues/394

Baseline: `632dc24332e49bfd773c5163ab8c045a3b74a5cf`.
Branch: `task/issue-394-astra-20261015`.
Worker session: `cmva5cpm5157ht01s9si0jngl`.

## Established boundary

The issue and comments were read on 2026-10-15. The report does not include
an affected native version or a captured missing-subscription event/exit.
This patch does **not** establish that cause or implement subscription-driven
rotation. It repairs the independently source-evidenced false-completion part
of the acceptance contract.

`claudeRemote.ts` previously called `onReady()` for native SDK failure results
unless a narrow auth/quota classifier had already recognized the cause.
`claudeRemoteLauncher.ts` interprets that as a completed wire turn and may send
a done push. The patch passes `failed` for `is_error` results and non-success
result subtypes, and suppresses a successful-compaction announcement. Existing
quota handling remains earlier in the result path, preserving its interrupted
batch and daemon-owned rotation behavior.

The new fixtures model generic SDK errors, not the missing-subscription refusal.
They cover failed completion, unchanged error forwarding, no invented auth
classification, no quota notification, a separately queued next prompt through
the same resumed query, no replay, and launcher output flush before one failed
wire turn closes without a done notification.

## Rotation trace and unresolved cause

`providerLimits.ts` accepts rejected usage events or a provider-marked
`assistant.error=rate_limit` with an SDK-owned usage-limit prefix.
`providerLimitNotice.ts` attributes the incident to the stable account/version.
The daemon validates ownership and calls `rotateProviderSessionAfterLimit`.
`rotation.ts` marks the account temporarily limited, stops the process and
resumes the same HappyHerd session through `resumeSession`. The daemon verifies
the returned session ID before persisting the switch event. If all accounts
are limited, it publishes quota exhaustion and waits for the earliest cooldown.
This temporary quota state is not evidence of subscription eligibility. An
unknown subscription refusal must not be assigned a manufactured cooldown.

Required before full issue acceptance: sanitized actual native event/exception
or exit, affected Claude/SDK versions, a usable saved alternative case, and the
no-usable-alternative case through the supported native path. Neither private
provider state nor credentials were inspected; no real provider turn ran.

## Source-phase checks

- `git diff --check`: passed.
- `HAPPYHERD_LINT_BASE=632dc24332e49bfd773c5163ab8c045a3b74a5cf node scripts/lint-source.mjs`:
  passed (9 paths including local coordination notes).
- Node 26.6.0 built-in `stripTypeScriptTypes` parsed the three changed TypeScript
  files: passed. This is syntax evidence, not TypeScript typechecking.
- Unchanged `parseChangelog.ts` exported parser invoked through Node's built-in
  TypeScript import with its CommonJS path globals supplied: generated 200
  entries, latest `October 15 — Report failed Claude turns accurately`.
  No dependencies were installed. The pinned pnpm/tsx invocation remains to run.
- Focused CLI tests, CLI typecheck, affected package checks, rendered UI,
  exact-head review, CI, and live provider proof: not run in this source phase.
  Parent owns the sequential capacity slot and publication authorization.

No PR, push, merge, deployment, restart, account mutation, or issue closure.
No claims of a complete #394 fix or native acceptance.

Initial operational failures retained: one source-read batch mistakenly used
root-relative paths from `server/` and returned file-not-found; rerun from the
repository root succeeded. The first parent send used the wrong absolute path
to its task note and returned `ENOENT`; retry with the corrected path and the
same message ID succeeded (`queued`, seq 17462). These were not test runs.

## Intended focused verification

From `server/`, use the pinned pnpm and current lockfile once capacity is assigned:

```sh
pnpm --filter @happyherd/cli exec vitest run src/claude/claudeRemote.test.ts src/claude/claudeRemote.rotation.test.ts src/claude/claudeRemoteLauncher.test.ts src/credentialPool/providerLimits.test.ts src/credentialPool/providerLimitNotice.test.ts src/credentialPool/rotation.test.ts
pnpm --filter @happyherd/cli typecheck
pnpm --filter happyherd-app exec tsx sources/scripts/parseChangelog.ts
```

Then apply the affected-package and exact-head gates from `.dev/VERIFY.md`.

## Authorized CLI verification, 2026-10-15

The parent subsequently authorized two exclusive, bounded resource phases.
The earlier source-only results above are historical, not the final test status.
Both used verified Node **20.20.2** and pnpm **10.11.0**, command-scoped PATH
wrappers, and this worktree's own fresh dependency installation. No provider,
account, integration, browser, or device test ran.

The own installed Agent SDK is **0.3.296**. Its `sdk.d.ts` describes
`SDKResultMessage` as the turn-complete signal and explicitly documents
`subtype: success` with `is_error: true` as API-error text. Native error subtypes
include execution, max-turn, max-budget and structured-output retry failures.
The patch now uses the launcher's exact successful-result predicate:
`subtype === 'success' && is_error !== true`, while retaining auth-failure
precedence and the earlier hard-limit branch.

### First phase: retained natural failure

- One filtered frozen install with ignored scripts and a fresh own store:
  exit 0, 27.198s.
- Unchanged maintained root postinstall, including wire build: exit 0, 5.438s.
- Two-file focused Vitest command: exit 1, 10.958s; **33 passed, 1 failed**.
- The new failed-compaction fixture incorrectly required zero events. Its sole
  observed event was the legitimate `Compaction started` notification. The
  failed `onReady` assertion passed; successful compaction was not announced.
- Execution stopped immediately. Typecheck and official parser did not run in
  this phase. No identical retry, induced-red reconstruction, or configuration
  change occurred.
- The parent also identified a prerequisite build gap: control-agent declarations
  and CLI output were absent. Vitest's existing global setup did not propagate
  the CLI build exit reliably. Therefore this first run **does not prove a
  successful CLI build**. That setup behavior was not modified in this issue.

Full original stdout/stderr and receipt remain untouched in local
`server/.task-394/verification/`. Receipt SHA-256:
`03e746979b3824cd80cedd5e0cf0dc085a17fa85718258b2b9a6dfaf2f1437a4`.
The source snapshot actually tested (including uncommitted predicate alignment)
was `0ef88bdcddd041547f07fca5cad3f1978359714de60fa4d3bbcfd40fd4535992`,
not unchanged commit `32f03659`.

### Follow-up phase: passed

The parent authorized correcting only the new assertion to the exact permitted
calls `[['Compaction started']]`, retaining failed `onReady` and excluding any
successful-completion event. No production behavior changed in response to the
fixture failure. No tests, assertions, setup, or timeout budgets were disabled.

| Maintained command (from `server/`) | Exit | Elapsed |
| --- | --- | --- |
| `pnpm --filter happyherd-control-agent build` | 0 | 4.658s |
| `pnpm --filter @happyherd/cli build` | 0 | 8.971s |
| `pnpm --filter @happyherd/cli exec vitest run --project unit src/claude/claudeRemote.test.ts src/claude/claudeRemoteLauncher.test.ts` | 0 | 19.056s |
| `pnpm --filter @happyherd/cli typecheck` | 0 | 6.737s |
| `pnpm --filter happyherd-app exec tsx sources/scripts/parseChangelog.ts` | 0 | 1.185s |

Focused result: **34 tests passed, 2 files passed**. The unchanged global setup
also ran its normal build; the separate explicit CLI build above provides the
authoritative successful build result. The official parser produced 200 entries
with latest title `October 15 — Report failed Claude turns accurately`, with no
JSON diff. The workspace printed an unrelated expo-tailcat Node >=22 engine
warning under the assigned Node 20; all five commands exited naturally with 0.
No reinstall or root-postinstall repeat occurred in this follow-up.

Full separate stdout/stderr and receipt are retained locally in
`server/.task-394/verification-followup/`. Receipt SHA-256:
`0d9ad9a76d082dd2dd7e124f81c0267f2831591bc2e14d5a04e2479a88e568b1`.
The entire phase took 42.736s. All five owned process groups were absent at
completion, without cleanup signals. Final free space was 14,699,675,648 bytes
(about 13.69 GiB), above the 8 GiB floor. The parent was notified that the slot
was released before further documentation/commit work.

Tracked-source aggregate SHA-256 before and after this phase:
`1f3209b85320da70658c45a27777f463eb05ae62cecaaa23a4d662ee441e4c7b`.
Lock SHA-256 before and after both phases:
`79bd621c488cbabaab545159e95b9c685be430e0573eac3d8b7cc10a750fcae4`.
Later evidence/ledger edits change the aggregate source hash, so retain the
actual tested code hashes for exact-head parity:

| Tested path under `server/packages/happyherd-cli/src/claude/` | SHA-256 |
| --- | --- |
| `claudeRemote.ts` | `d6ac3d650b6509fa0c3b02c325bbdd309c222d29fb3dee932a3dc09dc15032dc` |
| `claudeRemote.test.ts` | `fe0289a38813d29cc6b2be8490a77f138dff227b59eae6133644e4bff4c2f360` |
| `claudeRemoteLauncher.test.ts` | `08e3dfc46ef3a12801d7ae2ba8d8e9c9dd9e45e7cce5f14b5654de4e51782134` |

The broader rotation suites, full package suite, contract suite, CI, rendered
surfaces, and native subscription/two-account acceptance remain unrun. Exact-head
independent review and publication remain parent-owned. This is a verified
native-result status repair, not a completed subscription-rotation repair.

## First PR CI and approved capture import

Draft PR #434 published exact head
`6cf26cc087aa0fb28b235aa2385ec14f85b33df3` (tree
`0d95d59801af6a4d3623ae1395b84bf519aaf56b`) against unchanged main
`632dc24332e49bfd773c5163ab8c045a3b74a5cf`. Independent exact-head review
found no actionable introduced findings. The following first ordinary
pull-request workflows all reached terminal status on attempt 1, without
rerun, manual dispatch, or cancellation:

| Run | Outcome |
| --- | --- |
| [Quality 38823118155](https://github.com/NickGuAI/HappyHerd/actions/runs/38823118155) | Failed only at Production build / Compare KILV golden images. Clean install, lint, typecheck, unit tests, and native runtime passed. |
| [Contracts 38823118276](https://github.com/NickGuAI/HappyHerd/actions/runs/38823118276) | Success, with actual aggregate results and final `contract-suite: ok`. |
| [Native installer 38823118279](https://github.com/NickGuAI/HappyHerd/actions/runs/38823118279) | Success across four source-build/install and latest-stable targets; separately gated public auth and tag publication skipped. |
| [Server image 38823118375](https://github.com/NickGuAI/HappyHerd/actions/runs/38823118375) | Success. |

The contract log contains six aggregate groups: 399 files / 4609 tests passed
(10 skipped); 16 / 87; 12 / 260; 11 / 52; 208 / 2274; and 40 / 227.
These are CI fixture/package results, not live subscription-account proof.
First-run raw logs, jobs, metadata and artifact catalogs were retained before
import. These CI results supersede the earlier unrun-CI status, but do not
resolve the original issue's live acceptance gaps.

The exact [golden artifact 12014325387](https://github.com/NickGuAI/HappyHerd/actions/runs/38823118155/artifacts/12014325387)
reports source revision `6cf26cc087aa0fb28b235aa2385ec14f85b33df3`, browser
1.62.1 and 28 comparisons. Four changelog captures changed; 24 were identical,
with no changed dimensions. Artifact archive SHA-256:
`a5d70cc05f1408a8ad101f927b4c9ce25d7123eec7b2159dd420594d63b490d1`.

The worker reviewed all four actual/expected pairs. The parent separately
reviewed all twelve expected/actual/diff images and confirmed that only the
new October 15 entry and resulting text displacement changed. Artifact
expected bytes matched tracked baselines; all 24 other manifest payloads were
byte-identical. The parent explicitly authorized only these four baselines.

After fresh local/remote head and base checks and terminal workflow readback,
`node scripts/kilv-golden-update.mjs` ran **once** with pinned Node 20.20.2.
Its first invocation exited 0 in 1.987s and selected Quality run 38823118155.
The maintained importer performed its approved exact-head artifact download
and regenerated all 28 destinations. No script, config, assertion, or manual
PNG-copy path was substituted. First stdout, stderr and return receipt were
retained separately from the earlier artifact inspection download.

Post-import verification established exactly these four content changes under
`docs/acceptance/issue-287/golden/`:

| File | Imported actual SHA-256 |
| --- | --- |
| `production-changelog-latest-entries-light-1440.png` | `4e8f38c8648ea98f5394ed085b7624b381a86d1b8453283b3b0b4bb98b621c96` |
| `production-changelog-latest-entries-light-390.png` | `408676bf3849c929c0e0605d1215c2d54233a29fe240d853fd26631563e45e4a` |
| `production-changelog-latest-entries-dark-1440.png` | `f2ccdfaee554a8be4e961f0b4f2f288edfd374cec9f8ce5cec8cc5092d2c9dbc` |
| `production-changelog-latest-entries-dark-390.png` | `0e9f81b23400cd6a5027c1a089fc051ea7327490e5f1304a64fa03f8cb4995cf` |

All 24 remaining images retained their bytes. All 28 paths and file modes
were unchanged. Original production source, regression tests and lockfile
retained their recorded hashes. The source-head golden failure remains a
historical failure; importing reviewed captures does not retroactively turn
it green or claim CI success for the subsequent local commit.

This capture-only follow-up has no package/browser/build/install execution,
provider turn, account mutation, or runtime activation. Its authority covers
one local commit and light checks, not another push, PR update, ready mark,
merge, or closure. The subscription classifier, usable-alternative and
exhausted-pool native outcomes remain unproved; full #394 is not signed off.
