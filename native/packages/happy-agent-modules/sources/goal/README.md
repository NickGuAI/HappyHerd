# Goal module

`GoalModule` stores one current goal per agent and keeps an active goal moving until it is
completed, blocked, paused, or cleared. One module instance serves the collection.

```ts
import { Agent } from "@slopus/happy-agent-base";
import { GoalModule } from "@slopus/happy-agent-modules";

const goal = new GoalModule();
const agent = await Agent.create(ctx, { ...options, modules: [goal] });
```

The constructor takes nothing. The clock and lifecycle identity are the module's own, and its one
model-facing bound is a fixed constant it exports so a caller can read it but not change it:

- `GOAL_OUTPUT_CHARACTERS` (12,000) — the character budget every goal tool result is trimmed to fit.

```text
goal mutation
    │
    ├─ durable goal state + event ──> commit
    │                                  └─ abort the owning agent (external mutations only)
    └─ active turn failure/abort ─────> paused goal
```

Every database operation uses the root or active transaction facade from `ctx.db`. Public
multi-write mutations compose through `ctx.inTx`, while transactional hooks reuse the transaction
Agent Base already opened. The module persists only current goal state, the active lifecycle, and
the current failed-turn count; it has no operation receipts, mutation proofs, fingerprints, or
call-scoped replay records.

The four model tools are durable and set `transactional: true`, so Agent Base owns the transaction
through execution, validation, rendering, and result completion. The module never calls
`AgentToolCall.commit`. `create_goal` uses the stable cuid2 `call.id` as the new goal lifecycle
identity.

## Who may manage a goal

Every method takes the agent whose goal it is, and that ID is the whole of the scoping: an agent's
goal is read, changed, and cleared only under its own ID. There is no primary-session policy and no
policy seam.

What the module does distinguish is where a mutation came from, which it reads from the context:
a mutation made from inside the owning agent is that agent acting on itself, and a mutation made
from anywhere else is external. An external activation enqueues a wake through the
`AgentSystemRef` captured in `beforeStart`, in the same mutation transaction, and therefore
requires that reference. An in-agent activation needs no wake, because the agent is already awake.

## Stopping work behind a goal

When someone outside the owning agent pauses, blocks, or clears its goal, the module aborts that
agent's active turn through `AgentSystemRef.abort`, after the transition commits. It never does
this for a mutation the agent made itself — that mutation is running inside the agent's own tool
call, and aborting there would cancel the very turn that asked. It also does not do it when a turn
failure, interruption, or agent archival parks a goal, because that work has already ended. A
failed abort is logged and cannot undo the committed transition.

## Events

Every mutation that actually changed something emits one `GoalEvent` (`goal_set`,
`goal_status_changed`, or `goal_cleared`) carrying the module's own event identity and timestamp,
deep-frozen before any subscriber sees it.

Subscribe after construction. `onEventTransactional(listener)` runs the listener inside the
committing transaction — throwing there rolls the mutation back — and `onEvent(listener)` runs it
after the outer transaction commits. Both return an unsubscribe function, and calling it more than
once does nothing further.

```ts
const unsubscribe = goal.onEvent((ctx, event) => {
    ctx.log.info({ type: event.type }, "a goal changed");
});
```

A post-commit listener that throws is logged through `ctx.log.error` and cannot roll the committed
change back or stop the remaining listeners.
