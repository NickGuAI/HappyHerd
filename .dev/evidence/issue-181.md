# HappyHerd Issue 181 Evidence Note

## Root cause

`SessionView` only mounted `DesktopFileWorkspaceSplit` when `desktopFileWorkspace.paths` was nonempty. The same-session `WorkspaceLinkSidePanel` bypassed the split entirely and had a hard-coded width, meaning there was no divider or pointer handler on the production path. The first file open also changed the Main Agent's root host, which could remount the composer and lose an unsaved draft.

## Implemented contract

- **Split integration:** This is no longer an isolated component-only proof. The real `WorkspaceLinkSidePanel` now lives inside the existing split host on wide desktop, and that host is mounted before the first file opens.
- **State preservation:** The panel keeps the same Viewer instance when switching to 390 × 844 full-screen and keeps tabbed editors mounted while temporarily hidden.
- **File header modes:** User-facing modes on the file header are exactly **Preview** and **Edit**, with **Delete** kept separate on wide desktop.

## Local evidence

- **Verification summary:** The full App suite passed 192 files and 1,751 tests. Typecheck, i18n and UI-inventory checks, source lint, and the production Web export passed.
- **Side chat and drag behavior (`sideChatHeader.browser.test.ts`):**
  - Uses the real `SessionView`, the real `WorkspaceLinkSidePanel`, and a rendered same-session workspace link.
  - Types a Main Agent draft before the first open and proves the composer mount and draft survive the open.
  - Repeats first-open preservation at 1000 × 844, below the 1100 px file-sidebar breakpoint but inside the supported side-panel range.
  - Proves the pane grows by more than 100 px through a real `page.mouse` drag.
  - Verifies that the real side panel follows the split host width and that its Viewer mount and draft survive.
  - Confirms that at 390 × 844, the divider disappears and the workspace occupies the full host.
- **Workspace interaction (`desktopWorkspace.browser.test.ts`):**
  - Proves the plus picker, path deduplication, and tab switching.
  - Verifies that clicking X closes the view without invoking the delete transport.
  - Confirms that unsaved drafts and scroll positions are retained.

## Remaining release gate

- Merge
- Deployment
- Human-authenticated production gesture
