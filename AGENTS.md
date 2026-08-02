# HappyHerd agent guide

## Scope

HappyHerd is a thin maintained distribution over upstream Happy. Preserve the
upstream architecture and keep owned changes topical, reviewable, and easy to
range-diff.

## Invariants

- `server/` is imported from `https://github.com/slopus/happy.git` with full
  history. Do not squash upstream history.
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

## Package manager and verification

Run Happy commands from `server/` and use the pinned `pnpm` version declared by
upstream. Prefer package-scoped tests during iteration; run the repository
contract suite before release.

