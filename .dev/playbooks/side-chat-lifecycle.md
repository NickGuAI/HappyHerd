# Side-chat delegation and lifecycle

Use a provider-native subagent by default for ephemeral, inline, bounded
fan-out. Use a HappyHerd side chat when a Worker Agent needs a durable, visible,
resumable child conversation with stable parent lineage. The Orchestrating
Agent explicitly creates each delegated task, owns its direct children, and
integrates their handoffs.

The Human creates a side chat from the app's New side chat action with one
click and no fields. The app sends only `parentSessionId` through the dedicated
`happyherd-side-chat-create` machine RPC, creates an empty durable child,
focuses and opens it, and exposes its normal composer. The Main Agent uses the
CLI command below and supplies the complete six-field brief. Both enter the
same daemon-owned lifecycle. The app also discovers, renders, switches,
resumes, and closes exact-parent children. Generic `spawn-happy-session` still
rejects `isSideChat` before launch.

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
  --model '<provider model>' \
  --effort '<provider effort>' \
  --json
```

The daemon creates a same-provider child on the same machine and path. Claude
and Codex retain their provider-native forks. Gemini, Grok, DSH, and Agy start
a fresh provider process and receive only the latest four visible parent
messages, capped at 6,000 characters, in the existing encrypted queued brief.
Tools, thinking, attachments, malformed records, and previous continuation
handoffs are excluded. Context-read and settings failures happen before spawn.
Human creation omits the brief, records
`deliver-brief` as skipped, and leaves the child empty for the Human's first
message through the normal composer. Main Agent creation validates all six
non-empty fields and persists the rendered brief as the child's first encrypted
queued user message. The Worker Agent executes that brief directly, does not
manage its own side-chat lifecycle, and does not create another side chat
unless the Human or Main Agent explicitly requests it. Provider-native
subagents remain the default bounded fan-out inside the child.

`--model` and `--effort` are optional. When either is present, the owning
daemon validates the selection against the parent provider's current machine
catalog before it forks or starts the child. Invalid or unavailable selections
fail without spawning. A successful create means the normal machine-session
launch contract read back the exact effective settings. Omitting both options
keeps the existing side-chat defaults. Human one-click creation still sends
only the parent session ID.

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
require account-machine linking or a QR flow. Create receipts have
`schemaVersion: 2`, preserving every existing lifecycle field while adding a
`resource` object sampled once by the owning daemon at creation. It captures
CPU busy percentage over a 250 ms window, 1/5/15-minute load averages, memory
used/total/available bytes, swap used bytes, and a `sampledAt` ISO timestamp.
Unavailable metrics are `null`, and the overall resource status is `ok`,
`partial`, or `failed`; collection never changes an otherwise successful
create. No background monitor, poller, telemetry service, or extra daemon
process is introduced. Other lifecycle receipts remain `schemaVersion: 1`.
Creation includes a `deliver-brief` phase.
It is `skipped` for Human one-click creation. If CLI
brief delivery fails after the child is created, the failed receipt retains
`parentSessionId`, `sessionId`, and the failed `deliver-brief` phase so the
Orchestrating Agent can inspect or close the exact conversation.

`inspect`, `pause`, and `resume` are aliases for `status`, `stop`, and
`reopen`; lifecycle receipts keep the canonical action names. Claude, Codex,
and Grok retain provider-native resume. Gemini, DSH, and Agy reopen the same
Happy session with a fresh same-provider process seeded from bounded visible
child context; do not describe that behavior as native provider resume. The
dedicated Gemini side-chat path does not re-enable ordinary Gemini launch UI.

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
