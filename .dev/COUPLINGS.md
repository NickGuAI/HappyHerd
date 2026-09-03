# Couplings and state ownership

Use this map to find changes that cross package boundaries or alter who owns
durable truth. Package manifests and concrete call sites are authoritative.

## Workspace dependency graph

```text
@slopus/happy-wire
   ├──► happy-app
   ├──► happy-cli (package name: @happyherd/cli)
   ├──► happy-server
   ├──► happy-agent ◄── @happyherd/happyherd-agent
   └──► happy-server-self-host

happy-server-self-host ──builds──► happy-server + Prisma + happy-app web bundle
```

- `happy-wire` is the shared protocol leaf. A schema change can affect every
  application and runtime even if TypeScript finds only some consumers.
- `@happyherd/cli` lives at `packages/happy-cli` and exposes `happyherd` as its
  sole primary command. The root installer owns only source build, normal
  server settings, and user commands.
- `@happyherd/happyherd-agent` composes `happy-agent/control` with Discord and
  the governed organization-service broker.
- `happy-server-self-host` directly consumes `happy-wire` and also has
  build-time coupling: its runtime dependency list must stay aligned with the
  source server and its build script must bundle the wire workspace package.

Evidence: `server/pnpm-workspace.yaml`, all `server/packages/*/package.json`
files, and `happy-server-self-host/scripts/build-runtime.cjs`.

## End-to-end execution paths

### Session delivery

```text
provider adapter
  → happy-cli ApiSessionClient + encryption
  → happy-server Socket.IO handler + Prisma SessionMessage
  → server event router
  → happy-app apiSocket + sync storage updates
  → route/component
```

Changes to ordering, reconnect, delivery, completion, or visibility require
inspection at every layer. A transport-presence signal is not a substitute for
canonical persisted session/message state.

### Machine RPC

```text
happy-app sync/ops
  → happy-server socket/rpcHandler relay
  → happy-cli ApiMachine + registered handler
  → daemon/provider/filesystem
  → callback over the same relay
```

RPC method strings and payloads are shared runtime contracts. Search both ends
and any server relay before modifying them.

### GrokBuild ACP sessions

```text
happy-app agent selection + live machine catalog
  → happy-cli daemon spawn/resume
  → `happyherd grok`
  → existing `agent/acp` runner
  → official GrokBuild CLI over ACP stdio
```

GrokBuild authentication remains owned by the installed provider CLI. Model,
reasoning-effort, and resume capabilities come from its live ACP responses.
Permission modes instead come from `grok --help` and are process launch
policies; they are not Grok's ACP plan/build operating mode. Resume stays on
the original machine. App attachment and fork surfaces must follow advertised
ACP capabilities rather than another provider fallback.

### dsh ACP sessions

```text
happy-cli capability refresh
  → temporary isolated DSH_HOME + cwd, zero MCP servers
  → bounded `dsh --profile acp` session/new probe without a prompt
  → exact model + thought_level configOptions
  → live machine catalog or actionable fail-closed error
  → happy-app detected-only dsh selection
  → daemon spawn → `happyherd dsh` → existing `agent/acp` runner
```

dsh discovery parses only explicit `model` and `thought_level` select categories
from `session/new`. It promotes only valid `["deepseek-official", nonempty slug]`
tuples, takes both defaults from `currentValue`, reports the installed CLI
version, and cleans up the temporary process and home. Malformed or failed
discovery omits the catalog and surfaces an actionable Web error. Before the
first prompt, the runtime adapter revalidates the selected model and effort
against that session's config options, resolves the public model slug to dsh's
exact opaque provider tuple, and fails closed if either selection is missing,
unknown, malformed, or rejected. The generic ACP prompt, tool, and permission
normalization remains unchanged. dsh has no permission-mode picker or
first-class resume/fork surface.

### Provider defaults and session launch

```text
active non-retired HARNESS_ORDER
  → Agent Defaults schema + settings groups
  → explicit Agent Defaults capability-source selector
      (initially prefers the New Session draft machine)
  → selected daemon catalog or explicitly empty dimensions
       ├── GrokBuild agentCapabilities
       ├── dsh agentCapabilities
       └── Rig sessionCreation metadata
  → Full New Session + HomeDock draft + draft launcher
  → exact-daemon catalog re-read and selection validation
  → provider-native spawn payload
```

The active harness registry owns Defaults coverage; retired Gemini remains
parseable only for old synchronized settings. Agent Defaults visibly names and
lets the user change its exact capability-source daemon without mutating the
New Session draft. GrokBuild, dsh, and Rig own their model and per-model effort
values through that daemon; GrokBuild and Rig also own permission values.
Unsupported dimensions stay explicitly
absent; an absent provider catalog renders a localized, actionable unavailable
state instead of a blank group or borrowed choice. The separate exact
launch-target daemon is re-read immediately before
spawn, so a saved value from another capability source is revalidated there.
An unknown provider never falls through to Claude. Any provider-registry change
must update or automatically flow through the defaults schema, settings groups,
draft reset boundary, all three launch surfaces, and the registry-parity proof.
Every actual provider change clears the draft's permission, model, and effort
fields before the destination provider's defaults are resolved; provider-local
values must never survive a Claude ↔ Codex (or any other) switch.

### Named credential pools and reactive rotation

```text
happyherd connect <provider> --acct <nickname>
  → exact argument validation → provider authentication → credential-pool store
  → selected account exported to the provider process

typed rejected quota window or provider-marked Claude API-error fallback
  → provider limit notice → daemon rotation
  → mark limited and select the next account, or wait for the first reset
  → stop provider → resume the same Happy session
       ├── clear legacy or mismatched quota before the new provider loop
       └── after successful resume, persist one encrypted switch event
             → app normalization → persisted-ID dedupe → localized MessageView row
```

Rotation is reactive and lazy: there is no background quota polling or UI
toggle, and cross-account failover requires at least two named accounts for the
same provider. Quota snapshots are owned by `providerAccount`; partial windows
merge only within that account. A switch receipt carries provider, old account,
the resumed webhook's selected account, and a stable incident ID. A failed
daemon notice stays retryable; no receipt is emitted for ignored notices,
failed stop or resume, or a wait that returns to the same account.

### Provider prompt, permission, and tool-event behavior

```text
provider capability source
  → daemon catalog → app selection → shared message metadata
  → CLI message admission → exact provider validation
  → launch arguments and/or runtime selector
  → provider permission callback
       ├── interactive mode          → one Happy pending request
       ├── allow-without-prompt mode → provider-advertised allow response
       └── deny-without-prompt mode  → advertised reject or cancellation

provider raw event
  → provider mapper or ACP sessionUpdateHandlers
  → AgentMessage → AcpSessionManager → SessionEnvelope
  → app typesRaw → reducer → known-tool enrichment or generic ToolView
```

These are bidirectional provider contracts, not launch-only integrations.
Shared wire and app metadata intentionally accept provider-native permission
strings. Validation belongs at the exact provider/daemon boundary; a closed
shared enum can discard a valid future-provider message before its adapter sees
it. As of baseline `3eac2e3c`, the CLI copy in
`server/packages/happy-cli/src/api/types.ts` is narrower than the wire and app
schemas and must be reconciled by any implementation that adds a new native
permission code.

Permission discovery, delivery, and enforcement are separate. A launch flag
does not prove how Happy handles a later ACP `requestPermission` callback, and
an ACP operating-mode selector must not overwrite a process launch policy.
A change that introduces or expands Happy-owned permission enforcement remains
subject to the
[security-feature approval gate](playbooks/security-feature-approval.md).

ACP tool fields are also distinct: `toolCallId` correlates events, `title` is
human-readable display text, optional `kind` is a category, and `rawInput` is
structured input. Sparse updates may omit metadata already supplied at start,
so the adapter must retain the descriptor by call ID through completion or
failure. Known-tool registries may enrich presentation, but correctness cannot
depend on a provider-specific registry entry: a valid unfamiliar tool with a
title must not render as `unknown`.

### Session heartbeat delivery

```text
Session Info or `/heartbeat`
  → `happyherd-heartbeat-control` machine RPC
  → automation store/service cadence and occurrence state
  → encrypted session message with one stable queue identity
  → isolated entry in the existing MessageQueue2 FIFO
  → exact Claude or Codex provider conversation
```

The automation plane owns heartbeat configuration, cadence, coalescing, and
history. The session message log and runtime queue remain the authorities for
content, ordering, acceptance, and provider-turn lifecycle; a heartbeat never
creates a second transport or a fresh session.

### Scheduled automation execution

```text
scheduled definition → automation store/service → existing cron scheduler
                                           ├─ Claude/Codex → daemon-owned provider session
                                           └─ exec → exact executable + argv → exit-code history
```

The store/service is the sole owner of scheduled definitions and history.
Provider rails delegate lifetime management to the provider process and daemon;
the exec rail directly spawns the exact executable and argv as the daemon OS
user with `shell: false`, records its terminal exit, and creates no agent session.

### Governed agent

```text
Discord event
  → happyherd-agent authorization/bridge/store
  → happy-agent control session
  → Happy server/daemon

governed tool request
  → loopback broker
  → bounded organization service
  → policy-filtered response
```

Keep the bridge state, Happy runtime state, organization-service capability,
and secret material separate. The governed-agent runtime contract defines those
boundaries; it is not part of the local installer.

### Active-session voice dictation

The active-chat composer uses `useVoiceInputAvailability.available` and
`useVoiceDictation` to send recorded audio to `POST /v1/voice/transcriptions`.
The returned text is appended to the uncontrolled `MultiTextInput`, remains
editable and unsent, and flows into the existing `useDraft` persistence mirror.
Recording, transcribing, cancel, error, and retry states are rendered by
`AgentInput`; the composer does not start the separate realtime voice system.

```text
composer mic → useVoiceDictation → POST /v1/voice/transcriptions
                                      │
                                      ▼
existing draft + transcript → editable MultiTextInput → useDraft persistence
```

### File Workspace

```text
active Main Agent or active Side chat (session + machine + cwd)
                         │
                         ▼
              MachineWorkspaceBrowser ──► full-machine browse
                         │
                         ├─ file/directory reference ──► sync/workspaceContext
                         │                                  └─► exact chat
                         ▼
                 SessionView state (machine + path)
                         │
                         ▼
             DesktopFileWorkspace ──► FileContentPanel + sync/ops
                   tabs / split             Preview / Edit / Delete
                   compact host             machine transport
```

One Human-facing **Workspace** initializes at the exact machine and cwd of the
active Main Agent or Side chat. `MachineWorkspaceBrowser`, exported from
`app/(app)/workspace/index.tsx`, provides full-machine navigation and adds
existing file or directory references to that exact chat through
`sync/workspaceContext.ts`.

`SessionView.tsx` retains one UI and transport state keyed by machine ID and
absolute path. `DesktopFileWorkspace.tsx` owns deduplicated tabs, the wide
split, compact host, and feedback. `FileContentPanel` and `sync/ops.ts` own
Preview, Edit, supported Delete, and machine transport. A rendered Markdown
`requestedLine` deep link is a mandatory navigation behavior: it stays in the
commentable Preview and reveals the matching rendered review unit, including
the matching table row for a line inside a table.

Current-session file and directory reply links remain in this host. Parsed line
and column values remain attached to the tab reference and feedback message,
and drive that rendered-line reveal; they are not a raw-source scroll-or-
highlight hint. Only cross-session links or a context that cannot host the
current session Workspace may fall back to the standalone `/workspace` route and
`WorkspaceLinkViewer`. Read
[`playbooks/file-workspaces.md`](playbooks/file-workspaces.md) before changing
these owners.

Agent-facing file-link syntax is owned as one paired instruction surface: the
live HappyHerd global `AGENTS.md` pointer and the baked-in
`deploy/happyherd-agent-runtime/happy-home/AGENTS.md` pointer must change
together, and both point to matching `CHAT_FILE_SURFACE.md` learning files.
Never update only the live or only the installation-template instruction.

## State owners

| State | Canonical owner | Important boundary |
|---|---|---|
| Server users, machines, sessions, messages, and related records | `happy-server/prisma/schema.prisma` through server storage modules | PostgreSQL/PGlite is durable; Redis is optional realtime coordination, not a replacement database |
| Server files | `happy-server/sources/storage/files.ts` and selected local/S3 adapter | Deployment profile chooses the backend; callers use the storage boundary |
| App live view state | `happy-app/sources/sync/storage.ts` | Derived client state must reconcile with server truth |
| App local persistence | `happy-app/sources/sync/persistence.ts` | MMKV/local cache is device state, not cross-client authority |
| App credentials | `happy-app/sources/auth/tokenStorage.ts` | SecureStore/native and browser storage implementations differ |
| Maintained CLI machine/session runtime | `happy-cli/src/configuration.ts` and `persistence.ts` | Defaults beneath `~/.happyherd`; do not mix with other package defaults |
| Automation definitions and history | `happy-cli/src/automations/{store,service}.ts` | Sole owner for scheduled and heartbeat definitions and runs; provider sessions own provider lifetime, while exec runs own their direct process exit record |
| Commander identity and AgentContext | Human-authored Markdown/JSONL beneath the HappyHerd home | Human knowledge remains reviewable files; runtime state does not own it |
| Governed Discord settlement and surface bindings | `happyherd-agent` `BridgeStore` | Dedicated bridge state; not server message authority |
| Provider process lifetime | Provider process, orchestrated by the daemon | Daemon registration does not make transport presence canonical completion state |

Default state roots are intentionally not uniform: maintained CLI state uses
`~/.happyherd`; retained `happy-agent` and app-logs defaults use `~/.happy`;
Codium uses a platform-dependent `happy`/`Happy` directory. Never treat them as
interchangeable stores.

Native account-machine discovery and session creation cross one package edge:
`happy-cli` owns the public commands, while the side-effect-free
`happy-agent/control` and `happy-agent/auth` exports own account-machine
decryption, encrypted machine RPC, and the app-approved account-link flow.
`happyherd machine auth` stores its account-control key only at `agent.key` in the
configured HappyHerd home; normal native auth remains in `access.key`. Do not
copy or derive one from another. Because those package exports resolve through `happy-agent/dist`, the
existing injected-package publish lifecycle builds that surface for clean
workspace installs after its `happy-wire` dependency is available. Do not add a
second root-postinstall build: it races pnpm's injected `happy-wire` packaging.
The server image's filtered deps install also runs those injected-package
lifecycles. Its deps stage must copy the full `happy-agent` and `happy-wire`
package inputs before install—not only their manifests—so TypeScript sources
and configuration, tests, and bins exist and source changes invalidate the
cached install layer.
The server-image workflow path filter must include both package trees.
Deployments that deliberately install with `--ignore-scripts` must instead
build `happy-agent` explicitly before building `@happyherd/cli` and the local CLI runtime.
Native `happyherd session create` accepts only Happy CLI daemon machines. Rig has a
separate idempotent, provider-qualified RPC contract and must fail closed here
unless that distinct contract is implemented end to end.
Machine kind alone is not authorization to use the strict creation RPC. New
daemons advertise `machineSessionProtocolVersion`; the command refreshes the
target and requires the exact supported version before any side-effecting
spawn. Missing or unknown versions remain discoverable but report
`sessionCreateSupported: false`.
The target daemon revalidates requested modes from its own current catalog,
passes the resulting settings through a session-scoped environment handoff,
and returns success only after the child session metadata persists the same
settings. The requester reports that confirmation; it never reconstructs a
success receipt from its earlier request.
The retained `happy-agent` spawn APIs remain mixed-version compatible: they
accept a legacy success receipt without settings and wait for the tracked
session, including when existing callers pass model, effort, or permission
options. Only the explicit confirmed API requires the receipt and persisted
settings tuple; do not route legacy callers through that stricter method.
Concrete provider defaults that Happy owns must be marked `isDefault` in the
daemon catalog and share the same constant as the runtime launch path. Leaving
an owned default unmarked turns an omitted request into a false receipt even
when the provider process starts successfully.

Coordinated child side chats extend that same exact-daemon boundary through two
deliberately different creation surfaces:

```text
Human: app New side chat action
  → one click, no fields
  → encrypted `happyherd-side-chat-create` machine RPC with parentSessionId only

Main Agent: `happyherd session side-chat create`
  → require outcome + scope + dependencies + write ownership + verification + handoff
  → authenticated loopback request to the running local daemon

Both → daemon-owned side-chat lifecycle
  → resolve exact parent from machine-local reconnect data
  → require parent machine ID == this daemon machine ID
  → daemon-owned provider fork
       ├── Claude provider-native session fork
       └── Codex provider-native thread fork
  → daemon spawn on the same machine and path
       with fresh provider resume ID + parentSessionId + isSideChat
  → creation path
       ├── Human: skip deliver-brief → empty child → focus/open normal composer
       └── Main Agent: render bounded Worker Agent prompt with exact parent/child IDs
             → persist prompt through the child's encrypted queued-message path
                  ├── delivery success in the creation receipt
                  └── parentSessionId + sessionId + failed deliver-brief phase
  → hidden child metadata in synchronized session state
  → exact-parent child selector and `Side chats N` access control
       ├── wide Web/Mac click → collapsible right-panel host
       └── narrow/native click → full-screen host with the same selection

generic app fork/spawn + isSideChat
  → rejected by spawn-happy-session before provider launch
```

The app creates, discovers, renders, switches, resumes, and closes side chats.
Its parent-only dedicated create RPC and `happyherd session side-chat create`
both enter the daemon-owned lifecycle; only that lifecycle may set
`isSideChat`.

The same loopback endpoint owns the complete child lifecycle:

```text
durable encrypted reconnect records ──snapshot──► list / close --all
             │                                      │
             └── exact child read ──────────────────┘
                         │
       stop ──► live daemon PID only ──► confirm OS exit
                         │
                         ▼
                 confirm active=false
                         │
                         ▼
       close ──► encrypted lifecycleState=archived
                         │
                         ▼
                exact server read-back

       reopen ──► authenticated exact-session resume signal
                         └── clear heartbeat suppression
                                  └── same Happy session/provider state
                                           └── bounded wait for live PID + active=true
```

Process authority is the current daemon's in-memory tracked-process map;
persisted `hostPid` is reconnect context and is never a kill target. Discovery
authority is the durable encrypted reconnect store, not `/daemon/list`, so
stopped and archived children survive daemon restart. Server reads used for
lifecycle receipts decrypt the exact remote metadata without overlaying stale
local fields. Close order is process confirmation, server deactivation,
encrypted archive metadata, then authoritative read-back; a confirmed live
stop failure cannot be hidden by archival metadata. `close --all` takes one
immutable, machine-scoped child snapshot and closes it sequentially, preserving
one receipt per child and exact partial failures.

The exact-session resume signal is distinct from read-back: it validates
account ownership before clearing the server's post-archive heartbeat
suppression. This lets the resumed provider's first heartbeat persist
`active=true` immediately without making ordinary status reads mutate state.
The local control client gives sequential `close --all` a longer bounded
receipt window than single-child actions so the four-child shutdown contract
cannot continue mutating after the caller has already timed out.

The parent session record owns the machine, working path, provider, provider
backend ID, and—for Codex—the exact resolved state home, with both the temporary
fork app-server and spawned child launching from the parent directory and
provider context rather than daemon defaults. If the parent record has a
preferred named provider account, both processes explicitly activate that
account. If `providerAccount` is absent, the parent is an unmanaged/native or
custom Codex home: the daemon preserves its `CODEX_HOME` and existing auth
byte-for-byte, does not select or activate the daemon's current credential-pool
account, and passes an explicit unmanaged mode to the child. Side-chat
creation is intentionally local-owner-only and does not load `agent.key`, list
account machines, or fall back to the QR-based account-control flow. The Human
app request carries only the parent Happy session ID. The Main Agent loopback
request accepts that ID plus the complete structured brief. The daemon
re-resolves every launch value from its own persisted record,
rejects a parent belonging to another machine, and coalesces concurrent
requests with the same creation input for the same exact parent while fork,
spawn, and any prompt delivery are in flight. A concurrent no-brief request and
briefed request, or two requests with different briefs, fail instead of
assigning different intent to one child. Provider-native fork operations must
complete before child spawn, and the
new backend ID—not the parent's ID—is the resume target. `parentSessionId` and
`isSideChat` are persisted child lineage: top-level session selectors exclude
those children while the parent view discovers every non-archived exact child,
including children created by another app or CLI client. Side-chat presentation is
independent of the default-off file-diff-sidebar setting. Collapsing either
presentation changes only local view state; closing a child tab stops it and
always archives the server session so it stays absent after reload. The
encrypted archive acknowledgement uses Socket.IO's native timeout so a
buffered mutation cannot apply after a reported failure. After a lost
acknowledgement, the app refreshes and reads back the canonical lifecycle
marker before it reports success or restores a retryable tab.

The generic encrypted `spawn-happy-session` machine RPC rejects
`isSideChat=true` before calling the provider spawn boundary. Ordinary app
forks cannot mark a child as a side chat. The app's dedicated New side chat
action forwards only `parentSessionId` through `happyherd-side-chat-create`.
The Main Agent CLI remains the surface that validates and forwards all six
brief fields.

Provider-native subagents remain inline provider activity in the owning
session protocol and tool panels. They are not side-chat session records and
never enter the exact-parent child selector. A HappyHerd side chat is instead a
durable conversation whose Orchestrating Agent owns lifecycle, verification,
handoff review, and integration. Side chats do not recursively create more
side chats by default.

## Cross-cutting contracts

### UI, localization, inventory, and changelog

Changing a route or UI-owning module couples source code to:

- all three canonical JSON catalogs (`en`, `cn`, and `de`);
- the generated UI surface inventory and UI tree;
- the critical locale/viewport/theme smoke matrix; and
- the Markdown and generated JSON changelog when behavior is user-visible.

Follow the generators and checks in [`VERIFY.md`](VERIFY.md); do not add an
allowlist entry to hide new hardcoded interface copy.

### Build and release

| Deliverable | Coupled inputs |
|---|---|
| Web app | `happy-app` source, catalogs, inventory, and production Expo export |
| Self-host server | `happy-server-self-host`, server, Prisma, and app web bundle |
| Host daemon | `happy-cli` and embedded/runtime dependencies |
| Governed bridge | `happy-agent`, `happyherd-agent`, deploy/runtime contracts |
| Local user installer | `install.sh`, `happy-cli`, `happy-server-self-host` |

These are independent delivery lanes. The self-host server intentionally
contains the Web bundle, but changing the CLI/daemon, mobile client, governed
agent, or local installer does not rebuild or activate the others. Compatibility
is enforced at wire/API boundaries and by component tests, not by requiring one
Git SHA on every host.

When an operator explicitly refreshes both server/Web and native daemons in one
post-update operation, activation is ordered even though the artifacts remain
independent:

```text
applicable server image → restart server → health/image read-back
                                             ↓
                                  upgrade/restart daemon
                                             ↓
                         session + machine/website read-back
```

The server restart is first so the updated API and Web bundle are active before
the daemon reconnects and registers its runtime RPC/capability state. Existing
stored machine metadata remains separately owned. This combined-operation order
is not a global release bundle, shared-SHA gate, rollback controller, or a reason
to restart an unchanged component. Follow the
[post-update restart playbook](playbooks/post-update-restart.md) for the
evidence and failure boundaries.

### Owned patches and upstream history

Every ordinary owned commit after the baseline is a unique, conventional,
single-parent patch. It has one `docs/owned-patches.tsv` row unless all changed
paths are under `.dev/`. Upstream integration is a non-squashed subtree merge
limited to `server/` and must survive the real range-diff rehearsal. Do not use
ordinary merge commits to refresh a feature branch; rebase that branch onto
current `origin/main` instead.
