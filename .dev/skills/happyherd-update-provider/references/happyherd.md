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

**Local implementation spans two source owners.** These are pinned source
findings, not installed-version or authenticated runtime proof. The issue #365
continuation authorized a local native patch; the subsequent user instruction
authorizes coordinated PR publication and one isolated test account/machine pairing. `slopus/rig`
now redirects to `slopus/happy-agent`; the inspected revision is
[`115be1c248985b823491f852dbde47ea7e6a76fd`](https://github.com/slopus/happy-agent/tree/115be1c248985b823491f852dbde47ea7e6a76fd).
Do not apply this revision's storage layout to an older Rig installation
without checking its native sources.

### State and identity

At that revision, native configuration derives
`<resolved happyHome>/agent/agent.sqlite`; see
[ConfigModule.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-modules/sources/config/ConfigModule.ts#L3002).
The native agent's context records are `happy_agent_records.record_json`,
selected by `owner_id = agentId` in `position` order; see
[AgentPersistenceDrizzle.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-base/sources/AgentPersistenceDrizzle.ts#L46).
The bridge separately retains `remote_session_id`, `session_id`, and `agent_id`
in `happy_agent_happy_sessions`; see
[HappySyncDatabase.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-modules/sources/happy/HappySyncDatabase.ts#L38).
Resolve the remote session through that native owner; the app session ID is
not a Claude session ID, Codex thread ID, or native agent ID.

The bridge publishes `machineId`, `path = session.cwd`, and `happyHomeDir` in
[createHappySessionMetadata.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-modules/sources/happy/createHappySessionMetadata.ts#L194).
`happyHomeDir` comes from the bridge credential directory; see
[importHappyCredentials.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-modules/sources/happy/credentials/importHappyCredentials.ts#L107). It must not be
used as an assumed native database root. The `rig:<sessionId>` project fallback
is absent for other project/bot cases and is not a native identity contract.
Keep the original machine, cwd, native configured state home, and bridge
identity mapping together. Never substitute the CLI daemon's home or machine.

### Window and retained content

[AgentPersistence.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-base/sources/AgentPersistence.ts#L13)
defines `user`, `block`, `tool`, `system`, and `compaction` records. User records
can carry queued non-user roles, including injected notices and inter-agent
input; chat visibility is not a context filter. A compaction stores replacement
`messages` plus `contextToolIds`.
[AgentBase.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-base/sources/AgentBase.ts#L3271)
atomically deletes superseded main-context records and appends the replacement.
[AgentProviderContext.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-base/sources/AgentProviderContext.ts#L171)
reconstructs that replacement and subsequent records, joins consecutive
assistant blocks, and restores tool-ID mappings. Physical chat append order
is not an oracle for the current model window.

Child creation persists its native `initialContext` (nonempty inherited context
is itself written as a `compaction` record, so that kind alone does not prove
a model compaction event); see
[AgentSystemLocal.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-base/sources/AgentSystemLocal.ts#L435).
[AgentTaskContext.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-base/sources/AgentTaskContext.ts#L30)
excludes the response issuing the fork tool and strips opaque vendor replay
state. A model reset can clear context and append system input. No supported
conversation rollback contract was established by this investigation; SQL
transaction rollback is not evidence of conversation rewind.

The context table alone cannot recover deleted pre-compaction records or
stripped opaque replay state. Recorded internal context is not proof of the
complete runtime-assembled model request. System instructions, tool definitions,
and other assembled input must be classified from their actual persistence
owners before claiming that they are recorded or unrecorded. [AgentBase.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-base/sources/AgentBase.ts#L1686)
assembles instructions and tools dynamically, including hooks and overrides.
The optional readable history JSONL dump is a separate committed-history
archive, off by default and bounded/rotated; see
[HistoryDump.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-modules/sources/observation/impl/HistoryDump.ts).
The off-by-default setting is defined in
[ObservationSettings.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-modules/sources/observation/ObservationSettings.ts#L60).
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

### Existing transport and local integration

The native [HappyMachineClient.ts](https://github.com/slopus/happy-agent/blob/115be1c248985b823491f852dbde47ea7e6a76fd/packages/happy-agent-modules/sources/happy/HappyMachineClient.ts#L308)
at the pinned baseline registers only `spawn-happy-session` and rejects other methods in its request
handler. It does not serve `session-context-window`. Updating this repository's
CLI `ApiMachineClient` cannot install a handler in that separate native owner.
The local native patch registers that same encrypted method and reads its own
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

The native patch is separately reviewable in
[Happy Agent #28](https://github.com/slopus/happy-agent/pull/28), rebased onto
`b2baf1586b9b4e7ed03bad91541ccad0a969c3ef` as
`37886c58dbf9fff0d4c2f6922c52dbbbf69f2a74`. Publication does not establish
installation or authenticated runtime acceptance. Older native owners remain unavailable
with Retry. Live acceptance needs an explicitly authorized isolated runtime with
both reviewed patches and an already authorized same-account native machine.
Do not introduce a second HTTP/session transport, redirect to another machine,
install/restart a provider, or infer identity from a project label. See the
[acceptance receipt](../../../../docs/acceptance/issue-365.md) for the proof planes
and remaining authenticated prerequisite.

<!-- /rename:preserve -->
