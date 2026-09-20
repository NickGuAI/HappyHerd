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
  existing `happy-agent` build was required before CLI typecheck could resolve
  its exported declarations.
- CLI/app typechecks passed.
- Full app suite: **287 files passed; 2,883 tests passed, 1 skipped**.
- Full CLI suite under Node **20.20.2**, pnpm **10.11.0**, Bun **1.3.11** and
  canonical macOS `TMPDIR`: **181 files / 1,804 tests passed**. Subsequent added
  lifecycle/parser cases passed in the focused **54-test** native run.
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

Clean committed-tree contract/PR results are recorded in the final handoff.

## Review and activation boundary

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
