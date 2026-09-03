# HappyHerd development index

Use this directory as the progressive-disclosure entry point for HappyHerd
development. Root and nearest `AGENTS.md` files and current source remain
authoritative. This map routes work to that evidence; it is not a second source
of truth.

## Read only what the change needs

| Need | Start here |
|---|---|
| Find the owning package or entry point | [`ROUTING.md`](ROUTING.md) |
| Trace dependencies, state owners, and end-to-end paths | [`COUPLINGS.md`](COUPLINGS.md) |
| Select focused, package, build, and CI checks | [`VERIFY.md`](VERIFY.md) |
| Find the maintained operational document or executable owner | [`SOP_INDEX.md`](SOP_INDEX.md) |
| Classify and obtain approval for a HappyHerd-owned security feature | [`playbooks/security-feature-approval.md`](playbooks/security-feature-approval.md) |
| Add or change a provider | [`playbooks/provider-onboarding.md`](playbooks/provider-onboarding.md) |
| Deliver through protected `main` | [`playbooks/development-lifecycle.md`](playbooks/development-lifecycle.md) |
| Activate a combined server and daemon update | [`playbooks/post-update-restart.md`](playbooks/post-update-restart.md) |
| Delegate or operate side chats | [`playbooks/side-chat-lifecycle.md`](playbooks/side-chat-lifecycle.md) |
| Maintain file workspaces | [`playbooks/file-workspaces.md`](playbooks/file-workspaces.md) |
| Verify an unattended automation provider | [`playbooks/automation-unattended-smoke.md`](playbooks/automation-unattended-smoke.md) |
| Audit this context or record a disproven claim | [`EVALUATION.md`](EVALUATION.md) |

## Select the HappyHerd skill

HappyHerd-owned skill sources live under [`skills/`](skills/). Load only the
skill or skills required by the current evidence.

| Need | Skill |
|---|---|
| Operate sessions, the daemon, Commanders, automations, or diagnostics through the supported CLI | [`happyherd`](skills/happyherd/SKILL.md) |
| Deliver a Human-facing journey across its targeted surfaces | [`happyherd-develop-ux`](skills/happyherd-develop-ux/SKILL.md) |
| Implement, repair, or verify the one Human-facing Workspace file surface | [`happyherd-develop-workspace`](skills/happyherd-develop-workspace/SKILL.md) |
| Remove unsupported or over-designed task scope | [`happyherd-eng-descope`](skills/happyherd-eng-descope/SKILL.md) |
| Establish cause and track one investigation without implementing | [`happyherd-eng-investigate`](skills/happyherd-eng-investigate/SKILL.md) |
| Implement and deliver exactly one existing TickTick task | [`happyherd-eng-deliver`](skills/happyherd-eng-deliver/SKILL.md) |
| Verify one delivered revision and decide which activation, if any, is required | [`happyherd-eng-signoff`](skills/happyherd-eng-signoff/SKILL.md) |
| Merge one explicitly approved upstream SHA without squashing | [`happyherd-sync-upstream`](skills/happyherd-sync-upstream/SKILL.md) |
| Add, change, test, or diagnose a provider vertical slice | [`happyherd-update-provider`](skills/happyherd-update-provider/SKILL.md) |
| Gate a safeguarded Human turn when HappyHerd injects the skill | [`happyherd-user-safeguard`](skills/happyherd-user-safeguard/SKILL.md) |
| Maintain or migrate one Commander's L2/L3 memory from evidence | [`commander-memory-cleanup`](skills/commander-memory-cleanup/SKILL.md) |

`workspace-manage-tasks`, `systemops-establish-ground-truth`,
`engineering-review`, `engineering-verify-change`, and `marketing-review-ux`
are shared dependencies, not HappyHerd-owned skill sources.

## Non-negotiable gates

- Keep one owning TickTick task for each feature. Use the `workspace-manage-tasks` skill for
  writes, preserve fields outside the requested mutation, and read every write
  back through the owning project.
- Apply the existing dedicated `In review` approval gate before implementing a
  HappyHerd-owned security feature. Follow
  [`playbooks/security-feature-approval.md`](playbooks/security-feature-approval.md)
  for the classification, required task evidence, approval, and exemptions.
- Keep automation behavior, schema, cadence, lifecycle, and UI unchanged unless
  the owner explicitly scopes them.
- Route provider and Human-facing work through the dedicated skills above;
  preserve provider-native contracts and prove real targeted UI journeys.
- Preserve upstream-conflict evidence and pause for owner direction before
  resolving it.
- Require exact-head review and the smallest complete change. Add no fallback
  unless the current supported contract proves it necessary, and never add
  more than one without explicit owner direction.
- A commit changing anything outside `.dev/` needs its exact conventional
  subject in `docs/owned-patches.tsv`. A user-visible change also updates the
  product changelog and regenerated JSON.
- Merge, deployment, installation, restart, branch cleanup, and TickTick
  completion are separate effects. Perform only those covered by current
  authority.

## Refresh this map

Use the update triggers in [`EVALUATION.md`](EVALUATION.md#update-triggers).
When current source disproves a route, coupling, check, or procedure, record
the evidence there and repair only the affected entry. Do not preserve stale
guidance for compatibility.
