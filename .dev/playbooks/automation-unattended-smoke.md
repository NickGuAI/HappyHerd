# Unattended automation smoke

Run the provider smoke whenever a Claude/Codex automation permission path,
provider launch, or terminal lifecycle changes. Run the separate exec smoke
whenever direct command validation, launch, or terminal history changes.

## Provider-agent contract

```text
Claude/Codex automation rail
  → explicit provider-native unattended permission mode
  → harmless shell tool call without a pending approval
  → provider-owned terminal outcome
  → next occurrence is no longer blocked
```

- Never restore a global bypass default; interactive sessions retain their
  normal provider configuration.
- Never infer completion or process death from elapsed time.
- An unexpected interactive callback must fail the one-shot automation without
  publishing a pending request.
- Recovery may signal only an exact daemon-tracked automation/run/session/PID.
  An untracked legacy row requires an explicit `ABANDON` confirmation and is
  closed as failed history without signalling any process.

## Deterministic check

From `server/`:

```bash
pnpm --filter happy exec vitest run --project unit \
  src/automations/unattendedPolicy.test.ts \
  src/automations/service.test.ts \
  src/claude/utils/permissionHandler.test.ts \
  src/claude/claudeRemoteLauncher.heartbeat.test.ts \
  src/codex/runCodex.automation.test.ts \
  src/daemon/run.automation.test.ts
```

The policy test enumerates the authoritative provider-agent rail schema. Adding
a provider rail without an explicit policy fails type-check or this test instead of
silently inheriting that provider's current default.

## Live headless check

Use a disposable paused definition on a daemon where the provider is already
authenticated. Replace `PROVIDER` with the new rail:

```bash
happy automation create --name "Unattended provider smoke" \
  --kind scheduled --instruction "Use the shell to run: printf happyherd-automation-smoke. Then finish." \
  --schedule "0 0 1 1 *" --timezone UTC --workspace "$PWD" \
  --rail PROVIDER --status paused --max-retries 0 --json
happy automation run-now AUTOMATION_ID --json
happy automation history AUTOMATION_ID --json
```

Pass only when the harmless command runs without a permission card and history
reaches `completed` or an evidence-backed provider failure. A `running` or
`started` row is not a pass. Delete the disposable definition only after its
run is terminal.

If a legacy row is confirmed orphaned, preserve its history and unblock future
occurrences explicitly:

```bash
happy automation abandon-run AUTOMATION_ID RUN_ID \
  --session SESSION_ID --confirm ABANDON --json
```

Use `--session none` only for a pre-registration `running` row. If the exact
run is still tracked, use `happy automation stop-run AUTOMATION_ID RUN_ID` and
wait for confirmed provider exit instead.

## Exec contract

```text
fixed absolute executable + exact argv
  → existing scheduler and overlap guard
  → direct daemon-user process with shell disabled
  → completed or failed history with no session ID
```

Run the wire, service, store, CLI, and app automation tests. They must prove
strict command validation, completed and failed `execution: "exec"` rows with
`sessionId: null`, no provider-session spawn, and list/detail/history readback.

For a live smoke, create a disposable paused definition that runs a harmless
absolute executable with explicit arguments, run it once, and read its history.
Pass only when the row is terminal, reports `execution: "exec"`, and has a null
session ID. Never pass a composed command string or rely on shell interpolation;
delete the disposable definition only after its run is terminal.
