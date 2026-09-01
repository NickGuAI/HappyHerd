---
name: happyherd
description: "Use when operating HappyHerd from a terminal: launch or resume sessions, inspect the daemon, manage Commanders or machine-local automations, handle auth/connect, use the sandbox, manage notifications, and run diagnostics. Not for editing source or retired Herd commands."
---

# HappyHerd CLI

## Goal

Operate the supported HappyHerd command surface, coordinate bounded delegated
delivery, and verify the requested result through the state owner that
performed it.

## Command surface

HappyHerd is operated through exactly one installed public command:
`happyherd`. It owns local sessions, session resume, the background daemon,
Commanders, machine-local automations, authentication/connect, sandbox,
notifications, system diagnostics, and provider launch.

When `PATH` is unavailable, invoke the same command surface using its
maintained source entrypoint from the HappyHerd repository root:

```bash
node server/packages/happy-cli/bin/happy.mjs <command>
```

Always query command options using top-level or category-specific help:

```bash
happyherd --help
happyherd automation --help
happyherd commander --help
happyherd daemon --help
happyherd session side-chat --help
```

Do not probe `happyherd acp`, `happyherd agy`, or `happyherd gemini` with
`--help`. These routes can launch real HappyHerd sessions. Use top-level
`happyherd --help` instead.

### Command map

```text
happyherd <command>
├── Sessions      · launch (default, codex, acp, agy, grok), resume, nested side-chat lifecycle
├── Daemon        · start, stop, status, list
├── Commanders    · list, create --manifest <absolute-file>
├── Automations   · list, create, update, pause, resume, run-now, history, delete
├── Auth/Connect  · auth, connect, accounts
└── Diagnostics   · sandbox, notify, doctor
```

The automation owner requires an explicit name, kind, instruction, schedule,
timezone, workspace, and execution rail when creating a definition. Inspect
`happyherd automation --help` for the current flags and allowed values, then
read the result back:

```bash
happyherd automation list --json
happyherd automation history <automation-id> --json
```

## Coordinate delegated delivery

Use this protocol only when the user puts a TickTick task in scope for
multi-agent delivery:

1. The parent session remains the orchestrator and integration owner. Read the
   exact task and its current comments once, define acceptance, then split only
   independent lanes with non-overlapping file or artifact ownership.
2. Use the provider's native subagent mechanism for parallel lanes that can
   finish inside the current conversation: Codex collaboration agents or
   Claude Agent/Task. Give each lane one bounded objective, acceptance check,
   allowlist, and stop condition.
3. For a durable nested child of the current parent, use
   `happyherd session side-chat create`. For an intentionally independent
   top-level conversation, use `happyherd` or `happyherd codex` for a new
   launch, or `happyherd resume <happy-session-id>` for an existing session.
   Do not call it a HappyHerd worker until its actual session ID or application
   link is available; record that identity in the handoff.
4. Use the `ticktick` Skill to add one concise dispatch comment and one final
   handoff comment per lane, then read each comment back. Comments are receipts,
   not a queue: do not poll them, automate them, or create a second registry.
5. The parent joins the delegated work, reviews the resulting artifacts,
   integrates them, and runs final verification. A worker does not merge,
   complete the owning task, or make the final architecture decision.

`New side chat` in the HappyHerd application and the CLI route
`happyherd session side-chat` are both actual nested side-chat surfaces. A
plain new launch or resume remains a separate top-level session. Create a CLI
nested side chat with `happyherd session side-chat create <parent-session-id>`
plus all six required flags: `--outcome`, `--scope`, `--dependencies`,
`--write-ownership`, `--verification`, and `--handoff` (optionally `--json`).
Lifecycle commands include list, status, stop, close, and reopen; inspect
`happyherd session side-chat --help` for their exact current forms.

If the supported HappyHerd launch or resume surface is unavailable, the one
fallback is a provider-native subagent. State that fallback and the unavailable
surface in the TickTick handoff. Do not use `happy-agent`, start an untracked
top-level provider process, or fabricate a session, ID, or link.

## Boundaries

- Retired `herd`, `HERD_*`, and `~/.herd` commands and paths are not aliases or
  fallbacks.
- Runtime databases, scheduler/session-control state, credentials, logs, and
  raw transcripts are machine-owned. Use the application or maintained CLI;
  never treat those files as a writable API.
- Never print, copy, or pass credentials in prompts, URLs, command arguments,
  AgentContext, or task artifacts.
- Provider launch and resume commands create or reconnect real sessions.
  `doctor clean`, logout, daemon stop, and automation deletion are mutating or
  destructive operations and require authority for the exact target.
- Process presence and runtime-file presence do not prove user-visible session
  state. Use the HappyHerd application or the daemon command surface for live
  state.

## Acceptance and output

The operation is complete only when all applicable conditions hold:

- The command ran through the `happyherd` surface, with no retired command or
  path.
- A mutation was read back through the same owner; automation reads include the
  exact ID, status, workspace, and instruction boundary, while Commander reads
  confirm the exact Commander identity.
- Unrelated sessions, Commanders, and automations were not changed.
- No secret or raw runtime data appears in terminal output or artifacts.
- Failures report the command surface, exit status, and raw actionable error;
  a successful exit without authoritative read-back is not reported as done.
- For delegated delivery, every lane has one owner and non-overlapping scope,
  every claimed HappyHerd worker has an actual session ID or application link,
  and every dispatch or handoff comment was read back from TickTick.
- The parent reviewed and integrated delegated artifacts and ran the final
  checks before reporting the owning task ready for completion.

Return a concise result with `Command surface`, `Target`, `Result`, and
`Read-back evidence`. For coordinated delivery, also include `Lanes`,
`Sessions`, and `Handoffs`. A read-only request produces no mutation.
