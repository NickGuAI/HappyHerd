---
name: happyherd-sync-upstream
description: "Use when performing an owner-approved non-squash subtree merge of a specific slopus/happy SHA into HappyHerd while preserving lineage and owned patches. Not for the daily proposal check."
---

# HappyHerd Upstream Sync

## Goal

Integrate an approved update from the trusted `slopus/happy` repository into
HappyHerd's `server/` subtree without squashing, while preserving full lineage
and every owned HappyHerd behavior.

## Acceptance criteria

- The owning task records explicit approval for the exact upstream SHA.
- A read-only check confirms whether `happyherd-upstream-merge-proposal` is
  active, uses `Etc/UTC`, runs at `17 9 * * *`, and has a completed latest run.
  A discrepancy is reported as a bounded gap; it neither grants nor revokes
  owner authority, and the automation is never mutated by this skill.
- The local baseline and target upstream are recorded as full `origin/main`
  and `upstream/main` SHAs before rehearsal.
- The actual non-squashed subtree merge has exactly two parents, with the
  trusted upstream SHA as the second parent, and subject exactly
  `Merge commit '<full-upstream-sha>'`.
- Every subject in `docs/owned-patches.tsv` remains represented by the
  range-diff and passes patch-discipline verification.
- `server/packages/happy-cli` remains the in-place CLI implementation and
  history path, with public package `@happyherd/cli` and binary `happyherd`.
  Upstream changes do not recreate a wrapper package or legacy `happy` package.
- The selected checks in `.dev/VERIFY.md`, the contract suite, required PR
  checks, and post-merge main workflows all pass.

## Resources and boundaries

Read the live HappyHerd sources instead of copying their rules into this Skill:

- `AGENTS.md`, `.dev/ROUTING.md`, and `.dev/VERIFY.md`
- `.dev/playbooks/development-lifecycle.md`
- `docs/upstream-sync-rehearsal.md`, `docs/lineage.md`, and
  `docs/patch-discipline.md`
- `docs/owned-patches.tsv`
- `scripts/rehearse-upstream-sync.sh`
- `scripts/test-upstream-sync-provenance.sh`
- `scripts/verify-lineage.sh` and `scripts/verify-patch-discipline.sh`
- `scripts/contract-suite.sh`

The daily proposal automation detects and scopes potential updates. This Skill
does not replace it and does not turn a proposal into merge authority. Without
current user authority, do not push, create a PR, merge, deploy, update a task,
or mutate an automation. Never use the canonical checkout for a rehearsal or
discard unrelated worktree changes.

## Working guidance

Read the automation definition and its latest run through the supported
interface:

```bash
happyherd automation list --json
happyherd automation history <automation-id> --json
```

Freeze the full local and upstream SHAs, then run
`scripts/rehearse-upstream-sync.sh` with no arguments from the clean pushed
baseline it requires. Its disposable clone is the rehearsal boundary. Capture
the range-diff, merge conflicts, and contract-suite result; distinguish
mechanical reconciliations from unresolved owner decisions.

After the approved task resolves any owner decisions, perform the actual merge
in an isolated topical worktree and branch. Preserve the merge topology and
subject defined in the acceptance criteria. Reconcile conflicts against the
current HappyHerd contracts rather than restoring overwritten upstream
defaults. For CLI conflicts, keep upstream implementation changes in the
existing `server/packages/happy-cli` path while retaining the current public
package and command names.

Verify the proposed integration with:

```bash
scripts/verify-lineage.sh
scripts/verify-patch-discipline.sh
scripts/test-upstream-sync-provenance.sh
scripts/contract-suite.sh
```

Run the additional affected-package and production checks selected by
`.dev/VERIFY.md`, then use `.dev/playbooks/development-lifecycle.md` for the
topical PR, required checks, merge-commit policy, post-main Quality and Contract
workflows, ancestry proof, and exact branch cleanup.

## Output specification

Return one sync report containing:

- frozen local baseline and target upstream full SHAs;
- automation ID, status, timezone, schedule, and latest run outcome;
- rehearsal result, range-diff result, conflicts, mechanical resolutions, and
  any owner decisions;
- merge subject, both parent SHAs, topical branch, PR, merge SHA, required-check
  results, post-main workflow results, and ancestry proof when authorized;
- explicit CLI-path/public-name preservation when upstream touched the CLI;
- any bounded gaps, including automation discrepancies or unverified behavior.
