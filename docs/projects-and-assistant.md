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

* **Explicit Setup:** The application does not automatically create Super Sessions. Run:
  ```bash
  happyherd session create --machine ID_OR_HOST --path ABSOLUTE_PATH --provider codex --commander ID --super-session --json
  ```
* **ID Retention:** Repeated invocations are not idempotent and create new sessions. Run once, retain the returned session ID, and use the pinned row to reopen it. Terminal `happyherd resume <session-id>` starts a provider process locally and requires the original machine’s saved reconnect state; it is not a remote UI reopen. If multiple Super Sessions exist, the UI stable-selects the oldest creation time first, then by ID.

## Commander & Machine Management

List account machines with `happyherd machine list --json`. If account linking is missing, run `happyherd machine auth login`.

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
happyherd session create --machine ID_OR_HOST --path ABSOLUTE_PATH --provider codex --commander ID --json
```
* The `--path` directory must exist unless `--create-dir` is passed. Select optional `--model`, `--effort`, and `--permission` values from the target machine’s advertised catalog.
* **Delivery:** The CLI only creates the session. Deliver tasks using the existing session messaging interface; do not use non-existent flags like `--prompt` or `--task`.

For a linked Worker Agent with a durable child lifecycle, use `happyherd session side-chat create <parent-session-id>` with its six required brief fields as documented in the [side-chat lifecycle playbook](../.dev/playbooks/side-chat-lifecycle.md). That path inherits the parent context; the independent creation command above supports the selected Commander and workspace.

## COMMANDER.md Snippet

Append this configuration body to your existing `COMMANDER.md` to describe session orchestration without changing its identity or memory:

```markdown
### Assistant Orchestration Instructions

Act as a persistent HappyHerd assistant within the user’s requested outcome and authority:
1. **Registry Inspection:** Run `happyherd commander list` and inspect the definition files at the returned `commanderPath` values to select the appropriate role. Do not invent commander IDs or copy private memory.
2. **Delegation:** Spawn task-specific sessions using `happyherd session create` with the target machine, path, provider, and selected `--commander`. Leave `--super-session` off these independent sessions and retain each returned session ID. This command does not create parent/child lineage. Use the local registry on that machine to validate definitions. Do not directly mutate runtime credentials.
3. **Identity Preservation:** Retain the same persistent assistant session identity. Conduct all handoffs, status checks, and outcome verifications through the existing messaging interface. Keep the user informed with clear status receipts.
```
