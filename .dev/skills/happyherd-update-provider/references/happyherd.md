# HappyHerd Provider

Verified 2026-08-30 against the current HappyHerd source. Recheck native Rig
metadata and behavior because its provider and mode catalogs are dynamic.

## Execution boundary

HappyHerd is a native machine/provider boundary, not a `happyherd-cli` child process.
The wire contract lives in
`server/packages/happyherd-wire/src/rigMetadata.ts`; the app consumes it through
`server/packages/happyherd-app/sources/sync/rigSessionCreation.ts` and
`server/packages/happyherd-app/sources/sync/rig.ts`.

## Capability and permission contract

- `operatingModes[].code` is the authoritative native value.
- `value` and `description` are presentation fields.
- `kind` classifies semantics but never replaces the native code.
- Creation and active selection validate and transmit the exact code.
- `capabilities.permissionModeSelection` decides whether the UI exposes the
  selector.
- Permission callbacks and enforcement are owned by native Rig.

## Continuity

Provider restart and restoration are native Rig responsibilities. HappyHerd
hides its own resume action for these sessions rather than inventing a second
continuity path.

## Verification focus

- Use dynamic fixture codes that differ from Claude and Codex values.
- Prove exact-code creation, active selection, and display.
- Cover each advertised semantic class without treating `kind` as the value.

## Known gaps

The 2026-08-30 audit did not have a native Rig fixture or live smoke proving
callback behavior, active switching, and provider-owned restoration for every
advertised class.

<!-- External native-source provenance: identifiers below must remain byte-faithful. -->
<!-- rename:preserve -->
## Context window investigation (#365, 2026-10-02)

**The runtime and consumer are both maintained in HappyHerd.** The native
source is vendored in [native/](../../../../native/README.md), with its original
MIT attribution and compatibility identifiers. The initial investigation used
revision `115be1c248985b823491f852dbde47ea7e6a76fd`; the maintained source baseline
is `b2baf1586b9b4e7ed03bad91541ccad0a969c3ef`. The context reader and encrypted
handler are owned changes in this repository. No external checkout, external
PR or external workflow approval is required to build or test them. Older Rig
installations must not be assumed to share this layout.

### State and identity

At that revision, native configuration derives
`<resolved happyHome>/agent/agent.sqlite`; see
[ConfigModule.ts](../../../../native/packages/happy-agent-modules/sources/config/ConfigModule.ts).
The native agent's context records are `happy_agent_records.record_json`,
selected by `owner_id = agentId` in `position` order; see
[AgentPersistenceDrizzle.ts](../../../../native/packages/happy-agent-base/sources/AgentPersistenceDrizzle.ts).
The bridge separately retains `remote_session_id`, `session_id`, and `agent_id`
in `happy_agent_happy_sessions`; see
[HappySyncDatabase.ts](../../../../native/packages/happy-agent-modules/sources/happy/HappySyncDatabase.ts).
Resolve the remote session through that native owner; the app session ID is
not a Claude session ID, Codex thread ID, or native agent ID.

The bridge publishes `machineId`, `path = session.cwd`, and `happyHomeDir` in
[createHappySessionMetadata.ts](../../../../native/packages/happy-agent-modules/sources/happy/createHappySessionMetadata.ts).
`happyHomeDir` comes from the bridge credential directory; see
[importHappyCredentials.ts](../../../../native/packages/happy-agent-modules/sources/happy/credentials/importHappyCredentials.ts). It must not be
used as an assumed native database root. The `rig:<sessionId>` project fallback
is absent for other project/bot cases and is not a native identity contract.
Keep the original machine, cwd, native configured state home, and bridge
identity mapping together. Never substitute the CLI daemon's home or machine.

### Window and retained content

[AgentPersistence.ts](../../../../native/packages/happy-agent-base/sources/AgentPersistence.ts)
defines `user`, `block`, `tool`, `system`, and `compaction` records. User records
can carry queued non-user roles, including injected notices and inter-agent
input; chat visibility is not a context filter. A compaction stores replacement
`messages` plus `contextToolIds`.
[AgentBase.ts](../../../../native/packages/happy-agent-base/sources/AgentBase.ts)
atomically deletes superseded main-context records and appends the replacement.
[AgentProviderContext.ts](../../../../native/packages/happy-agent-base/sources/AgentProviderContext.ts)
reconstructs that replacement and subsequent records, joins consecutive
assistant blocks, and restores tool-ID mappings. Physical chat append order
is not an oracle for the current model window.

Child creation persists its native `initialContext` (nonempty inherited context
is itself written as a `compaction` record, so that kind alone does not prove
a model compaction event); see
[AgentSystemLocal.ts](../../../../native/packages/happy-agent-base/sources/AgentSystemLocal.ts).
[AgentTaskContext.ts](../../../../native/packages/happy-agent-base/sources/AgentTaskContext.ts)
excludes the response issuing the fork tool and strips opaque vendor replay
state. A model reset can clear context and append system input. No supported
conversation rollback contract was established by this investigation; SQL
transaction rollback is not evidence of conversation rewind.

The context table alone cannot recover deleted pre-compaction records or
stripped opaque replay state. Recorded internal context is not proof of the
complete runtime-assembled model request. System instructions, tool definitions,
and other assembled input must be classified from their actual persistence
owners before claiming that they are recorded or unrecorded. [AgentBase.ts](../../../../native/packages/happy-agent-base/sources/AgentBase.ts)
assembles instructions and tools dynamically, including hooks and overrides.
The optional readable history JSONL dump is a separate committed-history
archive, off by default and bounded/rotated; see
[HistoryDump.ts](../../../../native/packages/happy-agent-modules/sources/observation/impl/HistoryDump.ts).
The off-by-default setting is defined in
[ObservationSettings.ts](../../../../native/packages/happy-agent-modules/sources/observation/ObservationSettings.ts).
It is not an authoritative current-context replacement. The main context store
contains accepted messages, not unconsumed queue entries. The separate native
History module is a presentation archive, with sender conversion and tool-output
truncation; it cannot supply missing final model-request data. Preserve recorded
`system` and hidden/injected records rather than claiming all instructions are
absent. Do not synthesize dynamic instructions or definitions from today's
configuration, decode opaque encrypted content, or treat SQL rollback as a
provider conversation-rewind feature.

The local native fixtures use the pinned SQLite records and real native storage
and agent lifecycle with scripted inference. They exercise actual compaction
transitions separately from inherited fork snapshots, hidden accepted messages,
full raw content, identity isolation, unavailable state, and Retry. The exact
sanitized native response is copied into the app's rendered fixture; it is not
a live provider recording. See the acceptance receipt for command results.

### Existing transport and repository-owned integration

The native [HappyMachineClient.ts](../../../../native/packages/happy-agent-modules/sources/happy/HappyMachineClient.ts)
at the pinned baseline registers only `spawn-happy-session` and rejects other methods in its request
handler. It does not serve `session-context-window`. Updating this repository's
CLI `ApiMachineClient` cannot install a handler in that separate native owner.
The maintained native implementation registers that same encrypted method and reads its own
database through the retained remote-session mapping, scoped to the active
connection owner and credential fingerprint. It verifies the mapped agent cwd
against the requested directory, then reads retained raw JSON in native position
order within one database snapshot. The app sends only `provider: rig`, the
original directory, and its remote `sessionId` to that original `machineId`.
Model flavor and bridge credential-home metadata never select another reader.
The shared Context window retains Retry and the off-by-default setting.
The native transport's existing 700,000-byte JSON response budget still applies:
an oversized snapshot returns `unreadable` rather than partial/truncated content.
Missing mappings, state or cwd mismatch return `missing`; unsupported request or
record envelopes return `unsupported`; read/JSON failures return `unreadable`.
Every read retries the source; nothing is cached as a substitute current window.

Build and exercise this runtime from [native/](../../../../native/README.md).
The original native transport owns pairing, machine identity and session
lifecycle; this feature adds no second HTTP/session transport. Old native
owners remain unavailable with Retry. Runtime activation is explicit: building
HappyHerd does not restart or migrate a running machine. Live acceptance uses
only the disposable task runtime and the same original machine/cwd/state home.
See the [acceptance receipt](../../../../docs/acceptance/issue-365.md) for proof
planes. The native runtime's normal Codex credential resolver refreshes its
selected login automatically; a no-refresh authorization cannot safely be
implemented by simply pointing that runtime at an existing login.

<!-- /rename:preserve -->
