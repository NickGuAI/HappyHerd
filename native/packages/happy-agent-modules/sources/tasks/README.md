# Tasks

A bounded persistent todo list, kept per agent. It exists for the ordinary case of a model
breaking a piece of work into steps, tracking which are done, and picking the work back up after a
restart or a context reset — without the host having to build storage, paging, or dependency
bookkeeping itself. It is not the conversation and not a goal: a goal is the thing an agent is
pursuing, tasks are the checklist it keeps while pursuing it.

```ts
import { Agent } from "@slopus/happy-agent-base";
import { TasksModule } from "@slopus/happy-agent-modules";

const tasks = new TasksModule();
const agent = await Agent.create(ctx, { ...options, modules: [tasks] });
```

The module takes nothing. Its bounds are constants — `MAX_TASKS_PER_AGENT` (100) tasks per agent,
`MAX_TASKS` (500) in the stored shape, `MAX_TASK_PAGE_SIZE` (50) rows per page, and
`MAX_TASK_OUTPUT_CHARACTERS` (12,000) for anything a model reads — and the module reads the clock
and mints task and event identities itself. Anyone who wants to watch changes subscribes after
construction with `onEvent` or `onEventTransactional`.

One `TasksModule` instance serves every agent in a collection; each agent's list lives under its
module-owned table, so different agents never see each other's tasks.

## Tools it provides to the model

`tools()` returns six tools, in this order: `create_task`, `list_tasks`, `get_task`,
`update_task`, `complete_task`, `remove_task`. All six are `durable: true` and set
`shouldReviewInAutoMode: () => false` — a task list is the agent's own bookkeeping, not the host
machine, so nothing here needs Auto review.

- **`create_task`** — `{ title, detail?, activeForm?, owner?, metadata?, priority?, dependsOn? }`.
  Creates one task and returns `{ task }`. The stable tool-call ID becomes the task ID. The task
  write and durable tool result are committed by Agent Base in the same transaction; an existing
  task ID is always a conflict. Creation is refused past `MAX_TASKS_PER_AGENT`, for an
  unknown dependency, a self-dependency, or a dependency cycle. Validation failures are returned
  as a bounded `{ success: false, taskId, error }` result.
- **`list_tasks`** — `{ offset?, limit? }`, both optional and bounded by `MAX_TASK_PAGE_SIZE` (50),
  which is also the size of a page the caller does not size. Returns a `TaskPage`: `tasks`,
  `offset`, `limit`, `total`, and an optional `nextOffset` the model should follow until every task
  has been read. The compact rows in the returned page are trimmed further, at read time, so the
  rendered output never exceeds `MAX_TASK_OUTPUT_CHARACTERS` (12,000). They show only unresolved
  dependencies; the page is a genuine short read, not a promise that gets truncated after the
  fact.
- **`get_task`** — `{ id, detailOffset?, detailLimit?, dependencyOffset?, dependencyLimit? }`.
  Returns a `TaskDetailPage`: the full task (including `owner`, `activeForm`, `metadata`, and the
  reverse `blocks` links) plus bounded slices of its `detail` (up to 1,024 characters at once, out
  of a 4,000-character maximum) and its complete `dependsOn` list (up to 64 ids at once), each
  with its own `next*Offset` for continuing the read. An unknown id returns `{ task: null }` rather
  than an error, so a stale id used by the model gets a stable, quiet answer instead of a thrown
  exception.
- **`update_task`** — `{ id, title?, detail?, activeForm?, owner?, metadata?, priority?, status?,
dependsOn?, addBlocks?, addBlockedBy?, removeBlocks?, removeBlockedBy? }`, requiring at least
  one field beyond `id`. `null` clears `detail`, `activeForm`, or `owner`; metadata patches merge
  and delete individual keys whose value is `null`. Dependency updates keep `dependsOn` and
  `blocks` synchronized, while `add*`/`remove*` apply incremental links. Returns `{ task }` with
  the merged result; validation failures are normal `{ success: false, taskId, error }` results.
  Changing `status` to `"completed"` here produces the same `task_completed` event as
  `complete_task`; the legacy-compatible `"deleted"` status aliases `remove_task`.
- **`complete_task`** — `{ id }`. Marks the task completed and returns `{ task }`. Completing an
  already-completed task is a no-op that returns the same task rather than an error, so a repeated
  call is safe.
- **`remove_task`** — `{ id }`. Removes a task and unlinks it from every remaining task's
  `dependsOn` and `blocks` lists. An unknown id is returned as a normal typed failure.

Every tool's `toLLM` renders through the module's own formatting (`formatForModel`,
`formatPageForModel`, `formatDetailPageForModel`), so the text a model reads is exactly what the
structured result says and never exceeds `MAX_TASK_OUTPUT_CHARACTERS`. `list_tasks` and `get_task`
shrink their own page — fewer rows, a shorter detail slice, fewer dependency ids — until the
rendered text fits, always keeping at least one task or one character visible so a cursor never
repeats forever; if even that will not fit, they throw rather than quietly return truncated
garbage.

## External functions

All methods take `(ctx: Context, agentId: string, ...)` and operate on that one agent's list.

- `list(ctx, agentId) => Promise<readonly Task[]>` — every task, in display order.
- `listPage(ctx, agentId, query?) => Promise<TaskPage>` — the same bounded page `list_tasks` uses.
- `get(ctx, agentId, taskId) => Promise<Task | undefined>` — one task, or `undefined`.
- `getPage(ctx, agentId, taskId, query?) => Promise<TaskDetailPage>` — the same bounded lookup
  `get_task` uses.
- `create(ctx, agentId, input: TaskCreateInput) => Promise<Task>`
- `update(ctx, agentId, taskId, changes: TaskUpdateInput) => Promise<Task>`
- `complete(ctx, agentId, taskId) => Promise<Task>`
- `remove(ctx, agentId, taskId) => Promise<boolean>` — removes and unlinks a task, returns `false`
  for an unknown id, and compacts the remaining `ordering` values back to a contiguous range
  starting at zero.
- `reorder(ctx, agentId, taskIds) => Promise<readonly Task[]>` — not exposed as a tool. Sets an
  exact order; the given list must name every current task exactly once.
- `reset(ctx, agentId) => Promise<number>` — not exposed as a tool. Clears the whole list and
  returns how many tasks were removed.
- `onEvent(listener) => () => void`, `onEventTransactional(listener) => () => void` — subscribe to
  every change, after or inside its committing transaction. Each returns its own unsubscribe.
- `tools(ctx, scope) => readonly AnyAgentTool[]` — the six tools above, bound to
  `scope.agent.id`; this is what a host passes into `Agent.create`'s module wiring.
- `formatForModel`, `formatPageForModel`, `formatDetailPageForModel` — the bounded text renderers
  described above, usable directly by a host that wants the same summaries outside a tool call.

Every mutating call (`create`, `update`, `complete`, `remove`, `reorder`, `reset`) that actually
changes the list produces one `TaskEvent` — `task_created`, `task_updated`, `task_completed`,
`task_removed`, `tasks_reordered`, or `tasks_reset` — carrying a stable `eventId`, a timestamp, and
the `agentId`.

- `onEventTransactional(listener)` runs the subscriber inside the same transaction as the write, so
  its own writes commit with the change and a subscriber that throws rolls the mutation back.
- `onEvent(listener)` runs it once that transaction has actually committed. A failure there cannot
  undo the mutation and cannot starve the subscribers behind it; it is logged through `ctx.log.warn`
  and the mutation stays successful.

Both return the function that ends the subscription.

## Storage

The module owns its `happy_agent_task_state` table. Runtime operations use `ctx.db`, and direct
multi-step mutations use the nested-safe `ctx.inTx` boundary. No host store, transaction function,
or database client is injected.

- **Task list** — one bounded JSON row in `happy_agent_task_state`. The value
  is the complete `Task[]` for the agent, matching `taskListSchema` (at most `MAX_TASKS`, 500,
  items; `MAX_TASKS_PER_AGENT`, 100, is enforced on top of that). Every mutation
  reads and writes it inside the context transaction. Mutating tools declare
  `transactional: true`, so Agent Base commits the state and tool result together.

A stored `Task` is `{ id, title, detail?, activeForm?, owner?, metadata?, status, priority,
dependsOn, blocks, createdAt, updatedAt, ordering }`. Every write is re-validated against
`taskListSchema` plus these invariants: task ids are unique; `ordering` values are unique and
contiguous from zero; `blocks` is the exact reverse of `dependsOn`; the dependency graph has no
cycle and every dependency id refers to a task that exists and is not the task itself; `updatedAt`
is never before `createdAt`; and stored strings are exactly their trimmed, bounded form (`title` and
`activeForm` 1–500 characters, `owner` 1–256 characters, `detail` up to 4,000 characters, or
omitted rather than stored as an empty string). Metadata is bounded JSON (64 keys/items per level,
eight levels deep, and 16 KiB encoded). A stored value that fails any of these checks is treated as
corrupt and the read throws rather than silently returning invalid data.
