---
name: happyherd-google-workspace
description: Use Google Workspace through the gog CLI on this machine for Gmail, Calendar, Drive, Docs, Sheets, Slides and Contacts. Use when a task reads or changes mail, events, files, documents, spreadsheets, presentations or contacts.
---

# Google Workspace through gog

`happyherd setup google-workspace` installed this skill with `gog`. The sign-in
belongs to `gog` on this machine; HappyHerd stores no Google token.

## Before the first call

1. Run `happyherd integration check google-workspace --json`.
2. When `state` is not `ready`, stop and give the User the `nextSteps` from that
   output. The sign-in runs in the User's own terminal and browser, never in
   this conversation.
3. Add `--json --no-input` to every `gog` call, so the output parses and `gog`
   fails instead of waiting for input. With several Google accounts, add
   `--account EMAIL`.

## Read

| Need | Command |
|---|---|
| Search mail (Gmail query syntax) | `gog gmail search 'newer_than:7d is:unread' --max 20 --json --no-input` |
| Read a message or a thread | `gog gmail get MESSAGE_ID --json --no-input`, `gog gmail thread get THREAD_ID --json --no-input` |
| List events | `gog calendar events primary --from 2026-01-05 --to 2026-01-12 --json --no-input` |
| Find Drive files | `gog drive search 'quarterly plan' --max 20 --json --no-input` |
| Read a Doc as text | `gog docs cat DOC_ID --no-input` |
| Read a sheet range | `gog sheets get SHEET_ID 'Sheet1!A1:D20' --json --no-input` |
| Inspect a presentation | `gog slides info PRESENTATION_ID --json --no-input` |
| Find a contact | `gog contacts search 'name' --json --no-input` |

## Write

Show the User the exact change and get a clear yes before anything that other
people see or that is hard to undo: sending mail, inviting people, sharing,
deleting or overwriting.

| Need | Command |
|---|---|
| Send mail | `gog gmail send --to a@example.com --subject 'Subject' --body-file body.txt --json --no-input` |
| Create an event | `gog calendar create primary --summary 'Review' --from 2026-01-06T10:00:00-08:00 --to 2026-01-06T10:30:00-08:00 --json --no-input` |
| Append to a Doc | `gog docs write DOC_ID --append --markdown --file notes.md --no-input` |
| Update a sheet range | `gog sheets update SHEET_ID 'Sheet1!A2' --values-json '[["done"]]' --no-input` |
| Upload a file | `gog drive upload ./report.pdf --json --no-input` |

`gog COMMAND --help` lists every option. Never print stored tokens or the OAuth
client file.
