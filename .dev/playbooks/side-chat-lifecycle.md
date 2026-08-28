# Side-chat lifecycle

Use the native CLI on the machine that owns the parent session. These actions
reuse its normal local daemon credentials; they do not require account-machine
linking or a QR flow.

```bash
happy session side-chat create <parent-session-id> --json
happy session side-chat list <parent-session-id> --json
happy session side-chat status <child-session-id> --json
happy session side-chat stop <child-session-id> --json
happy session side-chat reopen <child-session-id> --json
happy session side-chat close <child-session-id> --json
happy session side-chat close <parent-session-id> --all --json
```

Every receipt has `schemaVersion: 1`, `success`, and exact per-phase state.
Treat `success: false` and its nonzero process exit as an incomplete operation;
do not infer success from a provider process disappearing or from archived UI
state alone. Inspect the failed phase, then rerun `status` before retrying.

For restart recovery, restart only through the maintained daemon workflow, run
`list` again, and verify stopped and archived children are still present. A
successful `stop` reads back `providerRunning=false` and `active=false`. A
successful `close` additionally reads back `status=archived`. A successful
`reopen` returns the same child ID and parent ID with `providerRunning=true`,
`active=true`, and `status=running`.

`close --all` snapshots the durable children of the exact parent before it
acts, closes them sequentially, and reports every child. Retry only failed
children; successful closes are idempotent. The following `list --json`
receipt must report `openCount: 0`; archived children remain in `count` for
audit and future reopen.
