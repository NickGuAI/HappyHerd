# Native plan and question interactions

Task: https://ticktick.com/webapp/#p/6a6dfdf8b014d115c15aa92c/tasks/6aa616c68f084b1907ff2f61

## Status

This is a partial implementation, not full task acceptance. The ACP plan and shared UI changes are proposed. Codex native question transport, Codex live/replayed plan support, persistent Claude answer receipts, and the complete verification gates below remain open. Do not merge or close the task on the strength of this document.

## Ownership and boundaries

ACP native `session/update` with `update.sessionUpdate = plan` carries `entries` on the update itself. `sessionUpdateHandlers.handlePlanUpdate` admits that shape as well as the legacy nested `plan` shape. `AcpSessionManager` validates entries and publishes a paired `TodoWrite` start/end on the active turn. The existing app reducer owns `newTodos`, so each snapshot replaces the whole list; an explicit empty array clears it. Invalid data must not masquerade as a valid empty plan. This adds no new wire schema, state store or permission action. Plans outside an active turn remain ignored; restored history requires its own verification rather than an invented turn.

Claude's native `AskUserQuestion` remains a permission callback. Only a structurally usable form may hide its ordinary permission controls. Answers use the original question text as native keys and pass through `sessionAllow(updatedInput.answers)`; cancellation uses the existing denial RPC. The form allows custom text, serializes submissions, retains failed submissions for retry and does not claim success before the RPC resolves. A completed answer is read only from structured provider/permission data, not inferred from prose. Persisting answers into completed CLI receipts is still required for guaranteed reload recovery.

`request_user_input` uses the existing `communications`/`completedCommunications` contract and the `communication` RPC. Its wrapper translates selected labels and custom text; cancellation uses the same request identity. A provider tool without a matching communication must retain a generic visible payload. A supported form must have exactly one UI owner. Text-only communications, including unanchored forms that formerly used the modal, require regression coverage before release.

A plan proposal without an actual nonblank body falls back to the generic payload and real permission actions. Do not fabricate a plan body, file read, approval or provider-mode transition. Todo and proposal content remain visible under compact-tool settings.

## Unimplemented Codex contract

The app-server `item/tool/requestUserInput` request needs a native reply owner, independent of approval policy. Retain the exact JSON-RPC request identity plus thread/turn/item scope; publish matching tool/communication state; translate answers to the native question-ID map; settle answer/cancel once; retire pending state on provider resolution, interrupt, process exit and reconnect. Duplicate and late replies must not target another process generation. Do not solve questions by reusing command approvals or auto-approving permissions.

`turn/plan/updated` and native plan ThreadItems must be mapped for live turns and persisted history/fork/resume. Use provider identity to avoid duplicate snapshots/body rendering and preserve native plan statuses. These changes are not present in this partial patch.

## Verification before acceptance

Run affected CLI unit tests for `AcpSessionManager`, `sessionUpdateHandlers` and `planEntries`, and app tests for question presentation, communications, tool rendering and the reducer. Added boundary tests are not a substitute for executed results.

Verify actual components at 1440x900 and 390x844: valid/malformed/native questions, custom text, multi-select, submit/cancel, duplicate taps, failed RPC/retry, completion, compact plans and answer replay. Distinguish mocked rendering, browser viewport checks and a real authenticated device session.

Before marking ready: complete native Codex coverage and Claude answer persistence; update the owned-patch ledger, route/coupling/provider references and user-visible changelog; regenerate UI inventory and changelog artifacts; run affected typechecks, i18n/inventory checks and production export; inspect exact-head CI/review results. Do not change permission policy, deploy services, or close the GitHub issue as part of opening the PR.
