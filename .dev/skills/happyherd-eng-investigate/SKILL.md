---
name: happyherd-eng-investigate
description: "Investigate a HappyHerd engineering bug, UX problem, provider issue, or runtime behavior from current authoritative evidence and create or update one concise GitHub issue. Use when the requested outcome is investigation and tracking rather than implementation; route through the relevant HappyHerd skills and always run happyherd-eng-descope before persistence."
---

# HappyHerd Engineering Investigation

## Goal

Establish the current cause and smallest repair boundary for one HappyHerd
problem, then persist one evidence-backed, descoped GitHub issue when the
current instruction explicitly requests tracking.

## Honor the investigation boundary

Invoking this skill authorizes the read-only investigation. When the current
instruction explicitly requests tracking, that same instruction also authorizes
the scoped create or update and requires no second approval. Without that
explicit tracking request, remain read-only. Prefer the GitHub issue. If a new
issue is requested but the repository is ambiguous, ask only for that choice.

A supplied GitHub issue URL is the owning task only when the current
instruction explicitly requests a tracking mutation; otherwise it remains
read-only evidence. Never replace a supplied owner with a new issue. When
tracking is authorized and no issue was supplied, inspect open issues for a
match before creating exactly one issue. Never create a project board, label
set, sibling issue, or follow-up issue automatically.

TickTick and `workspace-manage-tasks` are optional and only when the user named
that tracker and it is available. Missing private config is not a stop and is
not missing approval.

When tracking is authorized, stop after the verified issue write; otherwise
stop after the read-only investigation report. Investigation and tracking never
authorize source changes or delivery. A later `stop` or `wait` instruction
halts the workflow immediately before further reads or writes. A later
`investigate only` instruction removes write authority unless that same latest
instruction explicitly retains the requested mutation.

## Establish current ground truth

Perform these ordered gates because each later result depends on the earlier
state:

1. When an issue is in scope, read it with `gh issue view` and capture the
   current baseline. Do not write yet. Skip this step when no issue was
   supplied. Never block on TickTick.
2. Establish repository ground truth before making source claims — branch,
   upstream sync, and working-tree status. Resolve the exact HappyHerd
   repository and checkout, compare it with current remote `main`, and inspect
   the authoritative head without switching or overwriting a dirty canonical
   checkout.
3. Read the closest repository guide and the relevant HappyHerd `.dev` entry
   points: `AGENTS.md`, routing, verification, and applicable SOP or playbook.
   If `.dev` is stale or incomplete, verify against current source and report
   the context gap; do not regenerate it inside this skill.
4. Use `systemops-establish-ground-truth --scope <resolved-happyherd-repository>` to establish
   the trigger, owning mechanism, impact, test or evidence gap, competing
   explanations, confidence, and unresolved gaps. Do not promote a hypothesis
   to root cause or let the investigation escape the resolved repository.

Select only the domain skills required by the evidence:

- Use `happyherd-develop-ux` for a Human-facing journey, interaction, layout,
  navigation, naming, discoverability, or responsive-surface problem.
- Add `marketing-review-ux` when screenshots, mocks, or reference interfaces
  materially define the question.
- Use `happyherd-update-provider` for provider, model, effort, permission,
  event, callback, resume, or restart behavior.
- Use `happyherd` for supported terminal, session, daemon, Commander,
  automation, or governed-tool operations.
- Read `.dev/VERIFY.md` directly to identify the smallest future verification
  evidence. Use `engineering-verify-change` only when the input includes already-existing
  code changes that need a read-only verification assessment; constrain it to
  check selection and documentation without running servers, writing evidence,
  or executing delivery.

Do not open a pull request or implement merely because an issue exists.

For Human-facing work, keep the Human UI journey distinct from the Main Agent
CLI journey. State the visible entry, real gesture, visible outcome, and
applicable retained state for every explicitly targeted surface. Source,
mocked callbacks, bundle strings, unit tests, builds, deployment health, and
route existence are supporting evidence; none proves the Human journey.

## Produce the smallest task

Synthesize:

- the directly observed problem and impact;
- the root cause, or named alternatives with confidence and the evidence still
  needed to distinguish them;
- the smallest repair boundary at the owning invariant;
- owner-visible acceptance; and
- verification evidence and gaps kept separate from product scope.

Lead the report with the immediate operator action when one exists. Do not turn
a narrow UX or runtime problem into a security program, redesign, provider
framework, compatibility layer, or general cleanup project without explicit
authority and current necessity evidence.

Run `engineering-review` once on the evidence-backed draft. Then invoke
`happyherd-eng-descope` in proposal-only mode as the mandatory final semantic
gate; this investigation owns any single persistence step. The descoped result,
not the earlier draft or review suggestions, is the only content eligible for
an authorized issue write.

## Persist through GitHub

When explicit tracking authority exists, write with `gh issue create` or
`gh issue comment` and read the result back. Without it, return the proposed
issue content and state that no tracker was mutated. Keep the issue concise.
When creating an issue, give it a short problem- or outcome-based title rather
than an implementation-method title. Missing TickTick is not a reason to skip
this GitHub write.

```markdown
## Outcome
<one coherent owner-visible end state>

## Investigation
<facts plus root cause, or named alternatives and confidence>

## Smallest repair boundary
<owning invariant, without an implementation diary>

## Acceptance
- [ ] <observable outcome>

## Gaps
<only material unknowns or unavailable evidence>

## References
<minimal source or evidence pointers>
```

Omit empty optional sections rather than writing placeholders.

When updating an existing issue, preserve unrelated manual text and replace
only a clearly owned prior investigation section; otherwise append the concise
section. Preserve its title unless the user explicitly requested a title
change. Leave the issue open.

If the write or read-back disagrees, report the raw discrepancy and do
not claim completion.

## Acceptance criteria

- The evidence comes from current authoritative `main`, relevant `.dev`
  guidance, owning source or runtime state, and applicable tests.
- The diagnosis distinguishes facts, cause or alternatives, impact, and gaps.
- Only evidence-relevant domain skills ran; their procedures were composed,
  not copied or replaced.
- `engineering-review` ran on the draft and `happyherd-eng-descope` produced
  the final issue content.
- With explicit tracking authority, exactly one existing or newly created
  GitHub issue contains the concise outcome, investigation, repair boundary,
  observable checklist, and gaps; without it, no issue is mutated.
- An authorized write is read back; a read-only run explicitly reports that
  no write occurred.
- The handoff accurately distinguishes completed investigation from completed
  task tracking and says that implementation has not started.

## Resources and boundaries

Never edit source or `.dev`, create or switch branches, commit, push, open a
pull request, implement, deploy, restart, merge, close, or complete work. Do
not dispatch implementation workers. Do not expose credentials, raw private
transcripts, or machine-owned runtime files in the issue.

If implementation is requested, return the verified issue when tracking was
authorized or the proposed issue content when it was not, then disclose the
separate implementation approval gate rather than crossing it.

## Output

Return:

1. **Immediate action** — only when the Human must do something now.
2. **Investigation** — problem, evidence, root cause or alternatives,
   confidence, smallest repair boundary, and material gaps.
3. **Skill routing** — only the domain skills actually used and why.
4. **Tracker receipt** — with tracking authority, the GitHub issue URL and
   read-back evidence; otherwise `No tracker mutated; no read-back performed.`
5. **Boundary** — use `Investigation and task tracking complete;
   implementation not started.` only after a verified write. Otherwise use
   `Investigation complete; tracker not mutated; implementation not started.`
