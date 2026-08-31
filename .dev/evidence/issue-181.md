# HappyHerd Issue 181 Evidence Note

## Root cause

The root cause was two separate same-session file workspace implementations: All Files used `DesktopFileWorkspace`, while chat links used `WorkspaceLinkSidePanel` and `WorkspaceLinkViewer`. The prior change shared only the resizable outer split, so tests passed while the duplicate Back / Back to files header and second feedback composer remained.

## Implemented contract

- **Sole same-session plain-file workspace:** `DesktopFileWorkspace` is the only same-session plain-file workspace. Chat file links and All Files converge on the same deduplicated state.
- **Wide Web Desktop:** Tabs, the file picker, and the draggable divider remain available while the Main Agent composer mount and draft persist.
- **390 × 844 Web Mobile:** The same state renders as the canonical compact full-screen workspace, without desktop tabs or a divider.
- **Historical baseline at `e1b1180a`:** Directory, cross-session,
  failed-resolution, and line/column links still use standalone
  `WorkspaceLinkViewer`. This was the limited scope of #181, not the enduring
  workspace contract.
- **Superseding target:** The owner-directed Chat Workspace/Machine Workspace
  consolidation routes every reply-file link, including line/column, through
  one canonical right-side tabs/viewer state; it must not retain a second
  standalone file viewer or feedback composer. See
  [`../playbooks/file-workspaces.md`](../playbooks/file-workspaces.md).
- **Removed duplicate:** `WorkspaceLinkSidePanel` and its separate in-session header and composer were deleted.

## Local evidence

- Focused SessionView and navigation tests: 43 passed, including sequential distinct links, out-of-order probe rejection, and session-change invalidation.
- Rendered Playwright interaction tests: 4 passed, including a default-off 1000 px Zen-mode link click, deduplication, divider drag, preserved Main Agent mount and draft, and direct compact mobile opening with the same mount and draft preserved.
- Full verification and deployed-domain proof remain release gates.
