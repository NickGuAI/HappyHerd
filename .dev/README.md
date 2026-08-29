# HappyHerd developer context

This directory is the evidence-backed map for developing HappyHerd. It explains
where a change belongs, which adjacent surfaces move with it, how to verify it,
and how a branch reaches and is removed after protected `main`.

The map is guidance, not a second source of truth. Live source, the applicable
`AGENTS.md`, package manifests, executable scripts, and root GitHub workflows
remain authoritative. Protected-branch delivery is a distribution-level
contract owned by the root workflows and the aligned branch guidance in root
and `server/AGENTS.md`. Record any new discrepancy in
[`EVALUATION.md`](EVALUATION.md) and repair this map in a focused patch.

## Project development principles

These are owner-approved prospective gates for future changes. They are not
source-derived claims and do not require retroactive cleanup of prior work.

```text
ordinary feature → owning TickTick task → bounded change
security feature → TickTick "In review" → Nick explicitly approves → bounded change
                                              └─ otherwise → STOP
bounded change → exact-head review → PR → merge
```

1. **Own the work in TickTick.** Every feature has an owning task. Add concise
   comments at real progress, decision, blocker, PR, and merge transitions.
2. **Gate every HappyHerd-owned security feature before design.** Read-only
   investigation and proposal-level analysis may identify the problem and the
   anticipated mechanism. Before selecting implementation details, branching,
   implementation, or delegation, create a dedicated TickTick task in the list
   named exactly `In review`, obtain Nick's explicit approval, and record that
   approval in the task. This applies to any HappyHerd-owned mechanism that
   introduces or expands authentication, authorization, encryption, signing,
   integrity or provenance verification, credential storage, privileged
   brokering or helping, sandboxing or isolation, ACL/setuid/seccomp
   enforcement, security refusal or rollback, supervision, or other hardening,
   regardless of how the change is labeled. The task must state the user
   problem, why unchanged upstream Happy behavior is insufficient, the
   anticipated process/privilege/state/failure mode, and the simplest
   no-new-security alternative. Task creation, list placement, or silence is
   not approval; approval outside TickTick counts only after its exact text or
   linked evidence is recorded in the task. If approval or classification is
   unclear, treat the change as a security feature and stop. Unchanged upstream
   Happy behavior is exempt only when its source path and upstream commit or
   range-diff prove it remains unchanged. Removing a HappyHerd-only security
   mechanism is also exempt when the change introduces or expands no
   replacement mechanism and preserves upstream Happy behavior.
3. **Freeze automation unless explicitly scoped.** Automation behavior, schema,
   cadence, lifecycle, and UI do not change unless the owner explicitly scopes
   that change in the owning task.
4. **Keep the provider contract authoritative end to end.** Provider additions
   and changes carry that provider's authoritative permission modes, models,
   and per-model effort choices through discovery, selection, message
   admission, launch, runtime behavior, event normalization, and rendering.
   Keep shared transit fields open to provider-native values, validate at the
   exact provider boundary, keep unsupported dimensions explicitly empty, and
   never invent values or fall back across providers. Document whether each
   permission mode is a launch policy, a runtime selector, or a Happy-handled
   approval policy. If the UI promises a non-interactive mode, a late provider
   permission callback must follow its documented allow or deny behavior
   without creating a pending user request. Preserve a provider tool's call ID,
   display title, category, input, result, and error as separate concepts; an
   unfamiliar valid tool must still render meaningfully.
5. **Pause on upstream conflicts.** Preserve the conflict evidence, stop
   resolution work, and request owner direction through the owning TickTick
   task before opening any resolution PR.
6. **Review the exact head and keep it necessary.** Require exact-head
   engineering review and apply YAGNI: add no unrequested mechanism. Use zero
   fallback by default and at most one only when the current supported contract
   demonstrably requires it. Continue ordinary correctness, security, privacy,
   and data-integrity review.

## Navigate

| Need | Read |
|---|---|
| Find the owning package or entry point | [`ROUTING.md`](ROUTING.md) |
| See dependencies, state owners, and end-to-end paths | [`COUPLINGS.md`](COUPLINGS.md) |
| Select cheap, targeted, full, and CI checks | [`VERIFY.md`](VERIFY.md) |
| Find the canonical operational document or script | [`SOP_INDEX.md`](SOP_INDEX.md) |
| Add or change a provider | [`playbooks/provider-onboarding.md`](playbooks/provider-onboarding.md) |
| Deliver through protected `main` and clean the branch | [`playbooks/development-lifecycle.md`](playbooks/development-lifecycle.md) |
| Run a combined central-server and native-daemon update | [`playbooks/post-update-restart.md`](playbooks/post-update-restart.md) |
| Operate and verify side-chat lifecycle | [`playbooks/side-chat-lifecycle.md`](playbooks/side-chat-lifecycle.md) |
| Audit how this context was derived | [`EVALUATION.md`](EVALUATION.md) |

## System at a glance

```text
                              @slopus/happy-wire
                                      │
                 ┌────────────────────┼────────────────────┐
                 ▼                    ▼                    ▼
        happy-app UI  ◀──HTTP/WS── happy-server ──HTTP/WS── happy-cli daemon
        Expo/web/native              Prisma/storage         provider adapters
                 │                                             │
                 └──────── machine/session RPC relay ──────────┘

 @happyherd/cli ──exact passthrough──► happy-cli
        └── user-owned installer ──persists──► normal Happy server settings

 happyherd-agent ──uses──► happy-agent/control ──uses──► server/daemon
        ├── Discord gateway
        └── governed loopback broker ──► organization service

 happy-server-self-host ──uses wire; bundles──► happy-server + happy-app

 Root docs + scripts + workflows govern lineage, patches, verification,
 component-native deployment, runtime boundaries, and the local installer.
 A machine-local HappyHerd automation owns upstream merge proposals.
```

The dependency edges above are grounded in `server/pnpm-workspace.yaml`, the
package manifests, `server/packages/happy-wire/src/index.ts`, the app sync
modules, the server API/socket entry points, and the CLI API clients.

## Start a development change

From the repository root:

```bash
test -z "$(git status --porcelain --untracked-files=normal)"
git fetch origin
git switch main
git pull --ff-only origin main
git status --short --branch
git switch -c type/short-description

cd server
pnpm install --frozen-lockfile
```

Use Node 20, pnpm 10.11.0, and Bun 1.3.11, matching the root workflows. For an
upstream-style local environment, inspect `server/docs/dev-environments.md`
and the `env:*` scripts in `server/package.json`; do not copy the upstream clone
instructions from `server/docs/CONTRIBUTING.md` into this distribution checkout.

Before editing:

1. Use [`ROUTING.md`](ROUTING.md) to locate the owner and neighbors.
2. Use [`COUPLINGS.md`](COUPLINGS.md) to identify shared contracts and state.
3. Pick package-scoped checks from [`VERIFY.md`](VERIFY.md).
4. Follow the complete branch-to-cleanup lifecycle in the playbook.

Every owned commit after the immutable baseline needs a unique conventional
subject. It also needs a matching `docs/owned-patches.tsv` row in the same
commit unless every changed path is under `.dev/`. Every user-visible change
also updates `server/packages/happy-app/CHANGELOG.md` and its generated JSON.
These are repository contracts, not optional release bookkeeping.

## Update triggers

Update this directory when any of these change:

- workspace packages, entry points, imports, RPC/message schemas, or state roots;
- provider registries, capability sources, permission semantics, adapters, or
  raw event shapes;
- app routes, localization catalogs, UI inventory, or changelog generation;
- package scripts, pinned tool versions, tests, build commands, or CI checks;
- branch protection, merge policy, patch discipline, or upstream-sync rules;
- component deployment, installer, runtime-boundary, or public-release contracts; or
- a source audit disproves a route or coupling documented here.

Review the concrete source again before changing the map. Do not preserve a
stale statement for compatibility with this generated context.
