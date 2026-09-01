# File Workspace Consolidation

This playbook describes the single file-workspace architecture implemented in
`fa29c89e`.

## User-visible contract

```text
Active session
├─ Chat Workspace: session file list
├─ Machine Workspace: session machine + cwd
└─ Explicit current-session file/directory link target (wins)
                         │
                         ▼
              one right-side tab/viewer state
                         ├─ Preview / Edit / Delete
                         └─ feedback → active session
```

Chat Workspace is the current session's file list. Machine Workspace is an
embedded version of the machine-wide browser and also remains a full
left-navigation destination. Files selected from either source open in the
same tabs. A current-session reply file, including one with line/column data,
opens there too; a directory opens the embedded Machine Workspace at that
path. Read failures render in the same panel. Only cross-session links or a
context that cannot host the current session workspace may use the standalone
`/workspace` viewer.

Opening embedded Machine Workspace from a Main Agent or active Side chat starts
at that exact session's machine and absolute current working directory,
regardless of whether the directory belongs to a Git repository. A valid
explicit file or directory link takes precedence over that default. Remembered
machine paths never replace the active session's initial location. After the
browser opens, Human navigation is preserved: changing machines or directories
does not snap back to the session cwd. The standalone `/workspace` destination,
which has no owning chat session, retains its normal machine and path selection
behavior.

Tabs are unique by machine ID plus absolute path. Preview, Edit, supported
Delete, and feedback share the same file-content surface. Line and column are
carried into feedback; they do not currently scroll or highlight the preview.
The embedded Machine Workspace fills the current chat workspace host; only the
standalone Machine Workspace route uses the fixed desktop browser rail. Wide
desktop keeps the draggable divider and allows the workspace to reach 75% of
the split while retaining 25% for the mounted chat. Compact Web uses the
responsive full-screen workspace without desktop tabs or divider. Changes,
Chat Workspace, and Machine Workspace must remain visibly labeled and directly
clickable. On Web Desktop and Web Mobile, the active Main Agent or Side chat
exposes session actions through the same visible bottom-left `+` menu alongside
the applicable permission, model, and effort settings, stop, queue, and one
Attachments action. Arbitrary-file upload remains in Machine Workspace.
Microphone and Send remain direct composer controls, and Send remains send-only. A reply link,
hidden route, or mounted component is not a substitute for a Human-facing entry
point.

## Owners and reuse rules

| Responsibility | Owner | Rule |
|---|---|---|
| Admission and tab state | `sources/-session/SessionView.tsx`, `components/desktopFileWorkspaceModel.ts` | Send every supported current-session entry point into one state keyed by machine and path. |
| Chat file picker | `components/FilesSidebar.tsx` and `AllFilesPicker` | Label it Chat Workspace and open session-backed tabs; do not add another viewer. |
| Machine browser | `sources/app/(app)/workspace/index.tsx` and `MachineWorkspaceBrowser` | Reuse the exported browser in the right host, bind embedded entry to the active session machine and cwd, preserve explicit link targets and subsequent Human navigation, and retain the full navigation route. |
| Split and tabs | `components/DesktopFileWorkspace.tsx` | Preserve one mounted chat and file host, deduplicated tabs, wide divider, and compact presentation. |
| File operations | `components/FileViewPanel.tsx`, `components/FileDocumentPreview.tsx`, `sync/ops.ts` | Route session and machine transports through shared `FileContentPanel`; add actions there rather than forking headers. |
| Feedback | `components/WorkspaceFeedbackComposer.tsx`, `sync/workspaceFeedback.ts` | Send machine, path, optional line/column, and the Human's message to the active Main Agent or Side chat. |
| Fallback viewer | `components/WorkspaceLinkViewer.tsx` | Keep only for cross-session or unavailable-host routes. Never use it for a current-session read failure or directory. |

When changing this feature, update the app changelog and localized catalogs.
Regenerate the UI inventory whenever a route or UI-owning module changes.

## Interaction gate

Use the production hosts exercised by `SessionView.sideChat.test.ts`,
`desktopWorkspace.browser.test.ts`, and `sideChatHeader.browser.test.ts`.
At Web Desktop and 390 × 844 Web Mobile:

1. From a Main Agent and an active Side chat, open Chat Workspace and Machine
   Workspace, return from each picker, and select files from both. Seed a
   conflicting remembered path and prove Machine Workspace first requests the
   active session's exact machine and cwd, including a cwd outside Git.
2. Follow current-session file, directory, line/column, and failed-read links;
   prove an explicit link target wins, and verify cross-session fallback
   separately.
3. Reopen the same machine/path, switch and close tabs, use Preview/Edit/Delete
   where supported, and browse away from the initial cwd without being snapped
   back. At a narrow workspace width, type and send multiline feedback with the
   active location; prove the text wraps inside the composer without covering
   the fixed Send control.
4. On Web Desktop and compact Web, test both Main Agent and Side chat hosts:
   visibly tap the bottom-left `+`, then visibly tap Changes, Chat Workspace,
   Machine Workspace, and Attachments in the menu. Verify the active-session
   target, direct microphone and Send controls, and send-only behavior. On
   desktop, drag the divider and prove the Main Agent chat, draft, scroll,
   unsaved edits, and mounted file panels remain intact at the 75% workspace /
   25% chat boundary. On compact Web, verify each full-screen open/back flow and
   the absence of desktop tabs and dividers.
5. Require one current-session viewer/composer and zero page or console errors.

Use the real production components in their real session hosts for this gate.
Mock only machine RPC and environment boundaries; a fake picker, direct prop
call, source assertion, or hidden link-only route does not prove the Human can
discover and complete the interaction.

Then run from `server/`:

```bash
pnpm --filter happy-app typecheck
pnpm --filter happy-app exec vitest run
pnpm --filter happy-app ui:inventory:generate
pnpm --filter happy-app i18n:check
```

Finish with a production web export and authenticated deployed-domain gestures
when a safe authentication harness is available.
