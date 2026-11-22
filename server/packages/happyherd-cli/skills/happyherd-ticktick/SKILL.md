---
name: happyherd-ticktick
description: Use TickTick through the ticktick CLI on this machine for lists, tasks and their state, and keep tasks there when TickTick is the chosen task tracker. Use when a task reads, files, updates or completes TickTick tasks.
---

# TickTick through the ticktick CLI

`happyherd setup ticktick` installed this skill with `ticktick`. The sign-in
belongs to `ticktick` on this machine; HappyHerd stores no TickTick token.

## Before the first call

1. Run `happyherd integration check ticktick --json`.
2. When `state` is not `ready`, stop and give the User the `nextSteps` from that
   output. The sign-in runs in the User's own terminal and browser, never in
   this conversation.
3. Do not run `ticktick auth status`: when signed in, it prints part of the
   access token. Add `--json` to every command that offers it.

TickTick calls a list a project. Find the IDs with `ticktick project list --json`.

| Need | Command |
|---|---|
| List the lists | `ticktick project list --json` |
| Read a list and its open tasks | `ticktick project data PROJECT_ID --json` |
| Search tasks | `ticktick task search 'keywords' --json` |
| Read one task | `ticktick task get PROJECT_ID TASK_ID --json` |
| Create a task | `ticktick task create --project PROJECT_ID --title 'Title' --content 'Details' --json` |
| Update a task | `ticktick task update TASK_ID --id TASK_ID --project PROJECT_ID --title 'New title' --json` |
| Complete a task | `ticktick task complete PROJECT_ID TASK_ID` |

## TickTick as the task tracker

When `happyherd tracker show --json` returns `"tracker": "ticktick"`, each
project keeps its tasks in one list, and a task is open or completed. File each
new task in the project's list, keep its content current, and complete it when
the work is done.

## Care

Show the User the exact change and get a clear yes before deleting a task or a
list, or moving tasks between lists. Never print the stored token or the CLI's
configuration file.
