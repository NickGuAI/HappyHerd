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

Can HappyHerd preserve provider-native child evidence and render one generic
panel per child by reusing the existing encrypted log, ownership tracer, and
tool reducer—while leaving creation, failure interpretation, and recovery with
the provider-native main agent and adding no second lifecycle system?

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
   panel, while the main thread remains usable and owns any recovery decision.
5. The ACP negative control creates no false child panel.
6. Desktop and mobile render the same execution tree through one generic UI
   component with no provider-specific React branch.
7. Only explicit raw root `turn/completed` releases a Codex root waiter;
   legacy lifecycle, child lifecycle, final-answer content, thread idle,
   ambiguous events, and elapsed duration cannot release it.
8. No panel, reducer, mapper, timer, scheduler, heartbeat, or harness-owned
   retry path can call back into provider child control.

## Stop conditions

Stop and redesign the experiment if it requires prompt/tool-name inference,
a second reducer or replay store, a new database relationship, child leases or
heartbeats, automatic retry, or changes to credential/approval/session-resume
ownership.

## LEAN candidate implementation

- Claude and Codex retain their native main/child control paths. Their mappers
  only mirror explicit child identity, activity, terminal status, and sanitized
  detail into `SessionEnvelope`.
- A child `start` envelope becomes one synthetic generic `Subagent` tool owner;
  tagged child text/reasoning/tools attach through the existing sidechain
  tracer; `stop` becomes that tool's terminal result.
- That generic `Subagent` tool is the canonical UI owner for its child ID.
  Later provider management calls such as `wait` may repeat the ID for
  correlation, but cannot steal the retained child stream and hide it inside
  a compact provider-tool row.
- `SubagentView` is the sole desktop/mobile renderer. It exposes retained
  output, nested tool activity, and provider outcome but has no retry action.
- Codex no longer has a duration timeout. Raw root `turn/completed` is the sole
  queue-release authority; explicit user Stop keeps the existing bounded
  interrupt/reconnect infrastructure path.
- No new service, database table, task model, scheduler, lease, heartbeat,
  provider feedback call, or provider-specific React state machine exists.

## Local evidence

- Focused reducer/tracer regression suites: 73 passing.
- Happy app typecheck: passing.
- Complete contract suite: passing, including 847 app tests plus wire,
  provider, CLI, server, lineage, isolation, artifact, and release contracts.
- Immutable image smoke: passing for implementation source
  `9eb584e9f08d554eec267d93dcce1ee7ad565a1f` and image digest
  `sha256:225d819560548e433fb024600363e73393c080a255db75b0dfd9f59e127e575a`.
- Live authenticated acceptance:
  `https://happyherd.gehirn.ai/session/cmsgmg0g80006qw01qegbcgli`.
  Two concurrent Codex children rendered as independent generic panels without
  opening `Worked`/`Used tools`; both completed, retained 4 and 5 events, showed
  their independent `HappyHerd` and `monorepo` results, and the main agent then
  combined them. Desktop and mobile collapsed/expanded views passed visual
  review with no failed, interrupted, duplicate, or ghost panel.
- The candidate is live-accepted on the experimental domain only. It remains
  unmerged until Nick explicitly authorizes the branch decision.

## Canonical review document

The code-grounded inventory, architecture, fixtures, and decision gate are in:

`/home/ec2-user/PKMS/insights/tasks/active/2026-08-02-happy-product-gaps/happyherd-subagent-adapter-validation-plan.html`
