# HappyHerd agent guide

## Scope

HappyHerd is a thin maintained distribution over upstream Happy. Preserve the
upstream architecture and keep owned changes topical, reviewable, and easy to
range-diff.

## Development context

When a project or repository contains `.dev/`, start at `.dev/AGENTS.md` and
follow its navigation to load only the context relevant to the current task.
Treat `.dev/` as source-derived guidance: the applicable `AGENTS.md` files and
live source remain authoritative.

## Invariants

- `server/` is imported from `https://github.com/slopus/happy.git` with full
  history. Do not squash upstream history.
- Commanders and agents should prefer provider-native subagents for bounded
  fan-out. Use a HappyHerd side chat when the child work needs a durable,
  visible, resumable conversation. The parent remains accountable for scope,
  integration, verification, and final delivery.
- The Git remote named `upstream` always points to `slopus/happy`.
- Do not copy changes from the dirty reference checkout at
  `App/external-projects/happy` without reviewing and recommitting them as an
  explicit HappyHerd patch.
- Do not rename the Happy product during G0/A1-A6. Apply only the approved
  Hervald logo mark.
- Never commit account keys, provider credentials, master secrets, runtime
  databases, logs, or CLI homes.
- Each roadmap item lands as a topical commit and must carry acceptance
  evidence before its TickTick checklist item is completed.
- Local reconnect-record age alone must never invalidate a session across
  service updates or daemon restarts. Actual resume depends on retained server,
  provider, and recovery state; when available, preserve the Happy ID, original
  machine/path, encryption, provider session/thread and state home, prior
  context, and ability to accept the next turn.
- Do not add a HappyHerd-only guard, gate, approval flow, version or source
  lock, fail-closed refusal, automatic rollback, process supervisor, or
  isolation layer without explicit human approval recorded in the owning
  issue and pull request. Upstream Happy behavior is the default.

## Multiagent roles and delegation

- **Human** is the person using HappyHerd.
- **Main Agent** is the session the Human interacts with directly.
- **Orchestrating Agent** is any Main Agent or Worker Agent that explicitly
  creates and manages delegated work. It remains accountable for its direct
  children and the integrated result.
- **Worker Agent** executes one bounded brief.
- **Provider-native subagent** is ephemeral inline fan-out owned by a provider.
  It is the default mechanism for bounded parallel work.
- **HappyHerd side chat** is a durable, visible, resumable child conversation
  with stable parent lineage. Use it when work needs persistence, inspection,
  or multiple turns.

An Orchestrating Agent explicitly creates every delegated task. When the Main
Agent delegates through the CLI, its HappyHerd side-chat brief must state the
outcome, scope, dependencies, write ownership, verification, and handoff. The
Orchestrating Agent owns child lifecycle and reviews the final handoff. Side
chats do not create more side chats by default; use provider-native subagents
for bounded fan-out inside a child.

The Human launches a side chat from the app's New side chat action with one
click and no fields. The app sends only the parent session ID through the
dedicated `happyherd-side-chat-create` machine RPC, creates an empty durable
child conversation, focuses and opens it, and exposes its normal composer. The
Main Agent launches a delegated Worker Agent through `happyherd session
side-chat create`; that CLI path requires all six non-empty brief fields and
delivers the brief as the child's first queued message. Both paths enter the
same daemon-owned lifecycle. Human creation skips `deliver-brief`; generic
session spawn must not set `isSideChat` or bypass the dedicated lifecycle.

## Package manager and verification

Run Happy commands from `server/` and use the pinned `pnpm` version declared by
upstream. Prefer package-scoped tests during iteration; run the repository
contract suite before release.

## Interface ownership and localization

- Product-owned copy belongs in the en/cn/de JSON catalogs. Do not introduce
  production UI literals or a hardcoded-copy allowlist.
- Keep provider/model slugs, commands, paths, filenames, logs, user content,
  and agent content byte-faithful; localize only surrounding product copy.
- When routes or UI-owning modules change, regenerate the source-derived
  `ui-surface-inventory.json` and `ui-tree.html` with
  `pnpm --filter happy-app ui:inventory:generate`.
- `pnpm --filter happy-app i18n:check` is the required guardrail for catalog
  parity, semantic exemptions, AST copy scanning, the 36-route inventory, and
  the critical locale/viewport/theme smoke matrix.
- Every top-level desktop sidebar destination must use the shared
  `SidebarNavigationButton` component and live in the primary navigation
  column. Do not give vertically stacked navigation controls flexible height;
  new destinations must match the New Session button's width, height, spacing,
  typography, interaction states, and accessibility semantics.

## Product changelog

- Every user-visible HappyHerd change must update
  `server/packages/happy-app/CHANGELOG.md` in the same pull request. Do not rely
  on upstream Happy release notes to describe HappyHerd-owned behavior.
- Keep HappyHerd entries alongside retained upstream entries in reverse
  chronological order. Write for users: describe the observable outcome and
  any important compatibility or security boundary, not internal iteration
  history.
- After editing the Markdown source, regenerate
  `server/packages/happy-app/sources/changelog/changelog.json` with the existing
  changelog parser and verify that the newest title and entry count match.
