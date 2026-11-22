---
name: happyherd-github
description: Use GitHub through the gh CLI on this machine for repositories, issues, pull requests and checks, and keep tasks in GitHub issues when GitHub is the chosen task tracker. Use when a task reads or changes anything on GitHub.
---

# GitHub through gh

`happyherd setup github` installed this skill with `gh`. The sign-in belongs to
`gh` on this machine; HappyHerd stores no GitHub token.

## Before the first call

1. Run `happyherd integration check github --json`.
2. When `state` is not `ready`, stop and give the User the `nextSteps` from that
   output. The sign-in runs in the User's own terminal and browser, never in
   this conversation.
3. Name the repository with `--repo OWNER/REPO` unless the working directory is
   its checkout. Use `--json FIELDS` when you parse the output.

## Common work

| Need | Command |
|---|---|
| Read a repository | `gh repo view OWNER/REPO --json name,description,defaultBranchRef` |
| List open issues | `gh issue list --repo OWNER/REPO --state open --json number,title,labels` |
| Read an issue and its comments | `gh issue view NUMBER --repo OWNER/REPO --comments` |
| Create an issue | `gh issue create --repo OWNER/REPO --title 'Title' --body-file body.md` |
| Comment on an issue | `gh issue comment NUMBER --repo OWNER/REPO --body-file comment.md` |
| Close an issue | `gh issue close NUMBER --repo OWNER/REPO --comment 'Done in #123'` |
| Open a draft pull request | `gh pr create --repo OWNER/REPO --draft --title 'Title' --body-file body.md` |
| Check a pull request | `gh pr view NUMBER --repo OWNER/REPO --json state,mergeable,reviewDecision`, `gh pr checks NUMBER --repo OWNER/REPO` |
| Anything else | `gh api repos/OWNER/REPO/...` |

## GitHub as the task tracker

When `happyherd tracker show --json` returns `"tracker": "github"`, a task is an
issue and its state is open or closed. File each new task as an issue in the
project's repository, keep it current with comments, and close it when the work
is done. Pull requests still hold the changes; do not use one as a task.

## Care

Show the User the exact change and get a clear yes before merging, closing
another person's issue or pull request, deleting, or changing repository
settings. Never print a token: do not run `gh auth token` or
`gh auth status --show-token`.
