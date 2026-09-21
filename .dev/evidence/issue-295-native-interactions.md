# Issue #295 — native interaction delivery evidence

Owner: [NickGuAI/HappyHerd #295](https://github.com/NickGuAI/HappyHerd/issues/295).
Independent session: `ses_f3ee3d561ffeqMw4dEjiUoP56g`.
Base: `c1dd1b1eccb3e5434725dfa68a178e5c1c49153f` (`origin/main` at worktree creation).
Branch: `feat/issue-295-native-persistence-ses-f3ee3d56-v2`.
Implementation subject: `feat(providers): persist native plans and question answers`.

## Scope and source review

The issue body and comments were read through `gh`; no comments or existing
task-owned open PR were present. Merged #276's accepted ACP/shared form changes
remain the baseline. This patch completes native Codex transport/lifecycle,
plan streaming/recovery, Claude answer receipts and remaining form ownership.
No changes from parallel #296/#297 or the dirty canonical checkout were used.

Native protocol shapes were generated locally using `codex-cli 0.154.0` and
`codex app-server generate-ts --experimental`. That is executable schema
provenance, **not authenticated provider behavior**.

Reviewed data flow: native request → generation-bound responder → existing
communication state + tool envelope → app selector/provider wrapper/form →
communication RPC → original JSON-RPC ID → completed encrypted receipt.
Question processing does not use or change command approval policy. Native
plans reuse transcript storage, TodoWrite replacement semantics and shared
plan rendering. There is no new storage service or ACP question protocol.

## Acceptance coverage

| Outcome | Deterministic evidence | Live status |
|---|---|---|
| One native Codex form, selections/custom/cancel | `codexAppServerClient.test.ts` starts at native JSON lines; browser uses the same fixture and production parser/wrappers. Exact string/numeric root response IDs and question-ID answer maps asserted. | Unproved against an authenticated running provider/UI. |
| One settlement and no stale actions | Duplicate replies, wrong-thread resolution, provider resolution, turn/item completion, interrupt, exit, disconnect, clear-thread and process-generation reuse regressions; completed receipts disable restored forms. | Native process/browser disconnection journey unproved. |
| Native plan visibility/recovery | Native snapshots replace, empty snapshots clear, malformed data does not clear; plan deltas update one stable turn/item card, final/history IDs match; resume final content supersedes partial content. Existing fork/read backfill uses the same mapper. | Authenticated live/history/fork/resume journey unproved. Native history provides plan bodies, not past progress notifications. |
| ACP preservation/recovery | Existing raw standard and nested fixtures preserved; explicit load/resume plan replay scope added and tested. Compact TodoWrite behavior preserved. | Only provider-advertised load/resume/history is claimed. Native ACP replay not exercised live. |
| Claude answers retained | Native question-text answer keys persist in completed permission arguments; serialization/reload and late-reply regression. Browser covers multi-select + custom text and reload. | Authenticated Claude reconnect unproved. |
| Honest unsupported payloads | Invalid native forms retain generic raw tool content and unsupported cancellation; malformed Claude keeps real permission controls; no ACP question support claimed. | Synthetic protocol/component proof only. |
| Desktop 1440×900 | Production ToolView/provider wrappers/shared form: selection, text, failure/retry, duplicate gesture, cancellation, invalidation, reload, compact plan, malformed generic controls. | Component browser fixture passed; authenticated SessionView journey unproved. |
| Mobile 390×844 | Same real gestures and restored answers, plus no horizontal overflow. | Chromium responsive fixture passed; authenticated mobile/device journey unproved. |

## Executed checks

- Frozen-lockfile install passed without a manifest/lockfile change. The
  existing `happyherd-control-agent` build was required before CLI typecheck could resolve
  its exported declarations.
- CLI/app typechecks passed.
- Full app suite: **287 files passed; 2,883 tests passed, 1 skipped**.
- Final source revision `c6c98074792f960ea9112cbaa838ee1a5dd6b2fe`: full CLI suite
  under Node **20.20.2**, pnpm **10.11.0**, Bun **1.3.11** and canonical macOS
  `TMPDIR`: **182 files / 1,813 tests passed**. Native lifecycle/parser focus:
  **54 tests passed**.
- Initial CLI run with the host's Node 26 failed three unrelated assertions:
  Node's `DEP0205` stderr warning and two `/var` versus `/private/var` realpath
  assertions. Using the CI Node major and canonical temporary path made the
  unchanged tests pass; no assertions or checks were disabled.
- Wire: **14 files / 80 tests passed**.
- `nativeQuestions.browser.test.ts`: **6 browser journeys passed**, three per
  viewport. The actual form/ToolView controls run in Chromium; RPC/state,
  Markdown and peripheral dependencies are fixture hosts. This does not prove
  an authenticated full-chat journey or native iPhone focus behavior.
- `i18n:check`: **1,572 keys** in en/cn/de, zero production-copy exceptions;
  **41 routes / 279 surfaces / 84 smoke cases** verified. Inventory regenerated.
- Changelog parser: **149 entries**, latest **September 20 — Native plans and
  recoverable answers**. Markdown and generated JSON reviewed together.
- Production Web export and `web:smoke` passed. CLI production build passed as
  part of its package tests. `git diff --check` and source lint passed.

### Clean-tree contract result and bounded blockers

The clean-tree `scripts/contract-suite.sh` was run on source revision
`c6c98074792f960ea9112cbaa838ee1a5dd6b2fe`, with Node 20.20.2, Bun 1.3.11,
pnpm 10.11.0, GNU sed on PATH, canonical `TMPDIR` and finally `TZ=UTC`.
Lineage, patch discipline, public-boundary, CLI command, source lint, product
identity, multiagent/community guidance, installer, component deployment,
agent runtime, upstream/merge provenance and ShellCheck gates passed.
The sandbox canary reports its existing host-only dependency skip.

**The combined contract suite is not green locally.** On the final run all
**2,883 app test cases passed (1 skipped)**, but four unrelated browser
`afterAll` hooks timed out: `theme.browser`, `EmptyMainScreen.browser`,
`workspaceDelete.browser` (10 seconds each) and `MarkdownView.browser`
(30 seconds). An earlier full app run passed all 287 files; the isolated
workspace deletion rerun passed all 14 cases. No timeout, assertion, test or
check was disabled or changed to conceal these failures. The aggregate suite
stops at the app package; Linux CI must establish the full contract result.

Remaining package gates were executed separately on that exact source revision:
wire **80**, happyherd-control-agent **252**, happyherd-agent **52**, CLI **1,813**, and server
**176** tests passed. Server typecheck/build passed. Server tests require UTC
for an existing date-bucket assertion (the initial New York run failed that
one assertion); rerunning the unchanged tests with UTC passed all 31 files.
Frozen-lockfile installation plus `git diff --exit-code` passed after commit.

An initial unpushed commit inherited noncanonical local Git identity and failed
the public-boundary check. The same patch was recommitted from the same clean
base on the `-v2` branch using the repository's canonical maintainer identity;
the published history passes that gate. No Git configuration or gate changed.

Final sign-off: **Not signed off for issue closure**. The source is delivered
for review, with the local combined-contract teardown blocker and the
authenticated acceptance rows explicitly open. CI conclusions and PR identity
belong to the final PR handoff; no green CI is presumed here.

## Review and activation boundary

### PR CI follow-through

On `c5df026746fe50fc76409d23683dcb660118803c`, GitHub's
[Contract suite](https://github.com/NickGuAI/HappyHerd/actions/runs/35546920758/job/106174406946)
and [Unit tests](https://github.com/NickGuAI/HappyHerd/actions/runs/35546920734/job/106174742212)
passed, resolving the combined-suite proof gap left by local macOS teardown
timeouts. Clean install, Lint, Typecheck and the server/Web image also passed.

[Production build](https://github.com/NickGuAI/HappyHerd/actions/runs/35546920734/job/106174742263)
failed only the strict golden-image comparison: the four Desktop/Mobile,
light/dark changelog captures contain this issue's newly required release note.
All other 24 captures matched with zero differing pixels. Reviewed all four
actual images against the prior changelog and the checked-in release-note text;
the intended inserted entry accounts for the changed content and vertical flow.

Ran `pnpm --filter happyherd-app golden:update` to obtain the exact-head Linux
captures from artifact `kilv-golden-35546920734`. Only those four baseline PNGs
changed. No production source, comparator, mask, threshold, timeout or test
assertion changed. The comparator still includes antialiasing and requires
zero changed pixels. Final-head CI results will be reported in the PR handoff;
authenticated interaction acceptance remains separate and unproved.

Changed lanes: provider-session CLI runtime, shared app UI/state and developer
documentation. The server storage/API and permission policy are unchanged.
Reviewed exact supported call sites include direct Codex resume, existing native
fork backfill, side-chat initial resume suppression, ACP startSession replay,
Claude permission completion and both inline/modal selectors.

Review-ready source delivery does not close #295. Final acceptance still needs
the exact revision installed/served and authenticated native-provider journeys
at both target widths, including interruption, reconnect, fork/resume and
reloaded answers. No deployment, installation, restart, merge, email or issue
closure is authorized/performed by this session. CI status is a separate proof
plane and must not be substituted for these live rows.
