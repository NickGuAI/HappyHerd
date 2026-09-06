# Claude Code

Verified 2026-08-30 against Claude Code 2.1.220, Anthropic Agent SDK
0.3.241, and the current HappyHerd source. Recheck the installed CLI, SDK
types, and exact-machine capability catalog before relying on these volatile
facts.

## Execution boundary

- Capability discovery is owned by
  `server/packages/happy-cli/src/capabilities/agentCapabilities.ts`.
- Claude launch and live control are owned under
  `server/packages/happy-cli/src/claude/`.
- SDK option construction is owned by
  `server/packages/happy-cli/src/claude/sdk/query.ts`.
- Permission callbacks are classified by
  `server/packages/happy-cli/src/claude/utils/permissionHandler.ts`.

## Capability and permission contract

| Mode | Native behavior | Callback behavior |
|---|---|---|
| `default` | Explicit normal Claude policy | Executable callbacks prompt the Human |
| `auto` | Provider auto classification | A callback that reaches HappyHerd prompts the Human |
| `acceptEdits` | Auto-accept edit operations | Edit callbacks allow; shell callbacks prompt |
| `plan` | Read-only planning policy | Read-only operations allow; execution and `ExitPlanMode` prompt |
| `bypassPermissions` | SDK bypass with `allowDangerouslySkipPermissions` | Executable callbacks, including `ExitPlanMode`, allow without a Human prompt |
| `dontAsk` | Allow preapproved operations and refuse escalation | Other executable callbacks deny without a Human prompt |

`AskUserQuestion` remains interactive content input in every mode. It is not a
permission approval. The terminal shortcut `--yolo` becomes Claude's native
`bypassPermissions` before the provider boundary; a raw `yolo` permission value
is rejected as cross-provider input. `manual` is not exposed because it is a
CLI help value that the audited SDK does not support.

## Continuity

- Live mode changes must be awaited before the displayed mode is committed.
- Explicit `default` must be able to leave bypass or historical `yolo` state.
- Direct launch records an immutable initial receipt for the complete model,
  effort, and permission tuple.
- Resume resolves each field independently from the latest current Human
  selection, then the corresponding launch-receipt field, then the
  exact-machine advertised default. The target daemon validates the resolved
  tuple, returns an authoritative settings receipt, and the UI mirrors it.
- A present `null` receipt field means Claude's ambient provider behavior. It
  must not be converted into a hardcoded model, effort, or permission flag.
- Local CLI and remote SDK launches must apply the same exact explicit Claude
  permission. An outer HappyHerd OS sandbox must not substitute a different
  provider permission or add bypass behavior over that selection.
- A selected `dontAsk` value remains valid only when the target machine catalog
  advertises it.

## Verification focus

- Prove SDK options and callbacks independently for every advertised mode.
- Include `ExitPlanMode` and `AskUserQuestion` because their meanings differ
  from ordinary executable callbacks.
- Prove live transitions both into and out of non-interactive modes.
- Prove full-tuple app and terminal resume, target-daemon receipts, and
  exact-machine handling for `dontAsk`.
- Cover both local native CLI and remote SDK launch paths.

## Known gaps

The 2026-08-30 audit did not complete a live authenticated smoke for every
permission mode.

### Claude Integration Note (2026-09-06)

The shared catalog contains the optional `claude-fable-5-1` with 1M context. Opus 5 remains unchanged. SDK 0.3.260 supports low, medium, high, xhigh, and max efforts. Includes a deterministic SDK adapter proof. Native live smoke testing remains unperformed.
