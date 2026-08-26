# Couplings and state ownership

Use this map to find changes that cross package boundaries or alter who owns
durable truth. Package manifests and concrete call sites are authoritative.

## Workspace dependency graph

```text
@slopus/happy-wire
   ├──► happy-app
   ├──► happy-cli (package name: happy) ◄── @happyherd/cli
   ├──► happy-server
   ├──► happy-agent ◄── @happyherd/happyherd-agent
   └──► happy-server-self-host

happy-server-self-host ──builds──► happy-server + Prisma + happy-app web bundle
```

- `happy-wire` is the shared protocol leaf. A schema change can affect every
  application and runtime even if TypeScript finds only some consumers.
- `@happyherd/cli` wraps the maintained `happy` CLI and adds issuer, Skills,
  credential-broker, runtime, and installer boundaries.
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
  → `happy grok`
  → existing `agent/acp` runner
  → official GrokBuild CLI over ACP stdio
```

GrokBuild authentication remains owned by the installed provider CLI. Model,
reasoning-effort, permission, and resume capabilities come from its live ACP
responses; resume stays on the original machine. App attachment and fork
surfaces must follow advertised ACP capabilities rather than another provider
fallback.

### Provider defaults and session launch

```text
active non-retired HARNESS_ORDER
  → Agent Defaults schema + settings groups
  → explicit Agent Defaults capability-source selector
      (initially prefers the New Session draft machine)
  → selected daemon catalog or explicitly empty dimensions
       ├── GrokBuild agentCapabilities
       └── Rig sessionCreation metadata
  → Full New Session + HomeDock draft + draft launcher
  → exact-daemon catalog re-read and selection validation
  → provider-native spawn payload
```

The active harness registry owns Defaults coverage; retired Gemini remains
parseable only for old synchronized settings. Agent Defaults visibly names and
lets the user change its exact capability-source daemon without mutating the
New Session draft. GrokBuild and Rig own their permission, model, and per-model
effort values through that daemon. Unsupported dimensions stay explicitly
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
and secret material separate. The runtime-isolation and issuer contracts define
those boundaries.

## State owners

| State | Canonical owner | Important boundary |
|---|---|---|
| Server users, machines, sessions, messages, and related records | `happy-server/prisma/schema.prisma` through server storage modules | PostgreSQL/PGlite is durable; Redis is optional realtime coordination, not a replacement database |
| Server files | `happy-server/sources/storage/files.ts` and selected local/S3 adapter | Deployment profile chooses the backend; callers use the storage boundary |
| App live view state | `happy-app/sources/sync/storage.ts` | Derived client state must reconcile with server truth |
| App local persistence | `happy-app/sources/sync/persistence.ts` | MMKV/local cache is device state, not cross-client authority |
| App credentials | `happy-app/sources/auth/tokenStorage.ts` | SecureStore/native and browser storage implementations differ |
| Maintained CLI machine/session runtime | `happy-cli/src/configuration.ts` and `persistence.ts` | Defaults beneath `~/.happyherd`; do not mix with other package defaults |
| Session heartbeat configuration and history | `happy-cli/src/automations/{store,service}.ts` | Stores cadence and one occurrence reference; the target session log and MessageQueue2 own message content and FIFO state |
| Commander identity and AgentContext | Human-authored Markdown/JSONL beneath the HappyHerd home | Human knowledge remains reviewable files; runtime state does not own it |
| Issuer credentials and verified Skill receipts | Launcher broker/OS secret store and launcher registry | Credentials never become agent-session state or receipt content |
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
`happy machine auth` stores its account-control key only at `agent.key` in the
configured HappyHerd home; normal native auth remains in `access.key`, and
HappyHerd issuer credentials remain unrelated. Do not copy or derive one from
another. Because those package exports resolve through `happy-agent/dist`, the
existing injected-package publish lifecycle builds that surface for clean
workspace installs after its `happy-wire` dependency is available. Do not add a
second root-postinstall build: it races pnpm's injected `happy-wire` packaging.
The server image's filtered deps install also runs those injected-package
lifecycles. Its deps stage must copy the full `happy-agent` and `happy-wire`
package inputs before install—not only their manifests—so TypeScript sources
and configuration, tests, and bins exist and source changes invalidate the
cached install layer.
The server-image workflow path filter must include both package trees.
Release jobs that deliberately install with `--ignore-scripts` must instead
build `happy-agent` explicitly before building `happy` and the launcher payload.
Native `happy session create` accepts only Happy CLI daemon machines. Rig has a
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

Coordinated child side chats extend that same exact-daemon boundary:

```text
happy session side-chat <parent-session-id>
  → authenticated loopback request to the running local daemon
  → resolve exact parent from machine-local reconnect data
  → require parent machine ID == this daemon machine ID
  → daemon-owned provider fork
       ├── Claude provider-native session fork
       └── Codex provider-native thread fork
  → daemon spawn on the same machine and path
       with fresh provider resume ID + parentSessionId + isSideChat
  → hidden child metadata in synchronized session state
  → exact-parent child selector
       ├── wide Web/Mac collapsible sidebar
       └── narrow/native full-screen panel
```

The parent session record owns the machine, path, provider, and provider-backend
identity used for the fork; the command never substitutes another machine or
provider. Side-chat creation is intentionally local-owner-only and does not
load `agent.key`, list account machines, or fall back to the QR-based
account-control flow. The loopback request accepts only the parent Happy
session ID; the daemon re-resolves every launch value from its own persisted
record, rejects a parent belonging to another machine, and coalesces concurrent
requests for the same exact parent while fork-and-spawn is in flight.
Provider-native fork
operations must complete before child spawn, and the
new backend ID—not the parent's ID—is the resume target. `parentSessionId` and
`isSideChat` are persisted child lineage: top-level session selectors exclude
those children while the parent view discovers every non-archived exact child,
including children created by another CLI client. Side-chat presentation is
independent of the default-off file-diff-sidebar setting. Collapsing either
presentation changes only local view state; closing a child tab stops it and
always archives the server session so it stays absent after reload. The
encrypted archive acknowledgement uses Socket.IO's native timeout so a
buffered mutation cannot apply after a reported failure. After a lost
acknowledgement, the app refreshes and reads back the canonical lifecycle
marker before it reports success or restores a retryable tab.

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
| Native public launcher | `happyherd-cli`, `happy-cli`, installers, native service code |

These are independent delivery lanes. The self-host server intentionally
contains the Web bundle, but changing the CLI/daemon, mobile client, governed
agent, or public launcher does not rebuild or activate the others. Compatibility
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
single-parent patch with one `docs/owned-patches.tsv` row. Upstream integration
is a non-squashed subtree merge limited to `server/` and must survive the real
range-diff rehearsal. Do not use ordinary merge commits to refresh a feature
branch; rebase that branch onto current `origin/main` instead.
