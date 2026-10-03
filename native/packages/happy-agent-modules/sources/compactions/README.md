# Compactions

Typed, durable history messages for every provider context-compaction attempt. One module instance
serves the full agent collection. The person-visible entity is a `service` message containing one
`compaction` block; the module's SQLite table is its private provider-attempt correlation index.

```text
manual API request ─┐
                    ├─ running message ── provider outcome ── completed / failed
automatic policy ──┘                             │
                                                └─ first later inference records tokensAfter
```

## Public surface

- `startManual(ctx, agentId)` creates the maintenance run and running history message before asking
  Agent Base to compact. A second running attempt throws `CompactionAlreadyRunningError`.
- `historyMessage(compaction)` produces the exact service message used by history, API responses,
  and realtime message events.
- `get(ctx, compactionId)`, `running(ctx, agentId)`, and `listPage(ctx, agentId, query)` inspect the
  private lifecycle index; they are not a second public protocol surface.

The module takes `EventsModule`, `UsageModule`, and `HistoryModule`. Automatic compaction joins the
exact active run. Manual compaction creates a maintenance run whose ID is the message ID. The
history write and raw `compaction.message-created` or `compaction.message-updated` journal event
commit together; the API converts those durable facts to ordinary `message.created` and
`message.updated` events.

## Lifecycle and recovery

Agent Base's stable compaction ID correlates the start, history replacement, and provider outcome.
Successful replacement updates the message inside the same transaction that replaces model
history. Failed and canceled outcomes update it to failed with a human-readable reason. The
agent-settlement transaction is a backstop for provider exceptions that never returned a typed
outcome.

Completed compactions retain `tokensAfter` as absent until the first later inference reports the
replacement context's exact input-plus-output size. An incompatible model reset clears that pending
association instead of attributing the new model's unrelated context.

At startup, every row left running by the previous process and its matching history message are
failed before the daemon becomes ready. A reconnecting client reads the same message from
`GET /v0/agents/:agentId/messages`; there is no compaction list endpoint and no text parsing.

## Storage

Migration `001-durable-compactions` creates `happy_agent_compactions`, a unique Base-attempt
correlation, an after-measurement marker, and a partial unique index allowing at most one running
compaction per agent. The canonical person-visible record remains the history message.
