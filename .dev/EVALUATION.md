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

Three known change shapes were routed through the generated documents:

1. A localized app-route change reaches the route/component owner, all three
   JSON catalogs, UI inventory generation, app typecheck/tests, `i18n:check`,
   production export, and the product changelog rule.
2. A Codex turn-lifecycle change reaches the CLI Codex owner and colocated
   tests, then the API session, wire/server/app consumers and full CLI/package
   contract proof.
3. An active-provider or Agent Defaults change reaches the harness registry,
   synchronized defaults schema, the explicit exact-machine capability-source
   selector and GrokBuild/Rig catalogs, settings, draft reset boundary, Full New
   Session, HomeDock, and draft launch. Its proof covers registry parity, every
   non-empty active-provider group, localized unavailable states, independent
   provider persistence, absent unsupported dimensions, provider-native Rig
   payloads, and exact-machine revalidation immediately before launch.

All three fixtures produced a complete owner → coupling → targeted verification →
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

Re-run the evidence scan and all fixture routes whenever an update trigger in
`.dev/README.md` fires. Record disproven assumptions and remaining gaps rather
than silently copying prior prose.

## Focused refresh — 2026-08-26

- **Evidence inputs:** the owner-approved prospective task contract;
  `AGENTS.md`; the existing `.dev` context; root Quality and contract
  workflows; patch-discipline source and ledger; and the retained main-push log
  in which `Contract suite` passed while `Real upstream rehearsal` reported Git
  merge conflicts.
- **Read-only reviewer roles:** one contract reviewer compared the proposed
  principles with the exact owner scope and provider/automation boundaries; a
  second lifecycle-and-restraint reviewer checked proof-plane classification,
  YAGNI, and the absence of new enforcement or runtime mechanisms.
- **Checks selected:** exact diff and touched-link inspection,
  `git diff --check`, `node scripts/lint-source.mjs`, and clean-tree
  `scripts/verify-patch-discipline.sh` after commit.
- **Rejected assumptions:** permission modes, models, and per-model effort need
  not all be nonempty for every provider; the fallback limit is a prospective
  owner gate rather than a claim about existing source or a retroactive cleanup
  order; and a rehearsal merge conflict does not make an unrelated,
  independently verified feature fail.
- **Remaining gaps:** TickTick transitions and conflict classification remain
  human-reviewed external evidence, and these principles have no new CI
  enforcement. This focused refresh deliberately adds no workflow, script,
  runtime, automation, fallback, or safety mechanism.

## Focused refresh — 2026-08-26: post-update restart

- **Evidence inputs:** `docs/deployment.md`, `docs/runtime-isolation.md`,
  `.github/workflows/server-image.yml`, `server/Dockerfile`,
  `docs/public-launcher-release.md`,
  `scripts/{build-server-image,deploy-server,install-server-service,install-host-cli,install-linux-daemon-bootstrap,start-host-daemon}.sh`,
  native daemon command/help and continuity tests, app and CLI machine metadata
  schemas, app machine decryption/update paths, and the server's
  `machine-update-metadata` compare-and-swap handler.
- **Observed operational fixture:** a combined main update first proved the
  selected server image and both health endpoints, then reinstalled and
  restarted the daemon without losing its retained sessions. The machine stayed
  online but rendered as `unknown machine` because its decrypted payload held a
  display name without the app schema's required host/runtime fields; repairing
  the same versioned encrypted record and restarting the daemon restored the
  complete machine/provider read-back without changing the machine ID.
- **Read-only reviewer roles:** one operational reviewer checked every Linux and
  macOS command, installed-support owner, and machine-metadata recovery claim;
  one contrarian reviewer checked independent artifacts, server-first ordering,
  cross-platform boundaries, and the absence of a new lockstep gate.
- **Checks selected:** touched-link inspection, exact diff review,
  `git diff --check`, `node scripts/lint-source.mjs`, Markdown link resolution,
  `scripts/test-component-deployment-contract.sh`, and clean-tree
  `scripts/verify-patch-discipline.sh` on the committed exact head.
- **Verification result:** all selected checks passed; the link scan resolved
  every relative Markdown target, and a separate touched-file scan covered the
  new tracked playbook's final newline and trailing whitespace.
- **Rejected assumptions:** a combined restart creates a global lockstep
  release; a successful image workflow proves the service restarted; server
  liveness proves daemon or machine-metadata health; and deleting/recreating an
  unknown machine is an acceptable recovery step.
- **Remaining gap:** the encrypted, versioned metadata update is owned by live
  app/server code, but there is no public operator recovery command for an
  already malformed machine payload. The playbook therefore keeps repair
  maintainer-assisted and does not prescribe raw database edits, machine
  deletion, an ad-hoc migration, or a new runtime guardrail.

## Focused refresh — 2026-08-27: security-feature approval gate

- **Evidence inputs:** the owner's prospective approval rule; `AGENTS.md`;
  `.dev/README.md`; `.dev/playbooks/development-lifecycle.md`; the live TickTick
  project list; and the protected-main delivery and patch-discipline contracts.
- **Observed external contract:** the TickTick list is named exactly
  `In review`. A dedicated task in that list plus Nick's explicit approval,
  recorded in that task, is required before selecting implementation details or
  beginning any HappyHerd-owned security-feature implementation or delegation.
- **Read-only reviewer roles:** one governance reviewer checked the smallest
  authoritative `.dev` placement and upstream exemption; one delivery reviewer
  checked protected-main, verification, and owned-patch requirements.
- **Checks selected:** exact diff review, `git diff --check`,
  `node scripts/lint-source.mjs`, Markdown link resolution, clean-tree patch
  discipline, the full contract suite, and the required protected PR checks.
- **Rejected assumptions:** the shorthand `InReview` is the live list name;
  list placement alone is approval; approval evidence need not be recorded in
  the TickTick task; a security mechanism escapes the gate when labeled as
  reliability or integration; an unchanged-upstream exemption can be asserted
  without path-and-commit evidence; and unchanged upstream Happy security
  behavior or pure removal of a HappyHerd-only security mechanism is itself a
  new HappyHerd security feature.
- **Remaining gap:** the gate is deliberately human-reviewed through TickTick
  and code review. This refresh adds no runtime guard, approval service, or
  other security mechanism.

## Focused refresh — 2026-08-27: `.dev/`-only CI bypass

- **Evidence inputs:** the owner's directive to run no suites for `.dev/`-only
  changes; the live quality and contract workflow triggers; protected-main's
  six required status contexts; and the patch-discipline verifier and ledger.
- **Observed constraint:** path-ignoring both workflows would leave all six
  required checks pending and make the PR unmergeable. Each workflow therefore
  runs one path-scope job and skips every install, lint, typecheck, test, build,
  contract, and upstream-rehearsal job when all changed paths are under `.dev/`.
- **Patch contract:** a `.dev/`-only commit is exempt from the owned-patch
  ledger. Without this exemption the required ledger edit would make the
  commit non-`.dev/` and defeat the CI bypass.
- **Checks selected:** workflow syntax review, scope-detector cases,
  `scripts/test-owned-merge-provenance.sh`, patch discipline, source lint, and
  the protected PR checks because this implementation also changes workflow
  and verifier source.
