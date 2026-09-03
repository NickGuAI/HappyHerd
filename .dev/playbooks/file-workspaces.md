# File Workspace

This playbook describes HappyHerd's single Human-facing file workspace and the
rules for extending it without creating a second file surface.

## User-visible contract

```text
active Main Agent or active Side chat
              │ exact session + machine + cwd
              ▼
╔════════════════════════ Workspace ════════════════════════╗
║ full-machine browser → tabs → Preview / Edit ║
║          │                        / Delete   ║
║          └─ add existing file or directory by reference ─┼─► next message
║                                             feedback ─────┼─► exact chat
╚═══════════════════════════════════════════════════════════╝
```

There is exactly one Human-facing **Workspace**. Opening it from a Main Agent
or active Side chat starts at that exact chat's connected machine and absolute
current working directory, regardless of whether the directory belongs to a
Git repository. The Human may then change machines or browse anywhere on the
connected machine without the browser snapping back to the initial directory.
The standalone `/workspace` route has no owning chat and retains its ordinary
machine and path selection behavior.

The Human can add an existing file or directory from Workspace to the exact
chat's next-message context. This records a machine/path reference through the
existing session context store; it does not upload, copy, move, create a
session, or switch the active chat or workspace. Do not add a working-directory
access block, approval, guard, authorization layer, or other new security
mechanism to this path.

A current-session reply file opens in the same tabs, including an absolute path
outside the chat cwd. A reply directory opens Workspace at that path. Explicit
machine paths use machine file transport rather than the cwd-limited session
file transport. Read failures render in the same host. Only cross-session links
or a context that cannot host the current session Workspace may use the
standalone `WorkspaceLinkViewer` fallback.

Tabs remain unique by machine ID plus absolute path. Preview, Edit, supported
Delete, and feedback share the same file-content surface. Line and column are
carried into the reference and feedback; a rendered Markdown `requestedLine`
navigation is a mandatory shipped behavior that reveals the matching rendered
review unit (including the matching table row for a line inside a table), not a
mere scroll-or-highlight hint. Unsaved edits survive ordinary tab and layout
transitions. Wide Web Desktop retains one mounted chat and Workspace with a
draggable split up to 75% Workspace / 25% chat. Compact Web uses the
full-screen Workspace without desktop tabs or a divider.

On Web Desktop and Web Mobile, HTML has one supported Preview: it is the
automatic scriptless default and there is no separate Interactive toggle. A
line-linked Markdown deep link always opens as the rendered, commentable
Preview and reveals the requested rendered unit; it never switches to a raw
source surface. Raw text/code keeps the read-only Pierre renderer as its
Preview implementation, with arbitrary-line comment affordance; **Edit** is the
explicit writable raw editor. Native surfaces are unchanged. No approval
prompt, trust store, allowlist, new route, or second viewer exists.

On Web Desktop and Web Mobile, both Main Agent and active Side chat composers
expose **Changes**, **Workspace**, and **Attachments** through the shared `+`
menu. Microphone and Send remain direct controls, and Send remains send-only.
Workspace has no second header `+` for reopening an obsolete picker. A hidden
route, mounted component, source string, or reply link is not a substitute for
a visible, clickable Human entry.

## Owners and reuse rules

The chat file-surface instructions are part of this contract. Keep the live
`~/.happyherd/AGENTS.md` pointer and learning file byte-aligned with the
baked-in `deploy/happyherd-agent-runtime/happy-home/` copies. A change to
accepted or rejected Markdown forms updates both instruction surfaces in the
same delivery.

| Responsibility | Owner | Rule |
|---|---|---|
| Session targeting and tab admission | `sources/-session/SessionView.tsx`, `components/desktopFileWorkspaceModel.ts` | Route every current-session entry into one state keyed by machine and path, targeting the selected Main Agent or Side chat. |
| Human entry points | `components/AgentInput.tsx`, `components/FilesSidebar.tsx`, `components/SideChatPanel.tsx` | Expose one Workspace action through the shared composer menu and responsive right-side actions; do not fork entry handlers or labels. |
| Machine browser and chat context | `sources/app/(app)/workspace/index.tsx`, `MachineWorkspaceBrowser`, `sync/workspaceContext.ts` | Start embedded browsing at the exact chat machine/cwd, preserve subsequent Human navigation, and add existing file/directory references to that exact chat. |
| Workspace host | `components/DesktopFileWorkspace.tsx` | Own deduplicated tabs, the wide split, compact layout, and one mounted file host; do not add a second viewer or header `+`. |
| File content and transport | `components/FileViewPanel.tsx`, `components/FileDocumentPreview.tsx`, `sync/ops.ts` | Reuse `FileContentPanel` for Preview/Edit/supported Delete and machine transport, including absolute paths outside cwd without a HappyHerd access block. |
| Feedback | `components/WorkspaceFeedbackComposer.tsx`, `sync/workspaceFeedback.ts` | Send machine, path, optional line/column, and Human text to the active Main Agent or Side chat. |
| Current-session links | `utils/markdownWorkspaceLink.ts`, `sources/-session/SessionView.tsx` | Keep file, directory, position, and failed-read flows in the integrated Workspace. |
| Fallback viewer | `components/WorkspaceLinkViewer.tsx`, `components/MainView.tsx` | Use only for cross-session links or a context that cannot host the current session Workspace. |

When changing this feature, update the app changelog and localized catalogs.
Regenerate the UI inventory whenever a route or UI-owning module changes.

## Interaction gate

Exercise the production hosts through `desktopWorkspace.browser.test.ts` and
`sideChatHeader.browser.test.ts`, plus focused coverage in
`workspace/index.embedded.test.ts`, `AgentInput.dictationRender.test.ts`,
`DesktopFileWorkspace.test.ts`, `SessionView.sideChat.test.ts`, and
`SidebarNavigationButton.test.ts`. Mock only machine RPC and environment
boundaries; direct prop invocation or source/bundle inspection does not prove
Human interaction.

At Web Desktop and 390 × 844 Web Mobile, repeat the rendered gestures for a
Main Agent and an active Side chat:

1. Open the shared composer `+`, then visibly click Changes, Workspace, and
   Attachments. Prove Workspace is the only file-workspace label and opens at
   the selected chat's exact machine and cwd, including a cwd outside Git.
2. Add one existing file and one directory to that exact chat's next-message
   context. Browse to another machine or directory and prove the browser does
   not snap back or switch the active chat.
3. Follow current-session file, directory, line/column, and failed-read links.
   For an explicit absolute path outside cwd, prove machine read/write and
   existing supported Delete, with zero session-file calls and no workspace
   switch.
4. Reopen a duplicate machine/path, switch and close tabs, use
   Preview/Edit/supported Delete, verify that HTML stays in the scriptless
   Preview (no separate Interactive toggle) and that a line-linked Markdown
   deep link opens as rendered, commentable Preview while revealing the matching
   rendered unit (including the matching table row), send multiline location
   feedback, and retain the active draft, selected mode, DOM state, scroll,
   dirty edits, machine/session identity, and line/column metadata.
5. On Web Desktop, drag to the 75% Workspace / 25% chat boundary while keeping
   the chat mounted. On compact Web, prove the full-screen open/back flow and
   the absence of desktop tabs and divider. Require one viewer/composer and
   zero page or console errors for ordinary flows. Treat the default HTML
   Preview sandbox-block message as expected enforcement.

Then run from `server/`:

```bash
pnpm --filter happy-app typecheck
pnpm --filter happy-app test --run
pnpm --filter happy-app ui:inventory:generate
pnpm --filter happy-app i18n:check
APP_ENV=production pnpm --filter happy-app exec expo export \
  --platform web --output-dir dist-ci
```

Finish with authenticated deployed-domain gestures when a safe authentication
harness exists.
