---
name: happyherd-develop-workspace
description: Implement, repair, or verify the one Human-facing HappyHerd Workspace — file browsing, selected-machine localhost live views, tabs, Preview/Edit/Delete viewer, comments, feedback, and chat context references — across Web Desktop, Web Mobile, and coupled entry points, transports, docs, catalogs, and interaction gates.
---

# HappyHerd Workspace Delivery

## Goal

The Workspace is exactly one Human-facing file surface, mounted beside the
active Main Agent or active Side chat, backed by machine RPCs and the existing
session context store. A Workspace change is delivered only when a Human can
discover the real entry point, operate the real production host on every
targeted surface, observe the truthful rendered surface, and retain the
required state — without creating a second workspace, viewer, route, state
owner, transport, or comment store.

Start at `.dev/AGENTS.md` and read only the routing, coupling, verification,
playbook, and live source that the change needs. `.dev/ROUTING.md` routes the
change; `.dev/COUPLINGS.md` lists state owners; `.dev/VERIFY.md` selects the
proof; `.dev/playbooks/file-workspaces.md` is the authoritative user-visible
contract and ownership table.

## Current shipped contract (baseline)

The contract below is the behavior the Workspace must keep truthful after any
change. When behavior changes, update both this skill and
`.dev/playbooks/file-workspaces.md` in the same delivery.

- **One Workspace per chat.** Opening it from a Main Agent or active Side chat
  starts at that exact chat's connected machine and absolute current working
  directory (Git or not). The Human may then browse anywhere on the machine
  without the browser snapping back to the initial directory. The standalone
  `/workspace` route has no owning chat and retains ordinary selection.
- **One file-content surface.** Tabs stay unique by machine ID plus absolute
  path. The viewer exposes one contextual **Preview** and, only when the file
  is writable, one **Edit**, with **Delete** only where already supported
  (Desk Workspace + capability gated). There is **no** Source mode and **no**
  separate HTML Interactive mode; HTML has exactly one safe scriptless
  Preview. Raw text/code keeps the read-only Pierre renderer as the Preview
  implementation (arbitrary-line comment affordance) and is never published as
  a mode. Images, PDFs, and other non-editable formats show only applicable
  controls.
- **Commentable rendered Preview.** Renderable Markdown opens as rendered,
  commentable Preview whether opened normally or with a line deep link. A
  `requestedLine` is navigation/comment context, never a mode selector: it
  stays rendered and reveals the matching rendered review unit — including the
  matching table row for a line inside a table (rows carry their own
  `data-source-line-start`/`end` range) — rather than switching to raw source
  or anchoring only the table start.
- **Comments and feedback.** Rendered Markdown units and raw Preview keep
  applicable line-comment affordances; multiple pinned comments retain correct
  source lines and send **once** through the existing `workspaceFeedback`
  batch to the exact current chat. No new comment store, RPC, transport path,
  or second batch is introduced.
- **Selected-machine localhost.** The embedded Workspace accepts only
  HTTP/HTTPS URLs with the exact loopback authority `localhost`, `127.0.0.1`,
  or `[::1]`. Tabs are keyed by machine plus canonical URL. The live iframe's
  page, scripts, styles, and fetch/XHR requests resolve through the selected
  daemon's encrypted machine RPC, never the Human browser's or central
  server's localhost. Element feedback contains bounded HTML, computed CSS,
  bounds, and a cropped PNG in the existing feedback batch. Local HTML file
  Preview remains scriptless.
- **Transport.** Current-session file/directory links open in the same tabs,
  including absolute paths outside the chat cwd; explicit machine paths use
  machine file transport (zero session-file calls) with no workspace switch.
  Only cross-session links or a context that cannot host the current session
  Workspace use the standalone `WorkspaceLinkViewer` fallback.
- **Layout.** Wide Web Desktop keeps one mounted chat and Workspace with a
  draggable split up to 75% Workspace / 25% chat and deduplicated tabs.
  Compact Web uses the full-screen Workspace without desktop tabs or a
  divider. Unsaved edits survive ordinary tab and layout transitions.
- **Human entry points.** Both Main Agent and active Side chat composers expose
  **Changes**, **Workspace**, and **Attachments** through the shared `+` menu;
  Microphone and Send stay direct and Send remains send-only. Workspace has no
  second header `+`. A hidden route, mounted component, source string, or reply
  link is not a substitute for a visible, clickable Human entry.
- **Mobile text floor.** On phone Web, every visible text-bearing element on
  the touched Workspace surfaces computes to at least 16px through the
  document-wide `MobileTypographyFloor` mechanism (including the Markdown
  preview override), while the existing input anti-zoom guard remains intact.
  No viewport zoom lock is added.
- **Native.** Native surfaces stay unchanged unless the task explicitly
  scopes them.

## Ownership map

Paths below are relative to `server/packages/happy-app/` unless they start
with `.dev/` or `docs/`.

### Routes and hosts

- `sources/app/(app)/workspace/index.tsx` — embedded/standalone Workspace
  route and `MachineWorkspaceBrowser` (full-machine browse).
- `sources/app/(app)/session/[id]/file.tsx` — compatibility route resolving
  path/line/column and delegating to `FileViewPanel`; never duplicate it.
- `sources/-session/SessionView.tsx` — one UI and transport state keyed by
  machine ID and absolute path; hosts the embedded Workspace and the mobile
  typography floor.
- `sources/components/DesktopFileWorkspace.tsx` — deduplicated tabs, wide
  split, compact host, and one mounted file host.
- `sources/components/LocalhostLiveView.web.tsx` — live selected-machine page,
  element picker, bounded context, and crop capture; native remains unchanged.
- `sources/components/desktopFileWorkspaceModel.ts` — tab admission state.
- `sources/components/MainView.tsx` — fallback viewer host (cross-session only).

### Viewer and review surface

- `sources/components/FileViewPanel.tsx` — `FileContentPanel`,
  `MachineFileViewPanel`, `FileViewPanel`; owns `FileDisplayMode`
  (`'preview' | 'edit'`), mode/review state, `requestedLine` default and raw
  scroll, rendered branches (Markdown/HTML/SVG/Canvas/raw Pierre), the header
  controls (`FileHeaderRight`), and the web Markdown preview styles.
- `sources/components/FileDocumentPreview.tsx` + `FileDocumentPreview.web.tsx`
  — HTML/PDF iframe preview and sandbox plumbing.
- `sources/components/CanvasFileViewer.tsx` + `CanvasFileViewer.web.tsx` —
  JSON Canvas read-only surface.
- `sources/components/InlineCommentReview.tsx` + `InlineCommentReview.web.tsx`
  — pinned comment review host.
- `sources/components/diff/PierreDiffView.tsx` — raw text/code read-only
  Preview renderer and arbitrary-line comments.
- `sources/components/markdown/MarkdownView.tsx` (native), `MarkdownView.web.tsx`,
  `MarkdownView.types.ts` — rendered Markdown with source-line metadata,
  `ReviewButton`, reviewable AST units (including table row source-line
  ranges), `requestedLine` rendered-unit reveal, and workspace links/images.

### Entry points and context

- `sources/components/AgentInput.tsx` — shared composer `+` menu (Changes /
  Workspace / Attachments) and the Workspace action.
- `sources/components/FilesSidebar.tsx` — side file surface entry.
- `sources/components/SideChatPanel.tsx` — side chat composer entry.
- `sources/components/WorkspaceLinkViewer.tsx` + `WorkspaceLinkViewerModel.ts`
  — fallback viewer (cross-session / non-hostable context only).
- `sources/components/WorkspaceFeedbackComposer.tsx` — multiline feedback
  composer.
- `sources/components/MachineWorkspaceContextPicker.tsx` +
  `CompactWorkspaceContextButton.tsx` + `WorkspaceContextStrip.tsx` — chat
  context reference surfaces.

### Sync, transport, and utilities

- `sources/sync/ops.ts` — machine/session read/write/delete transport.
- `sources/sync/workspaceContext.ts` — existing file/directory reference into
  the exact chat's next-message context.
- `sources/sync/workspaceFeedback.ts` — feedback batch into the exact chat.
- `sources/sync/workspaceLive.ts` + `public/workspace-live-sw.js` — registered
  live-iframe URL virtualization and encrypted selected-machine fetch bridge.
- `sources/utils/filePreview.ts` — file classification, editable-text
  decode/encode, and the scriptless safe HTML preview document.
- `sources/utils/markdownWorkspaceLink.ts` — file/directory/position link
  parsing and route resolution.
- `sources/utils/markdownWorkspaceImage.ts` — workspace image loading.

### Tests and fixtures

- `sources/components/desktopWorkspace.browser.test.ts` +
  `sources/components/__testdata__/desktopWorkspace.browser.fixture.tsx` —
  the real-host interaction suite and production fixture (mock only machine
  RPC and environment boundaries).
- `sources/components/DesktopFileWorkspace.test.ts`,
  `sources/components/desktopFileWorkspaceModel.test.ts`,
  `sources/components/FileViewPanel.native.test.ts`,
  `sources/components/FileDocumentPreview.web.test.ts`,
  `sources/components/CanvasFileViewer.web.test.ts`,
  `sources/components/WorkspaceLinkViewer.native.test.ts`,
  `sources/components/WorkspaceLinkViewerModel.test.ts`,
  `sources/components/WorkspaceFeedbackComposer.test.ts`,
  `sources/components/AgentInput.dictationRender.test.ts`,
  `sources/components/SidebarNavigationButton.test.ts`,
  `sources/sync/workspaceContext.test.ts`, `sources/sync/workspaceFeedback.test.ts`,
  `sources/sync/ops.workspaceUpload.test.ts`,
  `sources/utils/filePreview.test.ts`,
  `sources/utils/markdownWorkspaceLink.test.ts`,
  `sources/utils/markdownWorkspaceImage.test.ts`,
  `sources/components/markdown/MarkdownView.web.test.ts`,
  `sources/components/markdown/MarkdownView.browser.test.ts`,
  `sources/components/markdown/MarkdownView.workspaceLinks.test.ts`,
  and `sources/app/(app)/workspace/index.embedded.test.ts`.

### Docs, catalogs, and inventory

- `.dev/AGENTS.md`, `.dev/ROUTING.md`, `.dev/COUPLINGS.md`, `.dev/VERIFY.md`,
  `.dev/playbooks/file-workspaces.md`, .dev skill catalogs.
- `server/packages/happy-app/sources/text/locales/{en,cn,de}.json`,
  `sources/text/generated.ts`, `sources/text/ui-surface-inventory.json`,
  `sources/text/ui-tree.html`.
- `server/packages/happy-app/CHANGELOG.md` +
  `sources/changelog/changelog.json`.
- `docs/owned-patches.tsv` (only when the commit touches outside `.dev/`).

## Change procedure

1. Start at `.dev/AGENTS.md`; read `ROUTING.md`, `COUPLINGS.md`,
   `VERIFY.md`, and `.dev/playbooks/file-workspaces.md`; then inspect the
   owning source, current state owner, and coupled callers.
2. State the violated invariant, the smallest repair boundary, the affected
   surfaces, and the proof required before editing.
3. Change the owning mechanism at the earliest boundary that can prove it.
   Reuse the production component, host, comment mechanism, and batch sender.
   Do **not** create a second workspace, route, viewer, state owner, editor
   framework, persistence layer, or comment store. Transport additions require
   an explicit owning task and remain inside the existing machine RPC path.
4. Add or update the focused regression at the owning boundary (unit or
   real-host interaction), and update the production fixture when the real
   host contract changes.
5. Update only context made stale by the change:
   - `.dev/playbooks/file-workspaces.md` (contract and owners) and
     `.dev/COUPLINGS.md` / `.dev/VERIFY.md` when routing or verification
     guidance changes — always describe the behavior actually shipped.
   - For a user-visible change, `CHANGELOG.md` and the regenerated
     `sources/changelog/changelog.json`.
   - Locale keys in en/cn/de with `i18n:generate` and the regenerated
     UI inventory when a route or UI-owning module changes.
   - This skill (and any other skill whose guidance the change disproves).
   - `docs/owned-patches.tsv` for any commit touching outside `.dev/`.
6. Keep one owning TickTick task; write task state only through the
   `workspace-manage-tasks` surface and read every write back.

## Validation steps

### Focused evidence

- Unit/native: `FileViewPanel.native.test.ts`, `DesktopFileWorkspace.test.ts`,
  `desktopFileWorkspaceModel.test.ts`, `WorkspaceLinkViewer.native.test.ts`,
  `WorkspaceFeedbackComposer.test.ts`, `filePreview.test.ts`,
  `markdown/MarkdownView.web.test.ts`, `workspaceContext.test.ts`,
  `workspaceFeedback.test.ts`. Replace assertions that encode removed modes
  (Source / Interactive), whole-table anchoring, or sub-16px touched text.
- Real-host interaction: `desktopWorkspace.browser.test.ts` through the
  production fixture, and the coupled `sideChatHeader.browser.test.ts`.

### Production interaction gate

Exercise the real production component/host at Web Desktop `1440 × 900` and
Web Mobile `390 × 844` for a Main Agent and an active Side chat:

1. Open the shared composer `+` and visibly click Changes, Workspace, and
   Attachments; Workspace opens at the exact chat machine/cwd.
2. Add one existing file and one directory reference; browse elsewhere
   without snapping back or switching the active chat.
3. Follow current-session file/directory/line-column/failed-read links,
   including machine read/write and existing supported Delete outside cwd
   with zero session-file calls and no workspace switch.
4. Use Preview/Edit/supported Delete; prove HTML remains scriptless in its one
   Preview (no Interactive control); prove normal and line-linked Markdown
   both open rendered, reveal the matching rendered unit (including the
   matching table row), and that multiple pins comment the exact source lines
   and send once through `workspaceFeedback`.
5. Open a loopback URL on the exact selected machine, prove live script and
   fetch/XHR state, pick an element, and send one comment containing bounded
   HTML/CSS plus an element crop to the exact Main Agent or Side chat. Reject
   non-loopback input and prove the same URL on two machines is two identities.
6. Retain the active draft, selected mode, dirty edits, scroll, tab identity,
   and line/column metadata across tab switches; on wide Web Desktop drag to
   the 75/25 boundary with the chat mounted; on compact Web prove the
   full-screen open/back flow without desktop tabs or divider; require one
   viewer/composer and zero unexpected page/console errors (the default HTML
   sandbox-block message is expected enforcement).
7. On phone Web, prove the touched surfaces compute at least 16px while the
   input anti-zoom guard remains intact.

### App and repository gates

From `server/`:

```bash
pnpm --filter happy-app typecheck
pnpm --filter happy-app test --run
pnpm --filter happy-app ui:inventory:generate     # review the diff
pnpm --filter happy-app i18n:check
pnpm --filter happy-app exec tsx sources/scripts/parseChangelog.ts   # when user-visible
APP_ENV=production pnpm --filter happy-app exec expo export --platform web --output-dir dist-ci
grep -F '<title>HappyHerd</title>' packages/happy-app/dist-ci/index.html
pnpm --filter happy-app web:smoke
```

From the repository root:

```bash
git diff --check
node scripts/lint-source.mjs
bash scripts/verify-patch-discipline.sh   # from a clean committed tree; .dev-only commits stay exempt
node scripts/verify-public-boundary.mjs   # when touching outside .dev/
```

Validate every changed skill with the installed `skill-creator`
`quick_validate.py` (the same check `VERIFY.md` requires):

```bash
python3 <skill-creator>/scripts/quick_validate.py .dev/skills/<skill>
```

and resolve every relative Markdown link from its containing file.

## Guardrails

- Keep exactly one Human-facing Workspace and one file-content surface; never
  add a second viewer, header `+`, route, transport, or comment store.
- Keep `FileDisplayMode` at the truthful `'preview' | 'edit'` model (Delete is
  capability-gated, not a universal mode); a control's selected state must
  match the rendered surface.
- Keep the raw Pierre renderer internal to Preview — never publish it as a
  third Source mode.
- `requestedLine` is navigation/comment context, never a mode selector;
  rendered Markdown reveal must handle rows, not only the table start.
- Do not add a working-directory access block, approval, trust store,
  allowlist, or other new security mechanism to this path (security-feature
  gate applies if you ever do).
- Native surfaces stay unchanged unless explicitly scoped.
- Do not reopen already-delivered concerns (recent-path selection, Markdown
  table horizontal scrolling, suggestion chips, dark mode, Canvas,
  provenance, save/conflict, dirty-state retention, feedback batching) —
  keep them as focused regression checks only.
- Preserve the `MobileTypographyFloor` phone floor and the input anti-zoom
  guard; never add a viewport zoom lock.

## Done conditions

The change is done only when every targeted surface proves the visible entry,
real gesture, truthful rendered surface, comment delivery, and applicable
state retention on the final commit; the focused tests pass; the app/repository
gates pass; the docs, catalogs, changelog, inventory, and `.dev` guidance
describe the shipped behavior; and the owning task's acceptance checklist for
the Workspace is satisfied. Report `Unproved`/`Blocked` and the missing
prerequisite instead of closing on mock, source, test, build, or deployment
evidence alone.
