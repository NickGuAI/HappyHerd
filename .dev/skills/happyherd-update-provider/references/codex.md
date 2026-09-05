# Codex

Verified on 2026-09-05 against Codex CLI 0.153.4 and current HappyHerd source.
The active Codex app-server `model/list` remains the authoritative capability
source per target machine and account.

## Model discovery and reasoning effort

The Codex app-server `model/list` acts as the authoritative registry of
capabilities for each target machine and account. Its `gpt-6-astra` entry
declares a minimum client version of 0.153.0 and supports `low`, `medium`,
`high`, `xhigh`, `max`, and `ultra`. The `ultra` setting is described as
"Maximum reasoning with automatic task delegation." While generic OpenAI API
documentation lists effort levels only through `max`, `ultra` is exposed by
the Codex harness and catalog.

HappyHerd processes these `model/list` entries and effort strings dynamically
through machine capability metadata, UI selection, exact tuple validation,
and launch and resume. Do not hardcode Astra into offline fallbacks, because
individual machines or accounts might not advertise it. Operator acceptance
requires upgrading the active Codex CLI, restarting the daemon, reading back
the exact catalog, and completing one harmless Astra + Ultra turn.

## Execution boundary

Execution runs through the Codex app-server. `turn/steer` cannot change
approval or sandbox policy during an active turn, so mode-changing followups
submitted during that turn must queue in FIFO order. The active turn's policy
owns every callback for that turn.

## Capability and permission contract

Codex exposes the standard approval values `untrusted`, `on-request`, and
`never`, plus the sandbox levels `read-only`, `workspace-write`, and
`danger-full-access`. Granular policies are not HappyHerd named modes.

| HappyHerd mode | Codex approval | Codex sandbox | Late callback behavior |
|---|---|---|---|
| `default` | `untrusted` | `workspace-write` | Prompt the Human once |
| `auto` | `on-request` | `workspace-write` | Prompt the Human when Codex asks |
| `read-only` | `never` | `read-only` | Deny with no Human UI |
| `safe-yolo` | `never` | `workspace-write` | Deny with no Human UI |
| `yolo` | `on-request` | `danger-full-access` | Allow with no Human UI |

The locally typed `on-failure` value is stale and unreachable. The newer
`item/permissions/requestApproval` protocol is also unreachable under the
string policies HappyHerd currently sends.

## Continuity

- `thread/resume` must receive the exact approval and sandbox policy.
- Direct launch persists an immutable initial receipt for the complete model,
  effort, and permission tuple.
- App and terminal resume resolve each field independently from the latest
  current Human selection, then the corresponding initial-receipt field, then
  the exact-machine advertised default.
- The target daemon validates the resolved tuple, resumes with it, and returns
  an authoritative settings receipt. The app mirrors that returned receipt.
- An explicit invalid permission request visibly rejects the turn and never
  runs under the previous policy.

The relevant owners are
`server/packages/happy-cli/src/codex/executionPolicy.ts`,
`server/packages/happy-cli/src/codex/runCodex.ts`,
`server/packages/happy-cli/src/codex/codexTurnRouting.ts`,
`server/packages/happy-cli/src/codex/resumeExistingThread.ts`,
`server/packages/happy-cli/src/daemon/run.ts`,
`server/packages/happy-cli/src/resume/handleResumeCommand.ts`,
`server/packages/happy-app/sources/utils/sessionResume.ts`, and
`server/packages/happy-app/sources/hooks/useSessionQuickActions.ts`.

## Verification focus

- Prove every approval and sandbox pairing at launch and resume.
- Prove late callbacks use the active turn policy and non-interactive modes
  create no pending Human request.
- Prove mode-changing followups queue without breaking FIFO ordering.
- Prove all tuple dimensions use the correct per-field precedence in both app
  and terminal resume, and prove the returned daemon receipt is displayed.

## Known gaps

A live authenticated resume smoke was not completed during the 2026-08-30
audit.
