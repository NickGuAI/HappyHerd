# Antigravity

Verified 2026-08-30 against the current HappyHerd source. The `agy` binary was
not installed on the audit host, so recheck its current help and live behavior
before relying on these volatile facts.

## Execution boundary

- The adapter lives under `server/packages/happyherd-cli/src/agy/`.
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

## Context window investigation #364 — 2026-10-15

Scope: HappyHerd `632dc24332e49bfd773c5163ab8c045a3b74a5cf`, its `agy`
print-mode adapter, official native documentation, and installed application
source only. No provider invocation, private transcript read, hook installation,
state migration, or provider-home change was performed.

### Native evidence and identity

- [Native resume documentation](https://www.antigravity.google/docs/cli/commands/resume)
  identifies `~/.gemini/antigravity-cli/cache/last_conversations.json` as an
  absolute-workspace-to-latest-conversation map. This is not a HappyHerd session
  mapping. Two sessions in one directory can replace the same cache entry.
- [Native hooks documentation](https://www.antigravity.google/docs/hooks)
  identifies `<app_data_dir>/brain/<conversationId>/.system_generated/logs/transcript.jsonl`.
  The CLI app-data directory is `~/.gemini/antigravity-cli`; the app and IDE
  have distinct directories. Hook payloads supply conversation identity and the
  transcript path. They can inject system, user, ephemeral, and tool steps.
  These payloads are not a specification of persisted transcript replay.
- [Native headless documentation](https://www.antigravity.google/docs/cli/headless/)
  now documents JSON output with `conversation_id` and streaming step updates,
  including checkpoints. HappyHerd's `agy/cliArgs.ts` does not request these
  formats; `AgyBackend.ts` consumes plain stdout as answer text. Its native ID
  remains a private in-process field inferred from the changed workspace cache.
  `startSession()` returns cwd, and `runAgy.ts` does not persist a native
  conversation ID or original Antigravity state home into session metadata.
  The older reference's lack-of-streaming statement describes the adapter,
  not the newly documented native CLI capability.
- On this inspection host, `command -v agy` resolved through a symlink to
  `/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity`, an
  Electron IDE launcher. Package version: `1.107.0`; distro:
  `0c7d350c3a9e8639ea238cc996ec4f6dcf1e35cd`. The packaged
  `extensions/antigravity/dist/extension.js` SHA-256 was
  `d6aadf72cb144a3cb2606e4bae2b4508f361031ff3dafa65394b55aa3edd4294`.
  Its generated protobuf definitions expose `GetCascadeTrajectoryRequest`
  (`cascade_id`) and a response with trajectory/status/step counts, plus
  `RevertToCascadeStepRequest` (`cascade_id`, `step_index`). That IDE RPC schema
  does not establish CLI on-disk replay or the requested session's identity.
  No IDE RPC was contacted, and this installation is not live CLI proof.

### Compaction, forks, rollback, and missing content

[Native context documentation](https://antigravity.google/docs/cli/commands/context/)
confirms checkpoint summaries replace older turns, and distinguishes system,
tool, injected/customization, and checkpoint usage. The panel is an interactive
usage view, not a documented complete model-input export.
[Native conversation documentation](https://antigravity.google/docs/cli/conversations/)
describes independent forks and history rewind. Neither source establishes the
persisted cut, retained-entry references, fork ancestry, or rollback replay
needed to recover the current window from the transcript path above.

Therefore no successful Antigravity reader or invented native compaction
fixture is supplied. This investigation does **not** establish that native
Antigravity never records system instructions, tool schemas, hidden injections,
or compacted history. Their exact persistence and recoverability remain
unverified. HappyHerd's current text stream does not supply them. A visible
answer, workspace cache, hook example, or step-count metadata cannot stand in
for full recorded model context.

### Implemented unavailable boundary

The existing encrypted `session-context-window` RPC accepts `provider: agy`
and returns `agy_context_unavailable`. The app retains the original machine,
path, remote session ID and recorded home directory, and uses the shared view's
localized notice and Retry. It does not read a default provider home, select
the latest cwd conversation, start a provider, or reuse chat messages. Offline,
missing original metadata, and unreadable transport remain distinct existing
failures. Older daemons may still return generic unsupported; Retry remains.

Tests cover this unavailable contract, not native recovery. The prepared
1440×900 and 390×844 browser journeys exercise the real Features switch,
SessionView entry, Context route and Retry against synthetic RPC responses.
They cannot prove a full-content read or authenticated provider behavior.
Recovery requires an authoritative session-to-native-ID/state-home mapping and
versioned trace/replay evidence, including sanitized real-format compaction,
hidden-entry, fork and rollback fixtures. No provider launch or transcript
capture is implicitly authorized by this reference.
