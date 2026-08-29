# HappyHerd launcher

`happyherd` is a thin alias for the bundled upstream Happy CLI. Every
invocation is forwarded once with the same arguments, environment, exit status,
and signal behavior.

```text
happyherd
happyherd server
happyherd daemon start
happyherd daemon status
happyherd codex
happyherd machine list --json
```

Create a durable Worker Agent conversation by supplying a bounded delegation
brief through the same command surface. The Main Agent must supply all six
non-empty fields:

```text
happyherd session side-chat create <parent-session-id> \
  --outcome <text> \
  --scope <text> \
  --dependencies <text> \
  --write-ownership <text> \
  --verification <text> \
  --handoff <text> \
  --json
```

Provider-native subagents remain the default ephemeral inline fan-out. A
HappyHerd side chat is a separate durable, visible, resumable child conversation
with stable parent lineage. Its Orchestrating Agent owns lifecycle and reviews
the Worker Agent's result, verification, blockers, and remaining work. Use
`list`, `status`/`inspect`, `stop`/`pause`, `close`, and `reopen`/`resume` beneath
`happyherd session side-chat` to manage exact children.

The Human uses the app's New side chat action with one click and no fields. The
app sends only `parentSessionId` through the dedicated
`happyherd-side-chat-create` machine RPC, creates an empty durable child,
focuses and opens it, and exposes the normal composer. Human creation records
`deliver-brief` as skipped. The Main Agent CLI enters the same daemon lifecycle
through authenticated loopback, validates all six fields above, and delivers
the brief as the child's first encrypted queued message. A delivery failure
retains `parentSessionId`, `sessionId`, and the failed `deliver-brief` phase.
Generic session spawn rejects `isSideChat`, so neither surface bypasses the
dedicated lifecycle.

The package carries the ordinary Happy runtime. The user-owned installer places
the existing self-host server package beside it, so an installation can use
either a local server or an explicitly selected remote server through normal
Happy settings. It does not add an
issuer, broker, credential vault, verified Skill registry, tool runner, release
attestation, or separate daemon lifecycle.
