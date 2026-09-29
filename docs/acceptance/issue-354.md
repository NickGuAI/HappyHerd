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
CLI and provider documentation. Activation would require deploying the selected
Web artifact and installing/restarting the selected daemon artifact under
separate authority. This delivery performs no merge, activation or issue closure.
