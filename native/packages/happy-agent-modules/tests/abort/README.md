# Abort module tests

These tests prove that descendant discovery and abort scheduling share one transaction, nested
transactions compose, rollback releases no partial cancellation, and malformed ancestry is
refused atomically.
