# Generic ACP / OpenCode

Verified 2026-08-30 against the current HappyHerd source. Recheck the selected
ACP command, its initialize response, and its advertised capabilities before
relying on provider-specific behavior.

## Execution boundary

- The current terminal-only entry point is `happy acp`.
- It accepts an arbitrary ACP command and arguments, and also recognizes the
  `opencode` preset.
- Generic ACP is not an active Human new-session UI entry on Web Desktop or
  Web Mobile.
- The shared implementation lives under
  `server/packages/happy-cli/src/agent/acp/`.

## Capability and permission contract

- Provider-native permission strings remain dynamic and reach the exact ACP
  boundary without being recast as Claude or Codex modes.
- An invalid explicit permission visibly rejects before prompt execution; it
  must not inherit and run under the prior mode.
- Callback behavior combines the selected provider policy with the
  `requestPermission` options the provider actually advertises.
- Do not invent model or effort catalogs for an arbitrary ACP command.
- Raw ACP text, thinking, tool, result, and error events must preserve stable
  call identity through normalization and rendering.

## Continuity

Resume and cross-process continuity exist only when the ACP provider
advertises them and HappyHerd implements the matching path. Otherwise report
the operation as unsupported rather than inventing a provider session ID or a
generic restore mechanism.

## Verification focus

- Start fixtures from raw or specification-shaped ACP messages.
- Prove dynamic permission transit, invalid-mode rejection, and callback
  selection against advertised options.
- Prove text and thinking streams plus split tool start, update, result,
  failure, and completion events retain one stable call ID.
- Verify terminal behavior without claiming Human UI parity that does not
  exist.
- Exercise resume only for a provider whose advertised and implemented
  contract supports it.

## Known gaps

Generic ACP has no Human new-session UI entry. Models, efforts, permission
semantics, and continuity vary with the selected ACP command and require live
provider evidence.
