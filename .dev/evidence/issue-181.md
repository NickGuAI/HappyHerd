# HappyHerd Issue 181 Evidence Note

## Root cause

The root cause was two separate same-session file workspace implementations: All Files used `DesktopFileWorkspace`, while chat links used `WorkspaceLinkSidePanel` and `WorkspaceLinkViewer`. The prior change shared only the resizable outer split, so tests passed while the duplicate Back / Back to files header and second feedback composer remained.

## Implemented contract

- **One current-session workspace:** Chat Workspace, embedded Machine Workspace,
  and current-session reply links share `DesktopFileWorkspace` state keyed by
  machine ID and absolute path.
- **Wide Web Desktop:** Tabs, both file pickers, and the draggable divider remain
  available while the Main Agent composer mount and draft persist.
- **390 × 844 Web Mobile:** The same state renders as the canonical compact
  full-screen workspace, including zero-tab Machine Workspace open/back,
  without desktop tabs or a divider.
- **Reply-link routing:** Current-session files and read failures remain in the
  canonical panel; directories open its embedded machine browser. Line and
  column metadata is retained for feedback. `WorkspaceLinkViewer` is limited
  to cross-session or unavailable-host fallback.
- **Shared file surface:** Session and machine transports both use
  `FileContentPanel` for Preview, Edit, and supported Delete actions.
- **Removed duplicate:** `WorkspaceLinkSidePanel` and its separate in-session header and composer were deleted.

## Active corrective follow-up contract

- The embedded Machine Workspace now fills the chat host while the standalone route keeps its fixed rail, with the desktop workspace divider reaching 75 percent workspace and 25 percent chat.
- Embedded Machine Workspace entry must bind to the active session machine and
  cwd, ignore a conflicting remembered path, work outside Git, preserve an
  explicit link target, and allow later Human navigation.
- Web Desktop retains visible session workspace controls. Web Mobile Main Agent
  and Side chat hosts use one visible bottom-left `+` menu for session actions,
  while microphone and Send remain direct and Send remains send-only.
- Real browser gestures must preserve the chat mount, draft, chat scroll, file
  editor mount, unsaved content, and editor scroll.

## Prior local evidence

- Focused workspace tests passed, including current-session link routing,
  machine/path deduplication, location replacement, and stale-probe rejection.
- Rendered browser tests passed for desktop Machine Workspace open/back/select,
  compact zero-tab open/back, tabs, preserved unsaved draft and scroll, and
  divider drag.
- App typecheck, UI/i18n checks, and the full 192-file, 1,775-test suite passed.
- The session-cwd and mobile `+` follow-up requires fresh production-host
  interaction evidence on its final commit; prior source, test, build, and
  deployment evidence cannot satisfy that Human gate.
