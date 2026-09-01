---
name: happyherd-eng-investigate
description: "Investigate a HappyHerd engineering bug, UX problem, provider issue, or runtime behavior from current authoritative evidence and create or update one concise TickTick task. Use when the requested outcome is investigation and tracking rather than implementation; route through the relevant HappyHerd skills and always run happyherd-eng-descope before persistence."
---

# HappyHerd Engineering Investigation

## Goal

Establish the current cause and smallest repair boundary for one HappyHerd
problem, then persist one evidence-backed, descoped TickTick task when the
current instruction explicitly requests tracking.

## Honor the investigation boundary

Invoking this skill authorizes the read-only investigation. When the current
instruction explicitly requests TickTick tracking, that same instruction also
authorizes the scoped create or update and requires no second approval. Without
that explicit tracking request, remain read-only. If a new task is requested
but its existing TickTick project cannot be selected unambiguously, ask only
for that project choice.

A supplied TickTick URL is the owning task only when the current instruction
explicitly requests a tracking mutation; otherwise it remains read-only
evidence. Never replace a supplied owner with a new task. When tracking is
authorized and no task was supplied, use the `ticktick` skill to inspect the
selected project for a matching open task before creating exactly one task.
Never create a list, tag, sibling task, or follow-up task automatically.

When tracking is authorized, stop after the verified task write; otherwise stop
after the read-only investigation report. Investigation and tracking never
authorize source changes or delivery. A later `stop` or `wait` instruction
halts the workflow immediately before further reads or writes. A later
`investigate only` instruction removes TickTick write authority unless that
same latest instruction explicitly retains the requested mutation.

## Establish current ground truth

Perform these ordered gates because each later result depends on the earlier
state:

1. When a task or tracking project is in scope, use `ticktick` to resolve the
   supplied owner or establish the selected project and capture the current
   task baseline. Do not write yet.
2. Run `preflight` before making source claims. Resolve the exact HappyHerd
   repository and checkout, compare it with current remote `main`, and inspect
   the authoritative head without switching or overwriting a dirty canonical
   checkout.
3. Read the closest repository guide and the relevant HappyHerd `.dev` entry
   points: `AGENTS.md`, routing, verification, and applicable SOP or playbook.
   If `.dev` is stale or incomplete, verify against current source and report
   the context gap; do not regenerate it inside this skill.
4. Use `context-explore --scope <resolved-happyherd-repository>` to establish
   the trigger, owning mechanism, impact, test or evidence gap, competing
   explanations, confidence, and unresolved gaps. Do not promote a hypothesis
   to root cause or let the investigation escape the resolved repository.

Select only the domain skills required by the evidence:

- Use `happyherd-develop-ux` for a Human-facing journey, interaction, layout,
  navigation, naming, discoverability, or responsive-surface problem.
- Add `ux-designer-review` when screenshots, mocks, or reference interfaces
  materially define the question.
- Use `happyherd-update-provider` for provider, model, effort, permission,
  event, callback, resume, or restart behavior.
- Use `happyherd` for supported terminal, session, daemon, Commander,
  automation, or governed-tool operations.
- Read `.dev/VERIFY.md` directly to identify the smallest future verification
  evidence. Use `app-verification` only when the input includes already-existing
  code changes that need a read-only verification assessment; constrain it to
  check selection and documentation without running servers, writing evidence,
  or executing delivery.

Do not invoke a GitHub-issue or implementation workflow merely because one
exists. Preserve the requested TickTick-only tracking boundary.

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
an authorized TickTick write.

## Persist through TickTick

When explicit tracking authority exists, use the `ticktick` skill for the write
and authoritative read-back. Without it, return the proposed task content and
state that TickTick was not mutated. Keep the task concise. When creating a
task, give it a short problem- or outcome-based title rather than an
implementation-method title.

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

When updating an existing task, preserve unrelated manual text and replace
only a clearly owned prior investigation section; otherwise append the concise
section. Preserve its title unless the user explicitly requested a title
change. Leave the task open
and preserve its project, parent, priority, dates, timezone, tags, children,
and all other unmodified fields.

Read the result through the owning project and verify the exact task ID,
project, parent, title, content, status, checklist count, and preserved baseline
fields. If the write or read-back disagrees, report the raw discrepancy and do
not claim completion.

## Acceptance criteria

- The evidence comes from current authoritative `main`, relevant `.dev`
  guidance, owning source or runtime state, and applicable tests.
- The diagnosis distinguishes facts, cause or alternatives, impact, and gaps.
- Only evidence-relevant domain skills ran; their procedures were composed,
  not copied or replaced.
- `engineering-review` ran on the draft and `happyherd-eng-descope` produced
  the final task content.
- With explicit tracking authority, exactly one existing or newly created
  TickTick task contains the concise outcome, investigation, repair boundary,
  observable checklist, and gaps; without it, no task is mutated.
- An authorized write is read back and matches every changed field while
  preserving every field outside scope; a read-only run explicitly reports
  that no read-back occurred.
- The handoff accurately distinguishes completed investigation from completed
  task tracking and says that implementation has not started.

## Resources and boundaries

Never edit source or `.dev`, create or switch branches, commit, push, open a
pull request, implement, deploy, restart, merge, close, or complete work. Do
not dispatch implementation workers. Do not expose credentials, raw private
transcripts, or machine-owned runtime files in the task.

If implementation is requested, return the verified task when tracking was
authorized or the proposed task content when it was not, then disclose the
separate implementation approval gate rather than crossing it.

## Output

Return:

1. **Immediate action** — only when the Human must do something now.
2. **Investigation** — problem, evidence, root cause or alternatives,
   confidence, smallest repair boundary, and material gaps.
3. **Skill routing** — only the domain skills actually used and why.
4. **TickTick receipt** — with tracking authority, task/project/parent IDs,
   create or update result, checklist count, preserved fields, and read-back
   evidence; otherwise `TickTick not mutated; no read-back performed.`
5. **Boundary** — use `Investigation and task tracking complete;
   implementation not started.` only after a verified write. Otherwise use
   `Investigation complete; TickTick not mutated; implementation not started.`
