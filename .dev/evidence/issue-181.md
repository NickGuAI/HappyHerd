# HappyHerd Issue 181 Evidence Note

## Root cause

The root cause was two separate same-session file workspace implementations: All Files used `DesktopFileWorkspace`, while chat links used `WorkspaceLinkSidePanel` and `WorkspaceLinkViewer`. The prior change shared only the resizable outer split, so tests passed while the duplicate Back / Back to files header and second feedback composer remained.

## Implemented contract

- **Sole same-session plain-file workspace:** `DesktopFileWorkspace` is the only same-session plain-file workspace. Chat file links and All Files converge on the same deduplicated state.
- **Wide Web Desktop:** Tabs, the file picker, and the draggable divider remain available while the Main Agent composer mount and draft persist.
- **390 × 844 Web Mobile:** The same state renders as the canonical compact full-screen workspace, without desktop tabs or a divider.
- **Standalone route retention:** Directory, cross-session, failed-resolution, and line/column links continue to use the standalone `WorkspaceLinkViewer` route.
- **Removed duplicate:** `WorkspaceLinkSidePanel` and its separate in-session header and composer were deleted.

## Local evidence

- Focused SessionView and navigation tests: 43 passed, including sequential distinct links, out-of-order probe rejection, and session-change invalidation.
- Rendered Playwright interaction tests: 4 passed, including a default-off 1000 px Zen-mode link click, deduplication, divider drag, preserved Main Agent mount and draft, and direct compact mobile opening with the same mount and draft preserved.
- Full verification and deployed-domain proof remain release gates.
