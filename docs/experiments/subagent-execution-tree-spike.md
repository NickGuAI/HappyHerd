# Sub-agent execution-tree spike

## Branch and merge boundary

- Branch: `feature/subagent-execution-tree-spike`
- Base: `main` at `dbf884d4d6ed4d14b18bc6a9917a15710eaad15f`
- This branch is an isolated dogfood environment. Do not merge it into `main`
  until the explicit decision gate below passes and Nick separately authorizes a
  merge.
- All spike implementation, fixtures, tests, acceptance evidence, and follow-up
  corrections stay on this branch.

## Deployment boundary

- `happyherd.gehirn.ai` may run an immutable image built from this branch.
- `baolab.gehirn.ai` remains on its last accepted `main` image and is not part
  of this experiment.
- Every branch deployment must retain the previous healthy image digest so it
  can be rolled back without changing ALB, DNS, data ownership, or daemon
  enrollment.

## Question being tested

Can HappyHerd derive one provider-neutral execution tree from the ownership
signals already emitted by the Claude and Codex mappers, and render that tree
through one generic panel, without importing Herd's provider runtime or adding
a second session, transport, resume, credential, approval, or persistence
system?

## Adapter boundary

- Positive adapter A: the dedicated Claude SessionEnvelope mapper.
- Positive adapter B: the dedicated Codex SessionEnvelope mapper.
- Negative control C: the shared ACP SessionManager. When it has no reliable
  child identity, its activity must remain in the main stream; the product must
  not infer ownership from tool names, prompts, timing, or visual proximity.
- Gemini, OpenClaw, Agy, and OpenCode sub-agent parity are not prerequisites for
  this spike.

## Acceptance gate

Continue only when all of the following are demonstrated on this branch:

1. Claude and Codex fixtures each model two concurrent child executions.
2. Every rendered activity has exactly one stable owner in live and replayed
   views.
3. Child activity cannot leak into the main-agent stream or a sibling panel.
4. A child failure or interruption shows its actual error inside that child's
   panel, while the main thread remains usable.
5. The ACP negative control creates no false child panel.
6. Desktop and mobile render the same execution tree through one generic UI
   component with no provider-specific React branch.

## Stop conditions

Stop and redesign the experiment if it requires prompt/tool-name inference,
provider lifecycle changes, a second reducer or replay store, a new database
relationship, or changes to credential/approval/session-resume ownership.

## Canonical review document

The code-grounded inventory, architecture, fixtures, and decision gate are in:

`/home/ec2-user/PKMS/insights/tasks/active/2026-08-02-happy-product-gaps/happyherd-subagent-adapter-validation-plan.html`
