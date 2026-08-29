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
brief through the same command surface:

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

The app discovers, renders, switches, resumes, and closes existing side chats;
it cannot create an unbriefed Worker Agent. Generic session spawn rejects
`isSideChat`, so creation always crosses the brief-validating daemon lifecycle.

The package carries the ordinary Happy runtime. The user-owned installer places
the existing self-host server package beside it, so an installation can use
either a local server or an explicitly selected remote server through normal
Happy settings. It does not add an
issuer, broker, credential vault, verified Skill registry, tool runner, release
attestation, or separate daemon lifecycle.
