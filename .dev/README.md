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

## Navigate

| Need | Read |
|---|---|
| Find the owning package or entry point | [`ROUTING.md`](ROUTING.md) |
| See dependencies, state owners, and end-to-end paths | [`COUPLINGS.md`](COUPLINGS.md) |
| Select cheap, targeted, full, and CI checks | [`VERIFY.md`](VERIFY.md) |
| Find the canonical operational document or script | [`SOP_INDEX.md`](SOP_INDEX.md) |
| Deliver through protected `main` and clean the branch | [`playbooks/development-lifecycle.md`](playbooks/development-lifecycle.md) |
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

 @happyherd/cli ──wraps──► happy-cli
        ├── issuer device flow and verified Skills
        └── OS-separated credential broker and native installers

 happyherd-agent ──uses──► happy-agent/control ──uses──► server/daemon
        ├── Discord gateway
        └── governed loopback broker ──► organization service

 happy-server-self-host ──uses wire; bundles──► happy-server + happy-app

 Root docs + scripts + workflows govern lineage, patches, verification,
 reproducible releases, runtime isolation, rollback, and upstream rehearsal.
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
subject and a matching `docs/owned-patches.tsv` row in the same commit. Every
user-visible change also updates `server/packages/happy-app/CHANGELOG.md` and
its generated JSON. These are repository contracts, not optional release
bookkeeping.

## Update triggers

Update this directory when any of these change:

- workspace packages, entry points, imports, RPC/message schemas, or state roots;
- app routes, localization catalogs, UI inventory, or changelog generation;
- package scripts, pinned tool versions, tests, build commands, or CI checks;
- branch protection, merge policy, patch discipline, or upstream-sync rules;
- release, installer, runtime-isolation, deployment, or rollback contracts; or
- a source audit disproves a route or coupling documented here.

Review the concrete source again before changing the map. Do not preserve a
stale statement for compatibility with this generated context.
