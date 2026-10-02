# Codex JSONL Unicode framing (#373)

Codex app-server stdout carries one JSON value per LF-delimited record. Literal
U+2028 and U+2029 are legal JSON string content; they must not delimit records.
The previous Node `readline` boundary split them into invalid fragments on the
installed Node 26.6.0 runtime (Node 20.19.0 preserves these characters). A pending `thread/fork` reply was consequently
logged as non-JSON and never resolved. The same boundary serves live events.

The client now decodes stdout as UTF-8 and frames only at LF. It accumulates
chunk fragments without repeatedly rescanning an entire unfinished record.
CRLF remains accepted as JSON trailing whitespace; bare CR is not a boundary.
The existing `handleLine` owns blank/malformed-line handling and JSON-RPC/event
dispatch. EOF delivers a final unterminated record once. Process exit still
retires interactive questions immediately, but unresolved RPC rejection waits
for stdio close so buffered replies can drain. Stream errors log and reject
pending RPCs; intentional disconnect discards unfinished data and detaches the
reader. Generation checks prevent old streams from entering a new connection.
No timeout, notification mapping, fork configuration, or lineage policy changed.

## Deterministic acceptance

`codexAppServerClient.test.ts` drives actual readable stdout streams into the
production client, including a pending `forkThread` operation, live tool events,
UTF-8 byte boundaries, several records per chunk, CRLF, EOF, malformed records,
stream failure, and shutdown. These are provider-shaped fixtures, not claims of
live provider execution. Existing machine fork and side-chat lifecycle suites
cover the downstream path/home and parent-child metadata owners.

## Real journey boundary

Read-only inspection on October 1, 2026 found Codex 0.154.0 and an existing
shared HappyHerd 1.2.4 daemon. Both supported side-chat creation and app Fork use
the daemon's already-loaded `ApiMachineClient`/`CodexAppServerClient`; children
also launch from that daemon's installation. Running a freshly built CLI in the
worktree still calls that same daemon. It does not test the new transport there.

No independently provisioned authenticated test daemon was available. The task
explicitly prohibits deployment and shared-service restart or account mutation.
Therefore actual patched-daemon side-chat/Fork success and authenticated app
rendering remain **unproved**. No existing user session was forked, no private
transcript was copied, and no provider reply was fabricated as real evidence.

After authorized activation in a suitable environment, create a controlled
Codex parent, send a harmless tool instruction that emits literal U+2028 and
U+2029, and verify the output in the session. Create a side chat through the
supported lifecycle and a Fork through the app. Read back distinct child/native
thread identities, original working directory and provider home, correct parent
lineage, and a successful next turn in each child. Retain the actual receipts
separately from these deterministic tests.

## Claude sibling investigation

`claude/utils/claudeSessionFork.ts` also uses `readline` in
`forkAndTruncateSession`. On affected Node runtimes it can split a native JSONL
record before parsing/copying it; whole-session `forkSession` copies bytes and
avoids this framing boundary. This is a separate persisted-transcript rewrite
path with different marker/truncation semantics, not a Codex stdout consumer.
It remains unchanged under #373's explicitly narrow transport scope. The
`claudeLocal` readline channel carries fetch instrumentation rather than the
conversation-copy path. The sibling risk is recorded rather than silently
expanding the patch.
