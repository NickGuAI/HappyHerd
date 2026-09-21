---
name: happyherd-user-safeguard
description: Require one explicit Human approval before substantive complex, multi-step work that will create or materially modify a concrete artifact. Use only when HappyHerd marks a Human turn as safeguarded; do not use for automation turns, read-only investigation, ordinary Q&A or review, or small direct edits.
---

# HappyHerd User Safeguard

## Goal

Prevent substantive complex artifact work from starting before one explicit
Human approval while leaving routine work unblocked.

## Gate

Apply the gate only when both conditions hold:

- The task is complex, multi-step, extended, or requires meaningful judgment
  or coordination.
- The task will create or materially modify a concrete artifact such as code,
  a document, report, design, dataset, issue, pull request, deployment, or
  publication.

Before substantive execution, perform only the bounded read-only inspection
needed to interpret the task. Then restate the objective, scope, expected
artifact or artifacts, and any known external or irreversible effects, and ask
for one explicit Human approval. Do not treat the initial request alone as that
approval.

After approval, use the runtime goal mechanism to create a goal from the
approved instruction, then autonomously pursue it to verified completion. Do
not ask for routine intermediate approval. Pause again only if the work would
materially expand the approved scope or introduce a previously undisclosed
external or irreversible effect.

## Prompt assessment

When the existing Gate requires Human approval, you MUST first perform a brief prompt assessment. Ordinary Q&A, small edits, read-only tasks, and automation remain exempt; the existing approval boundaries are unchanged.

You MUST check the prompt and available context for material ambiguity, contradictory instructions, faulty assumptions, or missing information, and report only concrete concerns. Run bounded read-only verification first when needed. Never invent concerns.

At the very top of your approval-request reply (as the first non-whitespace character, before any scope restatement), output exactly one case-sensitive tag:

```xml
<happyherd-safeguard-reminder status="revise">
  <quote>Do both but only keep the second</quote>
  <suggestion>Clarify whether you want the first action performed.</suggestion>
</happyherd-safeguard-reminder>
```

Or, if no obvious issues:

```xml
<happyherd-safeguard-reminder status="ready">
  No obvious prompt issues found in the available context.
</happyherd-safeguard-reminder>
```

Rules for the tag:

- Use only the status attribute (`revise` or `ready`).
- For `revise`, provide one or more adjacent pairs of `<quote>` and `<suggestion>`. Do not use Markdown inside.
- For `ready`, provide a concise, non-empty, plain-text qualified assessment (not a guarantee).
- Keep tag structure literal. Escape `&`, `<`, and `>` inside text as `&amp;`, `&lt;`, and `&gt;`; `&quot;` and `&apos;` are also supported.
- Never fence the tag in actual replies, and avoid duplicate reminders.
- Still ask for required Human approval. `revise` does not authorize rewriting the prompt, and `ready` does not authorize execution.
- Do not repeat the reminder or request approval again just to acknowledge approval or continue materially unchanged approved work. Material scope changes follow the existing Gate.

## Boundaries

- Never apply or inherit this gate in a heartbeat, scheduled automation, or
  memory-maintenance automation.
- Read-only investigation never enters this gate, regardless of its complexity
  or whether its findings will be recorded in an artifact the Human already
  authorized, such as an existing tracking task or report. Proceed directly
  once the investigative scope and safety boundary are clear.
- Approval remains required before any separate mutation or external or
  irreversible effect that is not already explicit in the Human's request.
  The read-only exemption never authorizes code changes, production actions,
  or unrelated external writes.
- Exempt ordinary Q&A, ordinary review, and small direct edits.
- Preserve all standing safety and permission boundaries.
- Do not infer approval from silence or from an unrelated Human response.

## Acceptance

- A gated task performs no substantive artifact mutation before the compact
  scope-and-effects restatement receives explicit approval.
- An approved, materially unchanged task creates its runtime goal and proceeds
  to verified completion without routine repeat approvals.
- Exempt work proceeds normally without introducing an approval pause.
- Automation work never pauses because of this skill.

## Output

For a gated task that lacks approval, return the structured reminder first,
then the compact restatement and one direct approval question. For exempt or
already approved work, return the ordinary requested result or artifact.
