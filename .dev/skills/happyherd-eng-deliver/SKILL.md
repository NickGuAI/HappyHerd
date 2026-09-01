---
name: happyherd-eng-deliver
description: "Deliver exactly one existing HappyHerd TickTick task from its current approved contract to verified, review-ready pull requests in only the repositories it requires. Use when the user supplies one exact task and explicitly asks for implementation or delivery; not for investigation-only work, task batches, an unspecified task, or automatic merge, deployment, restart, or task completion."
---

# HappyHerd Engineering Delivery

## Goal

Deliver the smallest complete change for exactly one existing HappyHerd
TickTick task, ending by default with a verified task handoff and one pushed,
review-ready pull request per repository the task actually requires.

## Establish the one-task contract

Require one exact existing task ID or URL and a current instruction to
implement or deliver it. If the task is missing, ambiguous, or one of several
candidates, stop and ask for the owner; never choose silently. Do not create a
sibling, replacement, follow-up, or umbrella task.

Use the `ticktick` skill to read the task through its owning project. Retain the
complete raw task and comment response as the baseline. After a write, compare
every unchanged user-controlled field, including project, parent,
section/column, title, content, status, checklist, priority, dates, timezone,
all-day state, tags, recurrence, reminders, ordering, and children; exclude
only identified server-maintained fields such as etags and timestamps. Derive
scope from the latest owner instruction, recorded corrections, and observable
acceptance. A request to deliver the task grants implementation authority for
that established boundary, not authority to merge, deploy, restart, clean up a
branch, close the task, or expand the scope.

If HappyHerd injected `happyherd-user-safeguard`, honor its approval gate. Also
apply the repository's separate security-feature gate when relevant. Do not
treat either gate as routine approval for an effect outside its stated scope.

## Prepare from current ground truth

1. Run `preflight` against each required canonical repository without changing
   it.
2. Resolve any open pull request already linked to the task for each
   repository. Reuse its verified remote head in an isolated worktree and
   refresh it through the repository lifecycle. Create a new topical worktree
   from current `origin/main` only when that repository has no task-owned pull
   request. Stop when ownership is ambiguous or more than one candidate exists
   for the same repository. Never switch, stash, clean, reset, or overwrite a
   dirty canonical checkout.
3. Start at `.dev/AGENTS.md`, then read only the routing, coupling,
   verification, SOP, playbook, and live source needed for this task.
4. State the violated invariant, smallest repair boundary, affected surfaces,
   and proof required before editing.

## Compose only relevant skills

Use the HappyHerd-owned sources routed by `.dev/AGENTS.md`:

- If cause, repair boundary, or acceptance is not established, run
  `happyherd-eng-investigate` as a bounded read-only phase. Accept its
  no-write investigation receipt; require a TickTick mutation receipt only
  when that exact update is separately authorized. Its stop ends the embedded
  investigation phase, not the already-authorized outer delivery. Continue
  only when the established repair boundary remains inside the existing
  authority; do not ask for a redundant routine approval.
- Run `happyherd-eng-descope` when the task contains unsupported mechanisms,
  mock detail presented as scope, adjacent cleanup, or a later owner
  correction. Persist a rewrite only when that exact task mutation is
  authorized.
- Use `happyherd-develop-ux` for a Human-facing journey,
  `happyherd-update-provider` for provider behavior, and
  `happyherd-sync-upstream` only for an explicitly approved upstream SHA.
- Use `happyherd` only for supported terminal, session, daemon, Commander,
  automation, or diagnostic operations; it is not a source-editing workflow.

Use shared skills such as `context-explore`, `app-verification`, and
`ux-designer-review` only when their trigger is present. Delegate only bounded,
independent, file-disjoint lanes. The parent retains task ownership, integrates
all artifacts, and makes the final decisions.

## Implement and prove the smallest complete change

1. Add or identify focused regression evidence at the earliest boundary that
   can prove the violated invariant.
2. Change the owning mechanism without speculative abstractions, compatibility
   rails, hardening, fallbacks, or unrelated cleanup.
3. Update only context made stale by the change. For a user-visible change,
   update the product changelog and regenerate its JSON.
4. Select focused and affected-surface checks from `.dev/VERIFY.md`. Keep
   source/tests, rendered behavior, build, deployment, and live behavior as
   distinct proof planes.
5. For any commit touching outside `.dev/`, add the exact conventional commit
   subject to `docs/owned-patches.tsv`. The `.dev`-only exemption must remain
   genuinely `.dev`-only.

When work is delegated, use the `ticktick` skill for one bounded dispatch and
one schema-compliant handoff receipt per delegated lane. Each receipt keeps its
own lane, session identity, status, commit, and verification fields. Do not add
coordination comments for a single-agent delivery. When the current instruction
separately authorizes a task-content handoff, append or replace only the clearly
owned handoff section. Otherwise return repository results in the final
response. Read every authorized write back against the complete baseline,
preserve every unrelated task field, and do not use comments as a progress log,
queue, or command channel.

## Review and publish one exact head

In each required repository, stage only reviewed task-owned paths and commit
the topical change. Run the required checks on the committed state. Invoke
`engineering-review` on each exact head against the owner directive, task
contract, acceptance criteria, and supported callers. Fix evidenced reachable
findings, repeat affected checks, and re-review every changed exact head; do
not adopt speculative scope from a review.

Push each topical branch and open or update exactly one review-ready pull
request for every repository containing task-owned changes. Record its outcome,
exact head, checks, bounded gaps, and task reference in the authorized task
handoff or final response. Never create more than one task-owned PR in the same
repository merely because the task spans repositories.

Invoke `happyherd-eng-signoff` on every exact head as the final gate, then
aggregate the receipts. It must classify the changed lanes, verify the
available proof, and decide whether any activation is needed without assuming
authority to perform it.

## Stop boundary

By default, stop with the review-ready pull requests and the owning TickTick
task open. Merge, deployment, installation, restart, branch cleanup, task
closure, and task completion require separate current authority. Never report
those effects as complete from source, test, build, PR, or process-presence
evidence.

## Acceptance and output

The delivery is complete only when exactly one task owns one verified final
head and exactly one review-ready PR in every repository containing task-owned
changes, every required local check passes or has a named external prerequisite,
exact-head review has no unresolved actionable finding, sign-off has classified
all changed lanes, and every authorized TickTick write has been read back
without task metadata drift.

Return:

1. **Task contract** — task/project/parent IDs, title, outcomes, and authority.
2. **Change** — violated invariant, repair, files, and relevant skills used.
3. **Evidence** — focused checks, affected-surface proof, and exact-head review.
4. **Delivery receipts** — each repository's commit, branch, and PR; the task
   metadata read-back plus every authorized comment read-back.
5. **Sign-off** — each exact head's lane decisions and aggregate activation
   status.
6. **Remaining effects** — every unperformed merge, deployment, installation,
   restart, cleanup, closure, or unresolved prerequisite.
