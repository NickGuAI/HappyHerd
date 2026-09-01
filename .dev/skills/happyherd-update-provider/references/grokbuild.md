# GrokBuild

Verified 2026-08-30 against GrokBuild 1.0.5 and the current HappyHerd source.
Recheck the installed binary, `grok --help`, capability catalog, and ACP
behavior before relying on these volatile facts.

## Execution boundary

- `server/packages/happy-cli/src/capabilities/agentCapabilities.ts` parses
  permission modes from the installed CLI help.
- `server/packages/happy-cli/src/agent/acp/acpAgentConfig.ts` includes the
  selected native code as `--permission-mode <code>` before `agent stdio`.
- `server/packages/happy-cli/src/agent/acp/runAcp.ts` owns the ACP session and
  permission callback policy.
- Launch permission is separate from the ACP plan/build operating mode.

## Capability and permission contract

The audited binary advertised `default`, `acceptEdits`, `auto`, `dontAsk`,
`bypassPermissions`, and `plan`.

| Mode | Late ACP permission callback |
|---|---|
| `default` | Prompt the Human |
| `acceptEdits` | Prompt the Human if the provider escalates a call |
| `auto` | Prompt the Human if the provider escalates a call |
| `dontAsk` | Deny without a prompt |
| `bypassPermissions` | Select an allow option advertised by the provider without a prompt |
| `plan` | Prompt the Human; this token does not select ACP plan/build mode |

## Continuity

- Persist the immutable initial launch receipt and use it as resume authority
  after validation against the exact-machine catalog. GrokBuild is the
  provider-specific exception to latest-current resume precedence: only its
  dedicated permission-transition RPC may replace the active permission
  authority.
- An active permission change restarts and resumes the same ACP conversation;
  commit the visible mode only after the resumed provider confirms it.
- Abort does not reset the process launch policy, so the Human-facing mode must
  remain unchanged.

## Verification focus

- Parse every mode advertised by the current CLI.
- Prove each native launch argument and all three callback classes: prompt,
  deny, and allow without prompt.
- Prove active transition and resume receipts without conflating permission
  policy with ACP operating mode.

## Known gaps

A live transition plus daemon-restart smoke was not completed during the
2026-08-30 audit.
