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
