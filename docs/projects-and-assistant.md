# HappyHerd Projects and Assistant Guide

This guide details managing encrypted projects, setting up Super Sessions, and configuring automated assistant orchestration via the HappyHerd CLI.

## Architectural Overview

Projects are account-level encrypted records independent of any machine or workspace. Assigning a project to a session does not move files or alter the session's Commander.

```text
Account
├─ Projects
│  └─ Named project ← assignments from sessions on any machine
└─ Session list
   ├─ Super Session (first) → persistent assistant Commander
   └─ Ordinary sessions   → selected Commander + workspace
```

## Projects & Pinned Super Sessions

The desktop UI features a Projects navigation tab with rename prompts, and SessionInfo includes a project selector with a "No Project" option. No deletion UI is provided.

A **Super Session** is an ordinary session marked with `isSuperSession` bound to a Commander. It is pinned at the top of the session list (first on desktop below the navigation bar, and first on mobile). Clicking the row opens the same existing session.

The daemon automatically configures a default HappyHerd Assistant Commander session using your existing machine login once authenticated and a supported persistent provider is ready. Existing custom Assistant definitions are preserved. Use `happyherd session ensure-assistant --json` to rerun this setup without re-authenticating. Avoid `--super-session` as manual creation remains non-idempotent. An existing marked local Assistant session is adopted when available. Otherwise, setup creates one account entry and retains its original session ID across restarts.

The server includes this reserved entry even after it falls outside the 150 most recently updated sessions. Another machine reuses the account entry without decrypting or starting its provider locally. If multiple manually marked Super Sessions already exist, the UI selects the oldest creation time first, then by ID.

## Commander & Machine Management

Local Assistant setup and delegation use the daemon’s existing machine login. List account machines with `happyherd machine list --json`; this separate remote-control path requires `happyherd machine auth login`. Account linking currently uses the native app’s QR scanner. Safari has no account-link approval interface; its Connect Terminal page handles a different protocol.

To list and register Commanders on the target machine's local registry:
```bash
# List local definitions
happyherd commander list

# Create from manifest
happyherd commander create --manifest /absolute/file.json
```
* **Manifest Fields:** `id`, `name`, `workspace`, `role`, and `commanderMarkdown`.
* **Alignment:** The markdown YAML `identity_and_scope` properties (`commander_id`, `name`, `workspace`, `role`) must match the manifest values exactly.
* **Schema Reference:** Refer to [commander.ts](../server/packages/happy-cli/src/commands/commander.ts) for the owning schema.

### Session Delegation

To create an independent session with a selected Commander and workspace, omit `--super-session`:
```bash
happyherd session create --local --path ABSOLUTE_PATH --provider codex --commander ID --json
```
* To target another machine, replace `--local` with `--machine ID_OR_HOST`; an account-control link is required.
* The `--path` directory must exist unless `--create-dir` is passed. Select optional `--model`, `--effort`, and `--permission` values from the target machine’s advertised catalog.
* **Delivery:** Creation alone sends no prompt. Send the instructions file with `happyherd session send SESSION_ID --text-file ABSOLUTE_FILE --message-id ID --json`; reuse the same message ID after an uncertain result. Verify recent responses with `happyherd session inspect SESSION_ID --limit 20 --json`. These commands target sessions stored by the local daemon.

For a linked Worker Agent with a durable child lifecycle, use `happyherd session side-chat create <parent-session-id>` with its six required brief fields as documented in the [side-chat lifecycle playbook](../.dev/playbooks/side-chat-lifecycle.md). That path inherits the parent context; the independent creation command above supports the selected Commander and workspace.

## COMMANDER.md Snippet

Append this configuration body to your existing `COMMANDER.md` to describe session orchestration without changing its identity or memory:

```markdown
### Assistant Orchestration Instructions

Act as a persistent HappyHerd assistant within the user’s requested outcome and authority:
1. **Registry Inspection:** Run `happyherd commander list` and inspect the definition files at the returned `commanderPath` values to select the appropriate role. Do not invent commander IDs or copy private memory.
2. **Delegation:** Spawn task-specific sessions using `happyherd session create` with `--local`, the path, provider, and selected `--commander`. For another machine, replace `--local` with `--machine ID_OR_HOST` using an existing account-control link. Leave `--super-session` off these independent sessions and retain each returned session ID. This command does not create parent/child lineage. Use the local registry on that machine to validate definitions. Do not directly mutate runtime credentials.
3. **Identity Preservation:** Retain the same persistent assistant session identity. Send task files using `happyherd session send SESSION_ID --text-file ABSOLUTE_FILE --message-id ID --json`, retain the message ID for retries, and verify responses using `happyherd session inspect SESSION_ID --limit 20 --json`. Keep the user informed with clear status receipts.
```
