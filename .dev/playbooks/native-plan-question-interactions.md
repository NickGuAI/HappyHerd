# Native plan and question interactions

Owner: [#295](https://github.com/NickGuAI/HappyHerd/issues/295), continuing the accepted ACP/shared UI slice in [#276](https://github.com/NickGuAI/HappyHerd/pull/276).

## Ownership and flow

```text
Codex app-server request ID + process generation + thread/turn/item
  → codexAppServerClient (native response owner, one settlement)
  → codex/userInput (unique communication ID + transcript tool anchor)
  → encrypted ApiSessionClient agent state / session envelopes
  → ToolView → RequestUserInputView → InlineQuestionForm
  → communication RPC → native question-ID answer map
  → completedCommunications + paired tool result
```

`codexAppServerClient.ts` retains the exact numeric or string JSON-RPC ID in a process-scoped closure. The app receives a unique communication ID, never an item counter or a reusable native request ID. Duplicates settle once. `serverRequest/resolved`, item/turn completion, interrupt, disconnect and process exit retire callbacks. A new runtime cancels retained pending receipts; late replies cannot target a replacement process. Question handling is independent of approval and permission policy.

`userInput.ts` validates the native question shape and translates offered selections and custom text into `{ answers: { [questionId]: { answers: string[] } } }`. Native cancellation uses `{ answers: {} }`. Completed answers are retained in the existing encrypted agent state and tool result. The reply RPC waits for the receipt update. Unsupported/malformed questions publish raw generic tool content plus the existing unsupported-communication cancellation surface, not fictitious options or approval controls. Secret native text uses the shared masked input/presentation; ACP question support is not implied.

Anchored forms, including text-only forms, have one inline owner. Unanchored forms retain the existing banner/modal. `canRenderAgentFormInline` and `shouldUseAgentQuestionFallback` share that decision; a missing communication does not fabricate an inline form. The shared form locks submissions, retains failed drafts for retry, and acknowledges success only after RPC resolution.

Claude's `AskUserQuestion` remains its native permission callback. `permissionHandler.ts` merges successful `updatedInput` into `completedRequests[id].arguments` and awaits persistence. `AskUserQuestionView` already reads that receipt by permission ID, retaining exact question-text answer keys, selections and custom text after reload. Cancellation remains the existing denial path. Unrenderable Claude inputs retain generic content and actual permission actions.

## Plans and recovery

| Provider surface | Owner / behavior | Recovery boundary |
|---|---|---|
| Codex `turn/plan/updated` | Client scopes to the root thread/turn, deduplicates repeated snapshots and orders timestamps; `nativePlans.ts` maps native `inProgress` to `in_progress` and emits paired `TodoWrite` envelopes | Happy's persisted transcript retains full replacements and explicit empty clears. Native Thread history does not expose these transient progress notifications; do not invent them during native fork. |
| Codex `item/plan/delta` and completed `plan` ThreadItem | Accumulated text updates one `CodexPlan` tool per turn/item; final body uses the same stable identity. It is content, not `ExitPlanMode` permission. | `thread/resume` and the existing `thread/read` fork/backfill mapper replay native plan bodies with stable IDs. Side-chat initial resume suppresses parent-history replay, preserving its empty-chat contract. |
| ACP standard/legacy plan update | Existing `sessionUpdateHandlers` → `AcpSessionManager` → paired `TodoWrite` snapshots | An explicit `startSession` replay window accepts provider load/resume snapshots before a prompt. The adapter supplies presentation turn scope because ACP snapshots have no native turn ID. Outside that window and an active turn, plans remain ignored. No provider history/fork capability is fabricated. |

Valid snapshots replace the whole todo list, including an empty list. Malformed snapshots must not clear valid todos. Malformed Codex plans show raw generic content. `ToolView` preserves todo lists and native plan bodies under compact-tool settings. Native body completion/replay must not duplicate the streaming card or mutate approval policy.

## Verification and sign-off

- Native provenance: `codex-cli 0.154.0`, `codex app-server generate-ts --experimental`; inspect `ToolRequestUserInput{Params,Question,Response}`, `ServerRequestResolvedNotification`, `TurnPlanUpdatedNotification`, `PlanDeltaNotification`, and `ThreadItem`.
- CLI regressions: `codexAppServerClient.test.ts` covers native JSON lines, root reply identity, duplicate/late replies, all invalidation paths, generic unsupported cancellation, plan replacements/clear/deltas and history IDs. `permissionHandler.test.ts` proves durable Claude receipt round-trip. `AcpSessionManager.plan.test.ts` covers live and explicit history replay.
- Browser: `nativeQuestions.browser.test.ts` drives real `ToolView`/provider wrappers/shared forms at **1440×900** and **390×844**, starting from the native fixture and production parser. Selection, free text, failed RPC/retry, double-click, cancellation, invalidation, completed-state reload, Claude multi-select/custom answers, compact native plans and malformed generic controls are covered. Transport/state, Markdown and peripheral host dependencies are synthetic; this is component-browser evidence, not an authenticated SessionView journey.
- Run affected package typechecks/full tests, i18n/inventory, changelog parser, production Web export/smoke and the clean-tree repository contract suite. Keep exact results in [the issue evidence](../evidence/issue-295-native-interactions.md).
- Authenticated native-provider question/reply and plan/history/fork/resume journeys on Desktop/Mobile remain required before **issue closure**. Green tests or CI are not live proof. Opening the PR does not authorize deployment, merge, restart or issue closure.
