# File Workspace Consolidation

This playbook separates the verified `e1b1180a` baseline from the
owner-directed target. Do not turn the target into a claim about current code.

## Verified baseline

```text
same-session plain reply file + All Files → SessionView → DesktopFileWorkspace → FileViewPanel
line/column, directory, cross-session, failed reply link → /workspace → WorkspaceLinkViewer
Machine Workspace action → /workspace → machine browser → FileContentPanel
```

`SessionView.tsx` admits only a same-session file with no line/column to its
deduplicated `DesktopFileWorkspace` state. `DesktopFileWorkspace.tsx` owns the
right split, tabs, wide divider, and compact full-screen host. The standalone
`WorkspaceLinkViewer.tsx` has its own viewer and feedback composer, while
`app/(app)/workspace/index.tsx` separately owns machine selection, browsing,
and `FileContentPanel` through machine RPC. These separate paths are current
source facts, not a supported unified architecture.

## Required unified architecture

```text
Chat Workspace: current Main Agent session cwd ─┐
Machine Workspace: selected machine-wide browser ├─► one right-side tabs/viewer
reply file link, including line/column ──────────┘         │
                                                           ├─ Preview / Edit / Delete
                                                           └─ feedback → current Main Agent
Machine Workspace also remains a left-navigation destination.
```

When this target is implemented, one state owner must accept both workspace
sources and every reply-file location. Reuse one browser, one tab/viewer
surface, one file-operation surface, and one feedback path. Opening an already
open file focuses it; line/column focus survives routing. A failed resolution
may show an error in that owner, but must not reopen a standalone viewer or
create another composer. Wide desktop keeps the draggable divider; compact
mobile uses the responsive full-screen workspace without desktop tabs/divider.
Opening, closing, or resizing files must preserve the Main Agent chat, its
draft, and unsaved file edits.

| Responsibility | Current owner to inspect | Consolidation rule |
|---|---|---|
| Session cwd and reply-link admission | `sources/-session/SessionView.tsx`, `utils/markdownWorkspaceLink.ts` | Route every same-session reply file, including line/column, into the one right workspace. |
| Machine selection and browsing | `sources/app/(app)/workspace/index.tsx`, `utils/machineWorkspace.ts`, `sync/ops.ts` | Keep Machine Workspace's machine-wide browser and navigation entry, but feed its files into the same right workspace. |
| Split, tabs, responsive layout | `components/DesktopFileWorkspace.tsx`, `desktopFileWorkspaceModel.ts` | Retain one mounted right host, deduplicated tabs, wide divider, and compact mobile presentation. |
| File actions | `components/FileViewPanel.tsx` and its `FileContentPanel` export | Share Preview, Edit, and Delete semantics rather than fork headers or transports. |
| Feedback | `components/WorkspaceFeedbackComposer.tsx`, `sync/workspaceFeedback.ts` | Send one location-aware feedback message to the originating Main Agent session. |
| Legacy viewer | `components/WorkspaceLinkViewer.tsx` and `WorkspaceLinkViewerModel.ts` | Remove it from ordinary reply-link flow; do not retain a second same-file viewer/composer. |

## Interaction gate

Use the real hosts in `SessionView.sideChat.test.ts`,
`desktopWorkspace.browser.test.ts`, and `sideChatHeader.browser.test.ts`; add
Machine Workspace coverage in `app/(app)/workspace/index.tsx`'s owning tests.
At Web Desktop and 390 × 844 Web Mobile, exercise Chat Workspace, Machine
Workspace, and a reply link with a line/column. Verify one mounted viewer and
composer; path deduplication, tab switching, location focus, Preview/Edit/Delete,
feedback, divider drag, no layout overlap, and preservation of chat mount,
draft, scroll, machine identity, and unsaved edits. Require no page or console
errors. Then run:

```bash
cd server
pnpm --filter happy-app typecheck
pnpm --filter happy-app test --run
pnpm --filter happy-app ui:inventory:generate
pnpm --filter happy-app i18n:check
```
