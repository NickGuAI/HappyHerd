# Compaction persistence

`CompactionDatabase.ts` is the module's complete SQLite boundary. It owns the immutable migration,
the one-running-attempt invariant, stable insertion-order paging, Base-attempt correlation, and the
internal marker for the first post-compaction context measurement. No SQL for compactions lives
outside this directory.
