# Antigravity

Verified 2026-08-30 against the current HappyHerd source. The `agy` binary was
not installed on the audit host, so recheck its current help and live behavior
before relying on these volatile facts.

## Execution boundary

- The adapter lives under `server/packages/happy-cli/src/agy/`.
- It starts one `agy --print` child for each turn rather than keeping a
  streaming permission protocol open.
- The active HappyHerd catalog advertises only `default` and
  `bypassPermissions`.

## Capability and permission contract

| Mode | Native child argument | HappyHerd prompt behavior |
|---|---|---|
| `default` | `--sandbox` | No HappyHerd permission callback channel |
| `bypassPermissions` | `--dangerously-skip-permissions` | No HappyHerd permission callback channel |

The backend retains the selected permission across turns. Abort cancels the
current child but does not reset that selection, so the UI must preserve it.
An explicit permission outside the advertised catalog must visibly reject the
turn before child launch; it must not run under the preceding selection.

## Continuity

- Conversation identity is retained while the HappyHerd provider process stays
  alive.
- Antigravity cannot currently resume after that provider process exits.

## Verification focus

- Prove both catalog entries and exact argument mappings.
- Prove an active mode change reaches the next one-shot child.
- Prove abort leaves the displayed and effective modes aligned.
- Prove an invalid explicit mode rejects visibly and launches no child.

## Known gaps

The audit lacked a full app-to-daemon-to-child fixture and a live provider
smoke. Cross-process resume is currently unsupported.

### Agy Integration Note (2026-09-06)

Derived from source-based metadata in shared `providerModels` and CLI `agy` constants. The active selection consists of four exact choices:

1. Gemini 3.8 Flash
2. Claude Sonnet 4.6 (Thinking)
3. Claude Opus 4.6 (Thinking)
4. GPT-OSS 120B (Medium)

Default configuration: `Gemini 3.8 Flash` + `medium`. Gemini independent effort levels supported: low, medium, high. Other logical models do not support effort configurations. Legacy saved full names are preserved for provider-boundary compatibility but are not active picker rows. Agy is unavailable locally so live smoke testing is unproved.
