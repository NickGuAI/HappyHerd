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

### Owned patches and upstream history

Every ordinary owned commit after the baseline is a unique, conventional,
single-parent patch with one `docs/owned-patches.tsv` row. Upstream integration
is a non-squashed subtree merge limited to `server/` and must survive the real
range-diff rehearsal. Do not use ordinary merge commits to refresh a feature
branch; rebase that branch onto current `origin/main` instead.
