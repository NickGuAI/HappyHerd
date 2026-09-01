---
name: happyherd-eng-descope
description: "Reduce an over-detailed or over-designed HappyHerd engineering plan, checklist, or TickTick task to the smallest complete set of owner-required outcomes. Use when proposed scope contains unsolicited mechanisms, mock details, delivery bookkeeping, hardening, compatibility paths, or adjacent work, and before an investigation plan is persisted or approved for implementation."
---

# HappyHerd Engineering Descope

## Goal

Return the smallest complete HappyHerd engineering plan that preserves every
explicit owner outcome and indispensable acceptance condition.

## Establish scope authority

Treat the latest explicit owner instruction as authoritative when it corrects
older wording. Reconstruct the contract from:

- the original requested outcomes;
- explicit exclusions and negative constraints;
- named actors, product terms, and target surfaces; and
- later owner corrections.

Use a current project invariant or concrete reachable failure only to establish
indispensable acceptance. A mock, screenshot, reference product, example
project name or dimension, implementation note, visible UI detail, or standard
delivery step is evidence, not a requirement by itself.

If removing an item could discard an explicit outcome and the authority is
unavailable or contradictory, retain it as one material ambiguity rather than
guessing.

## Filter the candidate plan

Classify candidate items internally; do not reproduce a verbose classification
ledger in the final task.

| Class | Treatment |
|---|---|
| Owner outcome | Keep as product scope. |
| Indispensable observable acceptance | Keep as product acceptance. |
| Project-required verification or delivery | Keep in a compact supporting section, not as product scope. |
| Implementation hypothesis | Remove or defer unless necessity is proved. |
| Example or mock detail | Generalize only when the owner made it an invariant; otherwise remove. |
| Non-goal, generic hygiene, or adjacent work | Remove from the checklist; mention only when a material boundary would otherwise be lost. |

For any non-owner mechanism proposed for retention, require all three:

1. Name the explicit outcome, project invariant, or reachable current failure
   that requires it.
2. Cite evidence that the supported path needs it.
3. Establish why an existing nearby mechanism cannot satisfy the need.

Remove or defer the mechanism when any answer is missing. Apply this same
necessity test to security controls, approval flows, new storage, polling,
supervisors, fallbacks, compatibility paths, parallel implementations,
redesigns, and cleanup. Preserve concrete correctness, security, privacy, and
data-loss requirements without turning them into a separate program.

Preserve the product boundary:

- Do not project Main Agent CLI fields or protocols into Human UI.
- Do not infer parity across Desktop, Mobile, native, Human, and Main Agent
  surfaces unless the owner or current product contract requires it.
- Do not convert one example into a general standard.
- Do not substitute implementation steps, file paths, tests, builds, or release
  actions for owner-visible outcomes.

Write one checkbox for each distinct owner-visible outcome. Merge duplicate
wording, but never merge separate explicit asks merely to shorten the plan.
Count the actual Markdown `- [ ]` lines mechanically and report the result as
`Checklist count: N`; never estimate it from headings or prose.

## Update TickTick only when authorized

Use the `ticktick` skill for every task read or write.

A direct request to run this skill on one exact TickTick task authorizes only
the scoped content rewrite and authoritative read-back. A task that is merely
mentioned as context does not authorize mutation.

Before a write, capture the task ID, project, parent, title, content, status,
priority, dates, timezone, tags, and children. Change only the explicitly
scoped field, preserve unrelated manual content and every other field, and do
not modify child tasks. After the write, read the task through its owning
project and compare every changed and preserved field.

When no write is authorized, return the proposed replacement without mutating
TickTick.

## Acceptance criteria

- Every explicit outcome, exclusion, actor, term, surface, and later correction
  maps to the final plan or one material ambiguity.
- Every retained product checkbox is an owner outcome or indispensable
  observable acceptance condition.
- No unsupported mechanism, example detail, delivery step, or adjacent work
  remains disguised as product scope.
- Applicable verification or delivery gates remain available in a separate
  compact section without inflating the product checklist.
- The printed checklist count equals the actual number of `- [ ]` lines.
- An authorized TickTick mutation is verified against its pre-write baseline;
  otherwise no external state changes.

## Resources and boundaries

This skill compares an authoritative request with a candidate plan. It does not
perform a new root-cause investigation or invent missing evidence.

Remain read-only except for the one authorized TickTick content update. Never
create tasks, comments, branches, commits, pull requests, source changes,
deployments, restarts, or follow-up work. Never close or complete a task.

## Output

Return:

1. **Owner contract** — a concise statement of the outcomes and boundaries.
2. **Scope delta** — category counts plus grouped reasons for only the material
   removals or deferrals; do not emit an item-by-item ledger. Include
   **Material ambiguity** only when needed.
3. **Final task plan** — outcome, observable checklist, and an optional compact
   supporting-verification section.
4. **Checklist count** — the mechanically verified total.
5. **TickTick receipt** — when mutated, the exact task/project/parent, changed
   field, preserved baseline fields, and read-back result.
