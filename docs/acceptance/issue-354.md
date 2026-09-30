# Issue 354: experimental recorded context window

Owner: [#354](https://github.com/NickGuAI/HappyHerd/issues/354).

The invariant is that the context inspector reads provider-native recorded
content without the chat view's filtering, preserves current-window ordering
and full payloads, and identifies anything the native trace cannot recover.
It does not alter a transcript or start/resume a provider. The existing
account-owned encrypted machine RPC transports the read; no server endpoint,
new access policy, or prompt reconstruction is introduced.

## Acceptance map

| Owner requirement | Implementation and repeatable evidence |
| --- | --- |
| Off by default; Features → Experimental switch; absent session entry while off | `sync/settings.ts`, Features route, `useSessionQuickActions.ts`; `sync/contextWindow.test.ts` covers default/migration/sync; browser journey exercises the visible switch and production session menu. |
| Visible entry and open/read journey on Web Desktop and Web Mobile, Claude and Codex | `SessionActionsPopover` opens `/session/[id]/context`; `sideChatHeader.browser.test.ts` Context window cases render the production Features route, SessionView, menu and context route at 1440×900 and 390×844. |
| Every ordered entry, hidden attachments, real compaction, full content and Codex base instructions | CLI `contextWindow/readContextWindow.ts`, parser/RPC fixtures and app transport tests. Claude honors native preserved-message/segment anchors and follows the current mainline parent chain, excluding abandoned branches; Codex retains recorded session metadata (including dynamic tools), replacement history and later input entries. |
| Claude built-in prompt/tool definitions explicitly unrecorded; no fabricated inputs | Localized limitations in the context route; Codex base instructions are verbatim from the rollout. Native trace limits are visible; no current model defaults are substituted. |
| Unsupported, offline and missing trace with retry | Typed machine results plus app connectivity check; production route Retry/Refresh gestures and app RPC tests. |
| Provider recipe and four remaining-provider subissues | `.dev/playbooks/provider-onboarding.md` context-window recipe. Linked native GitHub subissues: [GrokBuild #362](https://github.com/NickGuAI/HappyHerd/issues/362), [dsh #363](https://github.com/NickGuAI/HappyHerd/issues/363), [Antigravity #364](https://github.com/NickGuAI/HappyHerd/issues/364), [HappyHerd #365](https://github.com/NickGuAI/HappyHerd/issues/365). No extra provider implementation is included. |
| App guardrails | `i18n:check`, generated UI inventory/tree, changelog parser and production Web export/smoke. Product copy is in en/cn/de. |

## Focused evidence

The reviewed reader passed 29 CLI parser/encrypted-RPC/retained-home tests,
82 wire tests, 19 app transport/settings tests, and 16 focused rendered browser cases. All 128 tests in the rebased shared browser
suite and all 66 settings/quick-action tests also passed.
The eight successful provider × viewport × theme journeys exercise the visible
switch, session menu, full-content reading, reopen and Refresh. Six additional
cases cover offline/missing/unsupported Retry at both sizes, and two prove a
disabled direct route does not read the machine.

Sanitized open-view captures are in `issue-354/`: `claude` and `codex`,
`1440` and `390`, `light` and `dark`. The tests can regenerate all switch,
entry, open and final-entry captures by setting
`HAPPYHERD_CONTEXT_WINDOW_SCREENSHOT_DIR` to an absolute output directory.

Initial browser fixture assertion failures (native Switch checked state,
icon glyphs in accessible names and the page-title heading) were corrected
without removing the tested behavior. The first local CLI typecheck needed
the existing `happyherd-control-agent` build prerequisite; it passed after
building that package, with no source workaround.

Independent review reproduced and prompted fixes for abandoned Claude branches
and persisted Codex dynamic-tool metadata. A second review caught the fresh
compaction transition; compact summaries and hidden mainline injections now
remain eligible as current model input, and an incomplete boundary offers
retry instead of the obsolete window. Retained-history tests cover the
completed summary before another reply, including competing discarded descendants. The final PR receipt records the
exact-head re-review. The initial CI Unit tests failure was the existing
settings defaults assertion missing the new off-by-default key; its expected
object now explicitly includes `expContextWindow: false`. Two local contract attempts
were interrupted before package tests to avoid mixing reviewed revisions.

## Verification commands

From `server/`, with Node 20, pnpm 10.11.0 and Bun 1.3.11:

```sh
pnpm install --frozen-lockfile
pnpm --filter @happyherd/wire test
pnpm --filter @happyherd/cli typecheck
pnpm --filter @happyherd/cli exec vitest run --project unit src/contextWindow src/api/apiMachine.contextWindow.test.ts
pnpm --filter happyherd-app exec vitest run sources/sync/contextWindow.test.ts sources/components/sideChatHeader.browser.test.ts -t 'Context window' --maxWorkers=1
pnpm --filter happyherd-app typecheck
pnpm --filter happyherd-app i18n:check
pnpm --filter happyherd-app exec tsx sources/scripts/parseChangelog.ts
APP_ENV=production pnpm --filter happyherd-app exec expo export --platform web --output-dir dist-ci
pnpm --filter happyherd-app web:smoke
```

Root `scripts/contract-suite.sh` requires a clean committed tree. The PR receipt
records the exact reviewed head, actual command conclusions, six required CI
checks, installer matrix, server/Web image, and final mergeability read-back.

## Proof boundaries

Fixtures retain native shapes with fabricated harmless content, not private
conversation text. Browser evidence exercises production UI components with
fixture storage/transport; it does not establish authenticated live machine
RPC behavior on an installed deployment. Source/RPC tests establish transport
wiring separately. Native iOS/macOS/Windows journeys are outside this issue's
explicit Web Desktop/Web Mobile acceptance.

The provider trace is not a byte-for-byte log of every assembled model request.
Claude omits its built-in system prompt and tool definitions. Codex can omit
runtime tool definitions and applies transformations after recording history.
Unrecorded content is labeled; unavailable referenced history is unreadable
with retry. A read is a snapshot and Refresh requests another snapshot.

This change affects Web/frontend, the shared wire contract, daemon-resident
CLI and provider documentation. The continuation below authorizes isolated
acceptance activation; it does not authorize changing the shared deployment,
merging the PR, or closing the issue.

## Native and authenticated acceptance continuation

The owner requested completion of the real authenticated journeys after the
initial review-ready handoff. **The current continuation remains outstanding.**
The following evidence is separate from the rendered fixtures above.

On 2026-09-30, the user corrected the continuation scope to **real Codex plus
authenticated Web Desktop and Web Mobile only**. Live Claude execution,
continuation, compaction and login renewal are outside this corrected scope,
not completed acceptance. No further Claude request or authentication action
is planned, and Claude OAuth status is not a current blocker. Existing Claude
fixture/parser coverage and the notices that its built-in system prompt and
tool definitions are not recorded remain part of the delivered feature.

The selected runtime source is
`01e76b61d868f9c0be0bc12811f91d4f72e08d8c`, based on
`0217e4c629415eda601856cd21e535489e5e1f06`. Its production Web export and CLI
build passed with Node 20 and pnpm 10.11.0. A disposable loopback server on
`127.0.0.1:46354` uses the real standalone server, its own PGlite database
(40 migrations), and the unchanged production Web export. Its health endpoint
passed. No shared daemon, server, account configuration or provider credential
was replaced. This is a local acceptance environment, not a deployed release.

A fresh local account was created and authenticated through the production
Web UI. The normal backup gate was completed without exporting its key to an
artifact; the temporary clipboard was cleared. No storage state was injected,
HTTP or Socket.IO transport mocked, or existing account credentials copied.
Google Chrome in headless mode showed the Context window switch present and
unchecked at both 1440×900 and 390×844. These are real Web viewport checks, not
physical-device or native-mobile checks. The sanitized captures are
[`production-features-desktop-off.png`](issue-354/production-features-desktop-off.png)
and [`production-features-mobile-off.png`](issue-354/production-features-mobile-off.png).

The native Codex 0.154.0 app-server completed two harmless model turns around
one real `thread/compact/start`, waiting for completion before the second turn.
The native stream reports three completion events because compaction itself
also emits a turn-completed event.
An independently derived oracle read only this newly generated trace. It used
the last native `replacement_history` plus later `response_item` records,
rather than deriving expectations with the parser under test. The disk reader
and parser returned all 13 expected entries in exact order and with matching
full-content hashes. This includes the actual 21,428-byte base instructions,
three hidden developer inputs, an image retained by native replacement history,
and the post-compaction marker. The original trace hash and modification time
were unchanged. Native encrypted compaction content remains opaque: the
recorded bytes are preserved, and the existing provider-recording limitation
applies; no plaintext is invented. The public
[`native-acceptance-report.json`](issue-354/native-acceptance-report.json)
contains only counts, hashes, environment details and outcomes, not transcripts.

Historical evidence: Claude's installed CLI 2.1.216 and the exact-worktree Agent SDK 0.3.260 bundled
Claude Code 2.1.260 both returned HTTP 401 `authentication_failed`, reporting
expired stored OAuth. A normal-settings retry and the distinct bundled-native
path also failed. No alternate auth environment or configured Claude account
pool was available. Three genuine file attachments were recorded, but there
was no successful model turn or compaction; this is not a Claude context pass.
No logout, account switch, credential copying or shared-login modification was
performed. This retained failure snapshot is not a request to renew login and
does not block the user-corrected Codex/Web continuation. Later retained checks
also failed; none is a live Claude pass.

The isolated CLI's supported terminal pairing was prepared, but automatic
approval review rejected opening its pairing link because the action could
grant machine access. Explicit approval was requested to pair only the fresh
isolated CLI home with the disposable local account. No pairing or equivalent
API workaround was performed. Until approved, the real daemon and authenticated
Web → encrypted machine RPC → native trace journey remain unproved.

| Original acceptance criterion | Current acceptance status |
| --- | --- |
| Experimental switch defaults off; no session entry while off | **Outstanding overall.** Production authenticated switch/default is proved at both sizes; absence from a real session menu still requires the paired machine. Fixture absence tests pass. |
| Visible Claude/Codex entry on Web Desktop and Web Mobile | **Outstanding Codex live proof.** Both providers' production-component fixture journeys pass. Actual Codex session journeys await pairing; live Claude execution is outside the user-corrected continuation scope, not a claimed pass. |
| Every ordered post-compaction entry, hidden input, Codex base instructions and honest Claude limits | **Outstanding Codex Web transport.** Actual native Codex trace/oracle passes. Claude parser/fixture coverage and unrecorded-limit notices remain; live Claude turns/compaction are outside the corrected continuation scope, not completed. |
| Unsupported, offline and missing transcript states offer retry | **Outstanding live proof.** Six rendered fixture cases pass; actual isolated-runtime failure/recovery journeys await pairing. |
| Provider recipe and exactly four linked remaining-provider subissues | **PASS.** Recipe and native linked subissues #362, #363, #364 and #365 are present; no additional providers implemented. |

Recorded commands and outcomes (Claude rows are historical only):

```text
APP_ENV=production pnpm --filter happyherd-app exec expo export --platform web --output-dir <owned-export>  PASS
HAPPYHERD_BUILD_COMMIT_SHA=01e76b61... pnpm --filter @happyherd/cli build                                    PASS
tsx packages/happyherd-server/sources/standalone.ts serve (isolated PGlite + production export)             healthy
Playwright → production Create account → backup gate → Features, desktop/mobile                          default off PASS
codex app-server --listen stdio:// → thread/start → turn/start → thread/compact/start → turn/start         PASS
independent native Codex oracle → parseCodexContextWindow + readContextWindow                             13/13 PASS
historical: claude -p --session-id <owned UUID> / --resume <owned UUID> with harmless @file inputs          HTTP 401; outside current scope
historical: bundled SDK native Claude --resume <same owned UUID>                                          HTTP 401; outside current scope
happyherd auth login (fresh isolated home and loopback server)                                            awaiting pairing approval
```

The exact-head CI and preserved local baseline failures remain recorded in
the PR receipt. Green source/build/CI and the native oracle do not complete the
outstanding authenticated journeys. No merge, release publication, issue
closure or shared production restart occurred.
