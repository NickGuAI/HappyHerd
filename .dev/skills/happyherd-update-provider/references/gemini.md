# Retired Gemini

Verified 2026-08-30 against the retained compatibility source under
`server/packages/happy-cli/src/gemini/`. Gemini is excluded from new-session
launch. Recheck historical session data before relying on these legacy facts.

## Execution boundary

Existing legacy sessions retain a fallback permission menu with `default` and
`yolo`. The handler can also parse historical `read-only` and `safe-yolo`
values.

## Capability and permission contract

- `default` prompts for ordinary tool calls while retaining a small exact set
  of housekeeping auto-approvals.
- `yolo` selects the provider-advertised `allow_always` option without creating
  a Human permission request.
- Historical `auto_edit` and `plan` are not currently advertised or resumable.
  Their intended semantics are not authoritative enough to invent a mapping.
- An explicit unrecognized permission must visibly reject the legacy turn; it
  must not execute under the prior retained mode.

## Continuity

- A legacy Gemini session cannot resume after its provider process exits.
- Abort preserves the mode retained by a still-running legacy session.

## Verification focus

- Keep compatibility tests bounded to reachable legacy sessions.
- Prove `yolo` creates no pending request and emits no Human prompt.
- Prove an invalid explicit mode rejects visibly and executes no tool or turn.
- Do not reintroduce Gemini into the active provider registry while testing
  retained parsers.

## Known gaps

New launch and cross-process resume are unsupported. Historical `auto_edit` and
`plan` remain unsupported legacy state.
