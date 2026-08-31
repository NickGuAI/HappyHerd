# File Workspace Consolidation

This playbook describes the single file-workspace architecture implemented in
`fa29c89e`.

## User-visible contract

```text
Chat Workspace: current Main Agent session cwd ─┐
Machine Workspace: connected-machine browser ───┼─► one right-side tab/viewer state
current-session reply file or directory link ───┘          │
                                                             ├─ Preview / Edit / Delete
                                                             └─ feedback → current Main Agent
```

Chat Workspace is the current session's file list. Machine Workspace is an
embedded version of the machine-wide browser and also remains a full
left-navigation destination. Files selected from either source open in the
same tabs. A current-session reply file, including one with line/column data,
opens there too; a directory opens the embedded Machine Workspace at that
path. Read failures render in the same panel. Only cross-session links or a
context that cannot host the current session workspace may use the standalone
`/workspace` viewer.

Tabs are unique by machine ID plus absolute path. Preview, Edit, supported
Delete, and feedback share the same file-content surface. Line and column are
carried into feedback; they do not currently scroll or highlight the preview.
Wide desktop keeps the draggable divider. Compact Web uses the responsive
full-screen workspace without desktop tabs or divider. The composer file and
branch shortcut is intentionally absent; file entry points live in the right
workspace controls and the left Machine Workspace navigation.

## Owners and reuse rules

| Responsibility | Owner | Rule |
|---|---|---|
| Admission and tab state | `sources/-session/SessionView.tsx`, `components/desktopFileWorkspaceModel.ts` | Send every supported current-session entry point into one state keyed by machine and path. |
| Chat file picker | `components/FilesSidebar.tsx` and `AllFilesPicker` | Label it Chat Workspace and open session-backed tabs; do not add another viewer. |
| Machine browser | `sources/app/(app)/workspace/index.tsx` and `MachineWorkspaceBrowser` | Reuse the exported browser in the right host and retain the full navigation route. |
| Split and tabs | `components/DesktopFileWorkspace.tsx` | Preserve one mounted chat and file host, deduplicated tabs, wide divider, and compact presentation. |
| File operations | `components/FileViewPanel.tsx`, `components/FileDocumentPreview.tsx`, `sync/ops.ts` | Route session and machine transports through shared `FileContentPanel`; add actions there rather than forking headers. |
| Feedback | `components/WorkspaceFeedbackComposer.tsx`, `sync/workspaceFeedback.ts` | Send machine, path, optional line/column, and the Human's message to the current Main Agent. |
| Fallback viewer | `components/WorkspaceLinkViewer.tsx` | Keep only for cross-session or unavailable-host routes. Never use it for a current-session read failure or directory. |

When changing this feature, update the app changelog and localized catalogs.
Regenerate the UI inventory whenever a route or UI-owning module changes.

## Interaction gate

Use the production hosts exercised by `SessionView.sideChat.test.ts`,
`desktopWorkspace.browser.test.ts`, and `sideChatHeader.browser.test.ts`.
At Web Desktop and 390 × 844 Web Mobile:

1. Open Chat Workspace and Machine Workspace, return from each picker, and
   select files from both.
2. Follow current-session file, directory, line/column, and failed-read links;
   verify cross-session fallback separately.
3. Reopen the same machine/path, switch and close tabs, use Preview/Edit/Delete
   where supported, and send feedback with the active location.
4. Drag the desktop divider. Verify the Main Agent chat, draft, scroll,
   unsaved edits, and mounted file panels remain intact. On compact Web, verify
   the full-screen open/back flow and absence of desktop tabs/divider.
5. Require one current-session viewer/composer and zero page or console errors.

Then run from `server/`:

```bash
pnpm --filter happy-app typecheck
pnpm --filter happy-app exec vitest run
pnpm --filter happy-app ui:inventory:generate
pnpm --filter happy-app i18n:check
```

Finish with a production web export and authenticated deployed-domain gestures
when a safe authentication harness is available.
