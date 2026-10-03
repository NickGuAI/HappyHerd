# Compaction module tests

These tests exercise the module through its public methods and Agent Base hook boundary over a real
in-memory SQLite database. They cover manual success and failure, automatic run attribution, exact
post-compaction measurement, event order, and restart reconciliation.
