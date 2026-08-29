# Side-chat delegation and lifecycle

Use a provider-native subagent by default for ephemeral, inline, bounded
fan-out. Use a HappyHerd side chat when a Worker Agent needs a durable, visible,
resumable child conversation with stable parent lineage. The Orchestrating
Agent explicitly creates each delegated task, owns its direct children, and
integrates their handoffs.

The Human creates a delegated Worker Agent from the app's New side chat form.
The Main Agent uses the CLI command below. Both collect the same six-field
brief and call the daemon-owned lifecycle. The app also discovers, renders,
switches, resumes, and closes exact-parent children. Generic
`spawn-happy-session` still rejects `isSideChat` before launch.

For Main Agent creation, run the HappyHerd command on the machine that owns the
parent session and supply every bounded brief field:

```bash
happyherd session side-chat create <parent-session-id> \
  --outcome '<target result and completion state>' \
  --scope '<in-scope work and explicit boundaries>' \
  --dependencies '<inputs and prerequisites, or none>' \
  --write-ownership '<exact files, paths, or resources the child may change>' \
  --verification '<required automated and manual proof>' \
  --handoff '<result, evidence, blockers, and remaining work to return>' \
  --json
```

The daemon forks the parent provider state, creates a child session on the same
machine and path, and persists the rendered brief as the child's first
encrypted queued user message. The Worker Agent executes that brief directly,
does not manage its own side-chat lifecycle, and does not create another side
chat unless the Human or Main Agent explicitly requests it. Provider-native
subagents remain the default bounded fan-out inside the child.

Use the same command surface for lifecycle operations:

```bash
happyherd session side-chat list <parent-session-id> --json
happyherd session side-chat status <child-session-id> --json
happyherd session side-chat inspect <child-session-id> --json
happyherd session side-chat stop <child-session-id> --json
happyherd session side-chat pause <child-session-id> --json
happyherd session side-chat reopen <child-session-id> --json
happyherd session side-chat resume <child-session-id> --json
happyherd session side-chat close <child-session-id> --json
happyherd session side-chat close <parent-session-id> --all --json
```

These actions reuse the owning daemon's normal local credentials; they do not
require account-machine linking or a QR flow. Every receipt has
`schemaVersion: 1`, `success`, and exact per-phase state. Creation includes a
`deliver-brief` phase. If delivery fails after the child is created, the failed
receipt retains the child and parent IDs so the Orchestrating Agent can inspect
or close the exact conversation.

`inspect`, `pause`, and `resume` are aliases for `status`, `stop`, and
`reopen`; lifecycle receipts keep the canonical action names.

Treat `success: false` and its nonzero process exit as an incomplete operation;
do not infer success from a provider process disappearing or from archived UI
state alone. Inspect the failed phase, then run `status` before retrying.

For restart recovery, restart only through the maintained daemon workflow, run
`list` again, and verify stopped and archived children are still present. A
successful `stop` reads back `providerRunning=false` and `active=false`. A
successful `close` additionally reads back `status=archived`. A successful
`reopen` returns the same child ID and parent ID with `providerRunning=true`,
`active=true`, and `status=running`.

`close --all` snapshots the durable direct children of the exact parent before
it acts, closes them sequentially, and reports every child. Retry only failed
children; successful closes are idempotent. The following `list --json`
receipt must report `openCount: 0`; archived children remain in `count` for
audit and future reopen. An Orchestrating Agent is accountable for its direct
children; nested providers remain inline activity, while an explicitly created
nested side chat retains its own exact parent lineage.
