# Super Session transport recovery

A provider process can remain alive after its connection to the HappyHerd
server fails. Process presence does not establish that it can receive input.
Super Sessions report connection health through their owning machine's daemon;
the conversation and session list use that report instead of a stale server
`active` flag. Missing machine/transport reports are shown as disconnected.

Open the existing conversation and use **Reconnect** when offered. The owning
daemon supplies its current server endpoint to the existing session process.
The process reconnects its socket and HTTP message transport, retaining its
HappyHerd session, encryption keys, provider-native thread, Commander,
workspace, provider authentication and message cursor. This action neither
launches nor stops a provider. Concurrent requests share one recovery attempt.

The interface shows reconnect progress, known DNS/HTTP/connection failures,
an obsolete endpoint, and a retry after failure. Success requires both a
connected socket and successful message catch-up. If the owning machine is
offline, reconnect it first. A process without transport reporting cannot be
recovered by this action; use an updated CLI for newly launched sessions. Do
not create another session to work around an unavailable report.

## Pending input

Messages saved to the server during the interruption replay automatically
after recovery. Do not resubmit them. The existing process continues from its
received sequence number, and HTTP catch-up and socket delivery share that
cursor so the same input is not admitted twice. Messages already admitted to
the provider remain in that process's queue. Outgoing messages retain their
idempotency identifiers across endpoint changes. This relies on the current
endpoint serving the same retained server account and conversation data.

An unsent composer draft is still a draft; this action does not submit it.
Process exit and ordinary provider resume remain separate operations with
their existing pending-message rules. Recovery does not assert exactly-once
provider execution across a process crash.

## Supported status and recovery interfaces

On the owning machine, `happyherd session inspect SESSION_ID --limit 20 --json`
includes `session.transport` for a Super Session, independently of
`providerRunning` and server `active`. The encrypted machine RPCs
`session-transport-status` and `recover-session-transport` accept only the
existing `sessionId`. The latter acknowledges progress; poll status to observe
completion or failure. Neither caller supplies an alternate server URL.

The daemon's loopback `/session-transport` exchange associates a report and
recovery acknowledgement with the currently tracked live PID. A replaced,
stopped or ambiguous owner cannot receive the old process's command. Status
receipts contain controlled error codes and sanitized endpoint labels, never
authentication values or arbitrary transport exception text.

## Verification

Focused CLI tests cover DNS, HTTP, connect closure, catch-up failure, retry,
timeouts, repeated gestures, owner replacement, stale replies and message
delivery races. App tests exercise the visible action at 1440 × 900 and
390 × 844. `scripts/issue-321-live-acceptance.mjs` is the disposable real
provider acceptance runner; its server, database, CLI home, daemon, proxies
and provider state are separate from the shared account and daemon. Live
results and their exact revision are recorded under `docs/acceptance/issue-321`.
