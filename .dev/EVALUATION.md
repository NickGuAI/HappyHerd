# Context generation evaluation

## Snapshot

- Generated: 2026-08-21 UTC
- Repository root: discovered with `git rev-parse --show-toplevel` and recorded
  in this context only as `.`
- Evidence baseline: `3a38d4db`
- Scope: development routing, cross-package couplings, verification, SOP
  discovery, protected-main delivery, and post-merge branch cleanup

No credential material or runtime state was read. Operator paths, repository
ownership, and organization-specific deployment details were not persisted in
the generated context.

## Evidence files

The generation pass read these authoritative groups:

- `AGENTS.md`, `README.md`, `server/AGENTS.md`, `server/README.md`,
  `server/docs/CONTRIBUTING.md`, and `server/docs/dev-environments.md`;
- `server/package.json`, `server/pnpm-workspace.yaml`, and every
  `server/packages/*/package.json`;
- package entry points and relevant app sync, server API/socket, CLI API,
  Commander, automation, launcher, and governed-agent modules;
- `.github/workflows/quality-gates.yml`,
  `.github/workflows/contract-suite.yml`, and
  `.github/workflows/public-launcher-release.yml`;
- `scripts/contract-suite.sh`, lineage, patch-discipline, public-boundary,
  product-identity, upstream rehearsal, component-deployment, public-launcher,
  and runtime scripts;
- `docs/lineage.md`, `docs/patch-discipline.md`, `docs/owned-patches.tsv`,
  `docs/upstream-sync-rehearsal.md`, `docs/deployment.md`,
  `docs/public-launcher-release.md`, `docs/runtime-isolation.md`,
  `docs/issuer-protocol.md`, and
  `docs/agentcontext-authority.md`.

## Evidence commands

The pass used read-only Git/GitHub and scoped source discovery, including:

```text
git status --short --branch
git branch --show-current
git remote -v
git branch --merged main
git merge-base --is-ancestor <head> origin/main
git ls-remote --heads origin <exact-ref>
gh pr view <number> --json ...
gh api repos/{owner}/{repo}/branches/main/protection
rg --files
rg <boundary/import/state pattern> <scoped path>
find <scoped path> <bounded predicates>
```

Package manifests were also mechanically inspected for workspace dependencies,
scripts, entry points, and test ownership. Three independent read-only audits
covered topology/couplings, verification, and GitHub lifecycle/cleanup.

## Fixture validation

Two known change shapes were routed through the generated documents:

1. A localized app-route change reaches the route/component owner, all three
   JSON catalogs, UI inventory generation, app typecheck/tests, `i18n:check`,
   production export, and the product changelog rule.
2. A Codex turn-lifecycle change reaches the CLI Codex owner and colocated
   tests, then the API session, wire/server/app consumers and full CLI/package
   contract proof.

Both fixtures produced a complete owner → coupling → targeted verification →
delivery route without relying on a directory name alone.

## Rejected assumptions

- **`scripts/contract-suite.sh` reproduces every PR gate.** Rejected: it does
  not run frozen-install reproducibility, app `i18n:check`, or the production
  web export/build proof.
- **The baseline `server/AGENTS.md` direct-to-main workflow is viable.**
  Rejected: its former `HEAD:main` instruction conflicted with live
  protected-branch rules. This patch aligns the nested guide with the protected
  PR, main verification, and branch-cleanup lifecycle.
- **All workflow files beneath `server/` run as repository CI.** Rejected:
  only root `.github/workflows/**` owns current repository checks.
- **Every branch merged into `main` should be bulk-deleted.** Rejected:
  `prod-release` is long-lived and is also an ancestor of `main`. Cleanup must
  target the exact same-repository head of one proven merged PR.
- **GitHub should auto-delete a branch at merge time.** Rejected for the current
  contract: cleanup waits for ancestry and successful permanent-main workflows.
- **All packages share one runtime state root.** Rejected by live source; CLI,
  agent/log, and Codium defaults differ.
- **A nested app guide's old catalog or test claims override live scripts.**
  Rejected: root `AGENTS.md`, current manifests, catalogs, and tests disagree.

## Current gaps and bounded open questions

- No single local command reproduces both required root workflows.
- CI has no dedicated check that the Markdown changelog and generated JSON are
  synchronized; generation output must be reviewed explicitly.
- Root required checks do not currently exercise Codium or app-logs. Their
  supported/release status is not inferred here.
- Repository settings permit squash and rebase even though the owner workflow
  and patch provenance require merge commits. The playbook prescribes merge
  commits; changing repository settings is outside this documentation patch.
- The native public-launcher platform matrix is tag/manual-only and remains a
  release gate, not ordinary PR evidence.

## Refresh rule

Re-run the evidence scan and both fixture routes whenever an update trigger in
`.dev/README.md` fires. Record disproven assumptions and remaining gaps rather
than silently copying prior prose.
