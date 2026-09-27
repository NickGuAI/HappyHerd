# Upstream UI parity record

HappyHerd's interface now departs from the one it inherits from upstream Happy
(`slopus/happy`). This record lists every inherited screen, component and style
the overhaul replaces or modifies, the HappyHerd file that now owns the
behavior, what stayed compatible, and how to carry a future upstream change into
the new design. Follow it during every upstream merge (see the
`happyherd-sync-upstream` skill); update it in the same pull request as any UI
change that touches an inherited file.

- **Upstream base for this record:** `4b7d763ee3afda04985f3210b9cb9acf9359c7d9`
  (the most recent upstream commit merged into `main` when the overhaul began).
- **Path mapping:** upstream `packages/happy-app/sources/<path>` is HappyHerd
  `server/packages/happyherd-app/sources/<path>`.
- **Check provenance of a file** (prints `upstream` when the path exists
  upstream):

  ```bash
  U=4b7d763ee3afda04985f3210b9cb9acf9359c7d9
  f='components/SidebarView.tsx'
  git cat-file -e "$U:packages/happy-app/sources/$f" 2>/dev/null && echo upstream || echo happyherd
  ```

## Merge procedure for inherited UI files

1. For each upstream commit that touches a file listed below, read its row
   first. The row says whether the file is **Replaced** (HappyHerd renders its
   own component; the upstream file is no longer on the user's path),
   **Restyled** (same structure and behavior, HappyHerd styles), or
   **Extended** (upstream structure kept, HappyHerd adds elements or props).
2. **Behavior first, styling second.** Accept upstream logic, data flow, props,
   accessibility and bug fixes. Re-apply the HappyHerd visual treatment named in
   the row instead of taking upstream styling. Never reintroduce hard-coded
   radii, colors or durations that the overhaul replaced with tokens.
3. For **Replaced** files, port the upstream behavior change into the named
   HappyHerd owner, then keep the upstream file compiling (it may still be
   imported elsewhere) or delete its unused parts only in a dedicated commit.
4. Keep HappyHerd-only files (listed under *HappyHerd-owned modules*) out of
   upstream conflict resolution; upstream never edits them.
5. After resolving, run the checks in `.dev/VERIFY.md` for the touched surfaces
   and refresh the KILV goldens when rendering changes.

## Shared foundation

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/theme.ts` | Restyled | `borderRadius` scale is now `sm 6, md 8, lg 10, xl 12, xxl 14` (was 4/4/4/6/6); `kilv.radius` 8 and `kilv.radiusCard` 12; new `kilv.radiusSheet`, `kilv.radiusPill`, and for phone surfaces `kilv.radiusBottomSheet` (22, bottom sheets' top corners) and `kilv.radiusFab` (18, the floating New session button); motion scale `kilv.motionFast/Base/Slow` and `kilv.easeOut/InOut/In`; new `colors.selection { border, background, ring }`. | Every existing token name and color value; `kilv.motion` (150 ms) still exists for current callers. | Take new upstream tokens by name. If upstream changes a radius or motion value, keep HappyHerd's value; if upstream adds a new semantic color, add it to both KILV palettes. Regenerate `theme.light.json` and `theme.dark.json` with `pnpm exec tsx sources/theme.gen.ts`. |
| `sources/theme.css` | Extended | Adds the fluid-motion layer: `herd-*` keyframes and classes, stagger steps `herd-d1`…`herd-d10`, `herd-transition`, `herd-glide`, `herd-exit-left`, the overlay exits `herd-pop-out` / `herd-sheet-out` / `herd-sheet-down` / `herd-fade-out` (each also stops pointer input), the hover reveals `herd-shell-reveal` / `herd-row-reveal` with their hosts `herd-shell` / `herd-row` (hidden on touch-only screens, where row text is also not selectable so a long press can open the row's actions), and a reduced-motion block that disables all of them. | All existing global rules (scrollbars, Pierre diff reset, session-title shimmer, focus rings, 16 px phone inputs). | Keep the `herd-*` block together and after upstream rules; merge upstream global rules above it. `components/herd/motion.test.ts` fails if a class used in code is missing here. |

## Desktop shell

The desktop layout is now a HappyHerd top bar above the permanent drawer.
Upstream's absolute `PersistentHeader` overlay (Zen, Back, Forward) and the
boundary collapse toggle no longer exist; their behavior lives in
`components/herd/shell/`.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/components/SidebarNavigator.tsx` | Replaced (layout) | Renders `HerdTopBar` above a body that holds the `Drawer` and `HerdSidebarEdgeToggle`. The drawer width follows `useHerdSidebarTransition` (content slides out, then the width snaps). The body overrides `SafeAreaInsetsContext` with `top: 0` because the top bar consumes the top inset. `PersistentHeader` and `DesktopNavigationBoundaryToggle` were deleted. | Drawer options (`permanent` on desktop, hidden `front` drawer on phones), `lazy: false`, the 250–360 px width rule, the rule that drawer width is never animated, the Zen and collapse semantics, and the element order, so the navigator never remounts when the layout changes. | Port upstream header controls (Zen, Back, Forward, anything new) into `herd/shell/HerdTopBar.tsx`, not back into this file. Take upstream drawer-option changes here. If upstream animates the drawer width, do not take it; see the comment above `drawerNavigationOptions`. |
| `sources/components/SidebarView.tsx` | Restyled | The top padding that reserved the old header strip is gone. Tokens replace hard-coded radii and colours. Destinations show an active state for the current route (`usePathname`). New session uses the `emphasis` button and Settings the `quiet` one. Border on the right edge only. | Both rows: icon-only Workspace (behind `machineWorkspace`), Projects, Automations; then New session with its `N` hint and the archive toggle. Also `VoiceAssistantStatusBar`, `MainView variant="sidebar"`, and Settings with its `,` hint. | Take upstream structure and behavior. Keep the two rows and the token styles. A new destination gets `active={pathname.startsWith(...)}`. |
| `sources/components/FlatSessionRow.tsx` | Restyled + Extended | Inset rounded rows (`marginHorizontal` 8, `kilv.radius`), transparent on web with a hover tint. Adds an agent chip (`herd/shell/sessionRowPresentation.ts`), a status line while a session waits on the user (it takes the worktree line when that line is empty), `HerdRowMoreButton` (⋯), `HerdRowSelection` (gliding selection ring) and an `entranceIndex` stagger for the first 12 rows. On touch-only web (`hover: none`), a long press opens the actions (`useHerdRowLongPress`), because iOS Safari sends no context menu; the row cancels that touch's release so the browser does not click the new sheet's backdrop. Removed `showBorder` (no dividers). Titles are 16 px; timestamps and daemon identity use mono. | Every data line (title, project, daemon label and short id, worktree, git counts), the unread-ring grace period, the faded offline state, shortcut badges, right-click and `SessionActionsPopover` on web, long press, and swipe-to-archive on native (native rows stay opaque for the swipe). | Merge upstream row logic and data fields normally. Keep new visual elements inside the existing lines, and keep the row background transparent on web, or the glide cannot pass behind neighbouring rows. |
| `sources/components/ActiveSessionsGroupCompact.tsx` (`CompactSessionRow`) | Extended (web) | Rounded inset rows with a hover tint, `HerdRowSelection` and `HerdRowMoreButton`. On web, dividers and the selected fill give way to the shared selection ring. The touch-only long press matches `FlatSessionRow`. | Native rendering, swipe, long press, right-click, the identity line and git counts. | Same rule as `FlatSessionRow`. |
| `sources/components/SessionsList.tsx` | Restyled | Mono uppercase group and archive headers aligned with the inset rows. Passes `entranceIndex`; no longer passes `showBorder`. | Data building, grouping modes, archive toggle, search and virtualization settings. | Take upstream list logic and re-apply the header style. |
| `sources/components/SessionActionsPopover.tsx` | Restyled (web) + Extended (phone web) | `kilv.radiusCard` card with the `herd-pop` entrance and 40 px rounded rows that tint on hover, with no dividers on web. Under 700 px it is a `HerdBottomSheet` dialog titled with the session name in mono, with 48 px rows, 11 px mono shortcut hints and a separator before destructive actions. The card and the sheet keep their last anchor while they leave (`useHerdExit`). | Actions, labels, keyboard chords, Escape, anchoring maths and the native sheet. | Upstream action changes flow into all three presentations. Keep the phone branch before the web card branch, and keep the web row styles. |
| `sources/components/CommandPalette/CommandPaletteProvider.tsx` | Extended | Publishes its opener through `HerdCommandPaletteContext` (null unless signed in on web with the palette enabled), so the top bar's search control opens the same palette as ⌘K. | Commands, shortcuts and `ShortcutHintsProvider`. | Keep the context provider wrapped around `children` when merging. |
| `sources/app/(app)/projects/[id].tsx` | Call site | No `showBorder`; passes `entranceIndex`. | Everything else. | — |
| `sources/components/AgentQuestionModal.tsx` | Call site | Reads `useWindowSafeAreaInsets()` instead of `useSafeAreaInsets()`, because it is a fullscreen modal inside the shell body (see the inset rule below). | Everything else. | Keep the window-insets hook when merging. Apply the same rule to any new fullscreen modal that pads by the top inset. |
| `sources/app/(app)/new/index.tsx` | Call site | A fresh draft picks its machine through `resolveNewSessionMachine` (`utils/newSessionMachine.ts`), which the top bar's machine pill shares. | The rule itself: the newest known machine for a fresh draft, and a stale explicit choice kept in place. | Change the default-machine rule in `utils/newSessionMachine.ts` so New Session and the pill stay in agreement. |

Deliberate behavior changes (owner-approved in the overhaul issue):

- **History.** The top bar shows Back and Forward arrows. This replaces the
  September 3 change, which removed Forward and turned Back into a text
  control. Back still unwinds an open file diff or file view before route
  history, and Forward does the same with `useOverlayNav().forward()`.
- **Panel toggle.** The toggle moved from the drawer boundary into the top bar,
  with ⌥⌘B (Ctrl+Alt+B off macOS). A secondary handle sits on the panel edge.
  It appears while the pointer is over the shell and stays visible, at the
  window edge, once the panel is collapsed. It is hidden in Zen mode.
- **Safe-area insets.** The top bar consumes the window's top inset, so the
  shell body provides `top: 0` through `SafeAreaInsetsContext` and screens
  below it start flush. Content that covers the whole window, such as a
  fullscreen `Modal`, must read `useWindowSafeAreaInsets()`
  (`herd/shell/windowInsets.ts`). React Native modals inherit React context,
  so they would otherwise place their header under the status bar on
  tablets.
- **Escape in menus.** `HerdPopover`, the web `SessionActionsPopover`, the
  phone bottom sheets and the composer's chip pickers consume Escape on
  keydown in the capture phase (`useHerdEscapeToClose`, in `herd/escape.ts`
  so the composer does not import the popover UI). Overlays stack: only the
  most recently opened one answers Escape, so a menu inside a sheet closes
  before the sheet. The side panel sheet joins the stack but leaves Escape
  to a focused text field and to app dialogs. `HerdSheet` only marks the keydown handled
  (`useSheetEscapeKeydown`) and leaves closing to its React Native Web
  `Modal`, which closes the topmost modal on keyup, so an alert raised from
  a sheet's form closes before the sheet. The app's global navigation
  handles an unconsumed Escape keydown as Back or as leaving Zen, and it
  runs before React Native Web's modal sees the keyup. A new overlay must
  take one of these two paths.
- **Compact widths (< 1,100 px).** The search control shrinks to an icon and
  the brand shows only its mark. Back and Forward stay because tablets have no
  screen-level Back.
- **Accessibility props.** New shell controls expose state through `aria-*`
  props (`aria-expanded`, `aria-selected`, `aria-checked`). React Native Web
  0.21 ignores `accessibilityState`, so upstream-style `accessibilityState` on
  these controls never reaches the DOM.

## New Session: Streamline and Advanced

The inherited New Session screen gains a web-only **Streamline** mode (the
default, `newSessionMode`) next to the existing form, which is now labelled
**Advanced**. Streamline never forks launch logic. It fills the same draft
(machine, path, Commander, account project, agent, model, effort, permission,
worktree) and starts through the existing `handleSend`, so "exactly one
session per first message", retries and project assignment are unchanged.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/app/(app)/new/index.tsx` | Extended | A `sessionMode` state (web: the synced default; native: always Advanced) and a mode switch in both layouts. Streamline renders `StreamlineSections`, composer chips (`StreamlineComposerChips`, opening the same `PickerContent` through an anchored `HerdPopover`) and `StreamlineSummary`. Effects apply the default agent once per entry and `resolveStreamlineSelection` once per agent, machine and catalog. A GitHub folder (`useGithubRepository`) gets `worktreeKey='__new__'` unless a Commander is selected, the setting is off, or the user edited the worktree chip for that folder. In Streamline, model, effort and permission picks change the launch only and never write Agent Defaults. Streamline lays out by width alone (`STREAMLINE_PHONE_MAX_WIDTH` 700), independent of the `fileDiffsSidebar` panel. | The Advanced form, pickers, keyboard, attachments, dictation, launch, validation, retry and native layouts; Advanced still writes GrokBuild/dsh/rig picks to Agent Defaults as before. | Take upstream changes to the form, pickers and `handleSend`. When upstream adds a launch dimension, give Streamline a chip for it if users should see it before sending. Keep the Streamline effects keyed so later chip edits survive re-renders. |
| `sources/app/(app)/_layout.tsx` | Call site | Registers the `settings/streamline` Stack screen. | Every other screen. | Keep the entry when merging. |
| `sources/sync/settings.ts` | Extended | Four synced settings: `newSessionMode` (default `'streamline'`), `streamlineAgent` (default `'claude'`; a plain string so newer agent keys survive sync, with `normalizeStreamlineAgent` owning the read fallback), `streamlineAgentDefaults` (default `{}`, the same override shape as `agentDefaultOverrides`) and `streamlineGithubWorktree` (default `true`). `settingsToSyncPayload` compacts both override maps the same way. | Every existing field, default and sync rule. | Merge upstream settings changes normally. Keep the four fields in `SettingsSchema` and `settingsDefaults`, and keep both override maps in the compaction loop. |

The Streamline defaults are Claude Opus 5.5 at xhigh with accept edits; Codex
gpt-6-astra at xhigh with default permissions; Gemini 3.1 Pro at high with auto
edit (stored only, because Gemini is retired in the launch registry); GrokBuild
on its catalog default at high with accept edits; and dsh deepseek-v4-flash at
medium with default permissions. They live in `sync/streamlineDefaults.ts` and
resolve against the exact machine's advertised catalog. Choices come from the
machine, so display names are the daemon's values (for example
`claude-opus-5-5`, `acceptEdits`), exactly as in the Advanced pickers.

## Session screen

The session stream, dock, composer and header keep every upstream behavior and
gain a web presentation. Native paths are unchanged unless a row says
otherwise.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/-session/SessionView.tsx` | Extended | The web header renders `herd/session/SessionHeaderActions` (Workspace toggle, Side chats with a count badge, ⋯ opening `SessionActionsPopover`). A `desktopWorkspaceHidden` flag hides the Workspace without closing tabs; `collapseSidebarPanels` and a session change clear it. Passes the composer's agent chip and `connectionStatus.state`. Below 1,100 px on desktop web, the right panel and the Workspace render as one sheet over a scrim through `DesktopFileWorkspaceSplit`'s `overlay` prop (`resolveHerdSheetWidth`); `rightOverlayDismissed` hides the sheet without closing panels and is cleared by `openSidebarPanel`, `selectSidebarPanel` and `collapseSidebarPanels`, and the header state follows the sheet (`sideChatSidebarShown`). | Native header, the docked layout from 1,100 px, phone full-screen views, and all workspace, side-chat, link, overlay-history, draft and composer logic. | Merge logic normally; keep the header, the hidden flag, the overlay wiring and the chip wiring. New header buttons go into `SessionHeaderActions`. Any new path that reveals a panel or the Workspace must go through those helpers so the dismissal clears. |
| `sources/navigation/browserNavigation.ts` | Extended | `getKeyboardNavigationDirection` ignores an Escape that cancels an IME composition (`isComposing`), so cancelling a composition never navigates Back. | Every other Escape, modifier and mouse rule. | Keep the composition check when merging. |
| `sources/components/ChatHeaderView.tsx` | Restyled | Web: a full-width bar with a hairline, a folder / title crumb with hover, and no left clearance (shell controls live in the top bar). | Props, native glass branch, back button, `rightSlot`. Both Back buttons are now labelled `common.back`. | Take behavior; re-apply the web styles and keep the labels. |
| `sources/components/MessageView.tsx` | Restyled | Web user bubbles; replies use the Markdown `reply` tone; event rows (`AgentEventRow`); an `entrance` prop. | Message kinds, pending and error frames, options, copy, safeguard, native island. | Keep web values in `Platform.select`; route new event types through `AgentEventRow`. |
| `sources/components/ChatList.tsx` | Extended | A row rises in once (first paint, live arrival, group reveal), never on scroll or recycle; the Jump to latest control is a pill. | Inverted list, windowing, grouping, focus, wheel handling. | Merge list logic; keep the entrance tracker hooks. |
| `sources/components/AgentWorkGroupHeader.tsx` | Restyled | A leading chevron that rotates, a hover wash, a member count, entrance props. | Labels, `aria-expanded`, equal row heights. | Keep the equal heights and the chevron-first layout. |
| `sources/components/tools/ToolView.tsx` | Extended | A web-only render path: `ToolLine` rows (icon, verb, mono argument, +N −N, live timer, spinner then check) expanding in place through `herd/session/Collapse`, a warning-edged permission card, and bare cards for todo lists and questions. Every card keeps a Details link to the detail screen, and an empty todo list keeps its tool line. | Tool classification, specific tool views, errors, native path, detail navigation. | Port changes into the shared code above the web branch and mirror new cases in the web path. |
| `sources/components/tools/PermissionFooter.tsx` | Restyled + Extended | Each provider's choices become one ordered list (same labels and handlers). Web adds number keys 1..n (`herd/session/permissionShortcuts.ts`) for the oldest pending card that is on screen (inside the chat list's scroll area and not covered by an overlay), and a decided state. | Every handler, label and decision rule; native styles. | Add new choices to the provider's list. List order is the key number. |
| `sources/components/tools/views/TodoView.tsx` | Extended | `WebTodoCard` with a progress bar and done/total count. `readTodos` is exported for the web path in `ToolView`. | Parsing, native list. | Parsing changes apply to both. |
| `sources/components/tools/views/InlineQuestionForm.tsx` | Restyled | Web: an info-edged card, circular radios, the selection ring, staggered options and `aria-checked`. | Submit, cancel, Other, multi-select and secret logic. | Take logic; re-apply the web styles. |
| `sources/components/AgentInput.tsx` | Extended | Web chips after the + button (agent opens "Continue with…"; model, effort and permission open popovers built from the same option renderers as the settings popover); a context meter (`agentInput.context.remaining`, following the existing "Always show context size" setting); a theme-colored status row; restyled controls. Chip pickers close with `herd-pop-out`, keeping the last picker through `useHerdExit`. | All input behavior and shortcuts, the native composer, the combined settings popover in the + menu. | Keep `renderPermission/Model/EffortOptions` shared so new options appear in the chips too. |
| `sources/components/AgentGoalBar.tsx`, `QueuedMessagesPanel.tsx` | Restyled | Web single-line goal; single-line queued rows ("Sends after this turn · +N queued"). | Actions and labels; native layouts. | Merge as-is; keep the web branches. |
| `sources/components/SafeguardReminderCard.tsx`, `ProviderContinuationLinks.tsx`, `markdown/MarkdownView.web.tsx`, `markdown/MarkdownView.types.ts` | Restyled | Card sizing and quote rule; molten continuation pills; the Markdown `reply` tone (list markers, links, inline code, code blocks, option pills). | Contrast values the tests assert; content and links. | Take behavior; keep the web styles and the `reply` tone. |

Open decisions recorded for the owner: the context meter follows the existing
"Always show context size" setting, which is off by default, so it shows only
at 10% or less remaining. The send button keeps its current behavior (Stop
stays in the + menu and on Esc).

## Side panels and Workspace

The right panel and the Workspace follow the mock: pill tabs for Changes
and Side chats, a Changes list with a branch summary, a grip divider, a
Workspace with folder-style tabs and a file bar, molten comment cards, and a
framed live view. Below 1,100 px on desktop web they slide over the chat as
one sheet (see `SessionView.tsx` above). `herd/panels/panelColors.ts`
derives the few tints the mock uses that have no theme token (the fainter
hairlines, the active tab's rim, the panel and Workspace grounds) from KILV
tokens; a future theme token can replace each.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/components/FilesSidebar.tsx` | Restyled + Extended | Pill tabs (`herd/panels/PanelTab`): Changes with +N −N, then Side chats with its count, in fixed order and level with the chat header (`useHeaderHeight`); a closed Changes pill opens the panel. Picker cards with a description and shortcut; the add-panel menu inline under its "+" (`HerdMenuItem`, `herd-pop`); a branch and staged/unstaged summary; mono tree rows with per-file counts, a molten edge on the open file, folders through `HerdCollapse`; an optional `onHidePanel`; a `presented` flag (false while the sheet below 1,100 px is hidden) closes the add-panel menu and turns its shortcuts off, and Escape closes that menu before the sheet. | Props, picker and menu actions and shortcuts (active only while the picker or menu shows), git refresh on mount, tree building, deleted-file handling, the native glass menu. | Take upstream data and behavior; keep the pill order (`ALL_PANELS`), the inline menu and the row styles. A new panel gets a pill and a picker card. |
| `sources/components/SideChatPanel.tsx` | Restyled + Extended | One pill per side chat (close on hover or when active); "+" beside the tabs and full screen at the row's end, replacing the toolbar row; a molten empty-state hero; the phone full-screen host uses `HerdPanelScreenHeader` (collapse, parent-session subtitle, "+" in the header through `newChatInTabs={false}`); a restyled modal header. | Exports and props, `SideChatAccessButton` (native, unchanged), the `sideChat.close/expand/collapse/newChat` labels, unlabelled tab semantics, the Modal flow, the embedded `SessionViewLoaded`. | Take upstream behavior; keep the tab row (tabs, "+", spacer, full screen) and the full-screen header. |
| `sources/components/FileViewPanel.tsx` | Restyled | Preview/Edit as one sunken pair with a molten selected state (`aria-pressed`); labelled icon Download and Delete in the wide Workspace bar (`iconActions`); compact headers keep a labelled Download and native keeps a labelled Delete; an edit bar with the file name, save state, Cancel and a primary Save; bars on theme surfaces. | All read, write, delete, download, conflict and preview logic, and every accessible name. | Take upstream logic; keep the `iconActions` split. |

## Secondary pages

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/app/(app)/automations/index.tsx`, `components/HappyHerdAutomationDetail.tsx` | Replaced (layout) | Expandable rows, one open at a time, carrying every detail capability (Run now with Running then Completed, Pause/Resume, Edit or Open target, History, instructions, schedule, previous runs, Delete). The create/edit form is a sheet on desktop and inline on phones. | RPCs, exec-run polling, profiling, and every action. | Port behavior into the expanded row; keep one row open at a time. |
| `sources/components/SettingsView.tsx` | Extended | A Commanders row at the end of Features and a Streamline row beside Agent Defaults. | All rows, handlers and order. | Keep both rows. |
| `sources/app/(app)/settings/{index,account,appearance,agents,language,usage,voice,voice/language,connect/claude}.tsx` | Extended | Default export wrapped in `withSettingsFrame('<section>', Screen)`, so from 1,000 px on web the section list appears beside the page. On web the page keeps the same parent Views at every width, so a resize never remounts it, and a nested page's highlighted section still returns to that section's page. | Bodies, props, routes, and phone and native rendering. | Merge body edits normally and keep the wrapper. A new settings page gets a `SETTINGS_SECTIONS` entry. |
| `sources/components/InboxView.tsx`, `FeedItemCard.tsx`, `app/(app)/session/[id]/info.tsx`, `app/(app)/machine/[id].tsx` | Restyled | `HerdItemGroup` / `HerdItem` drop-in imports (`herd/pages/HerdList.tsx`). | All JSX, data, actions and states. | Keep the import lines; new rows inherit the look. |
| `sources/app/(app)/projects/index.tsx`, `projects/[id].tsx` | Restyled | A card grid with session counts and recent avatars; the project detail has a header with Rename and its sessions in one card. | Data, actions, archive toggle, focus project. | Take behavior; keep the card layout. |
| `sources/app/(app)/changelog.tsx` | Restyled | Entries render through `HerdTimelineGroup`, centred at 760 px. | Parsing, links, images, Markdown, last-viewed state. | Keep `HerdTimelineGroup` and the timeline style. |
| `sources/components/FocusModeControl.tsx` | Restyled | The setup card uses `HerdSegmentedControl` for duration and chips for the project. The active state is a pill with a progress ring. Timers also store `startedAt` in the synced focus setting (unknown fields pass through older clients). | The amber transition, heading, testIDs and the focus data flow. | Take behavior; keep the ring maths in `herd/pages/focusProgress.ts`. |
| `sources/components/CommandPalette/{CommandPalette,CommandPaletteInput,CommandPaletteItem,CommandPaletteResults,CommandPaletteModal}.tsx` | Restyled | Sheet radius token, 640 px wide, amber section labels, an accent bar on the highlighted row, key caps, a hint footer, `aria-selected`. | Commands, keyboard handling, grouping, animations. | Take upstream logic; keep the style blocks and the footer. |
| `sources/components/CommandPalette/CommandPaletteProvider.tsx` | Extended | Adds a Commanders command (and publishes the opener, see *Desktop shell*). | All existing commands and shortcuts. | Keep the command after Create Commander. |

The new Commanders page (`app/(app)/commanders/index.tsx`) is HappyHerd-owned.
It reads memory files through the existing `machineReadFileWithinRoot` call,
bounded to each Commander's AgentContext folder, so older daemons show an
error with Retry.

Known gaps: the Usage page keeps its current look; Credentials, Connections,
Commander avatar settings and the Inbox update banner were outside this pass;
Settings sub-pages keep the base list look until `ItemGroup`/`Item` adopt the
`HerdList` treatment.

## Web Mobile shell

Below 700 px on the web (`herd/mobile/useHerdPhone.ts`, the same width rule
as Streamline), the shell follows the mock's phone mode: a bottom tab bar, a
home header with a focus row, a floating New session button, back bars on
full-screen pages, and bottom sheets in place of anchored menus. Native
rendering is unchanged. Menus and sheets leave with motion on both desktop
and phone web (`herd/presence.ts` `useHerdExit`); reduced motion and native
close at once.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/components/TabBar.tsx` | Restyled (web) | Web tabs: Ionicons (filled when active), 58 px tabs with 11 px labels, a 2 px accent indicator sliding with `herd-glide`, accent badge and dot, `role="tablist"` with `aria-selected`, test IDs `tab-*`. The Sessions label is `tabs.sessionsTab`. | The native tab bar (drag lens, haptics, glass), tab order, `onTabPress`, badge and unread rules, bottom safe-area padding. | Take upstream behavior. A new web tab needs `iconName` / `activeIconName` in `webTabs`; the indicator width follows the tab count. |
| `sources/components/MainView.tsx` | Extended (phone web) | The phone web header is `herd/mobile/MobileHome` (header, then the focus row on Sessions). Header actions are `MobileHeaderIconButton`s: Workspace (only while `machineWorkspace` is on), Projects and Automations. The `+` became `MobileNewSessionFab` on Sessions, with an 88 px list inset. | Native header, search, view menu, `HomeDock`, the sidebar variant, tab state, every route. | Merge logic normally; phone web header changes go in `MobileHomeHeader` and the web branches of `HeaderRight`. |
| `sources/components/navigation/Header.tsx` | Restyled (phone web) | An opaque `surface` bar with a hairline and no shadow (skips `styles.shadow`), 56 px, a labelled 40 px Back (`header-back`), a left-aligned 16 px title and a 12 px faint subtitle. | `goBack`, custom `headerLeft` / `headerRight`, tablet, desktop and native headers. | Keep the `isWebPhone` styles last in each style array. |
| `sources/components/HomeHeader.test.ts` | Test | Mocks `herd/mobile/MobileHome`, because this file tests the native home. | Every native assertion. | Keep the mock. |
| `sources/components/herd/HerdPopover.tsx` (HappyHerd-owned) | Extended (phone web) | Under 700 px it renders its content in a `HerdBottomSheet` with touch-size rows (`useInHerdSheet`). | The desktop card, anchoring and Escape. | Not inherited; listed here because every top bar menu and Streamline chip picker gets the phone sheet through it. |

## HappyHerd-owned modules

These files do not exist upstream; upstream merges never conflict with them.

| File | Purpose |
|---|---|
| `sources/components/herd/motion.ts` | Motion scale and helpers (`HERD_MOTION`, `herdWebClasses`, `herdStaggerClass`) for applying the CSS motion classes through Unistyles `_web._classNames`. |
| `sources/components/herd/motion.test.ts` | Guards the motion classes, reduced-motion coverage and the overhaul tokens in both themes. |
| `sources/components/herd/SegmentedControl.tsx` | Equal-width segmented control with a sliding selection thumb. |
| `sources/components/herd/HerdPopover.tsx` | Anchored dropdown (`HerdPopover`, `HerdMenuItem`, `HerdMenuTitle`, `HerdMenuSeparator`) for top bar menus; a bottom sheet on phone web. It re-exports `useHerdEscapeToClose`. |
| `sources/components/herd/escape.ts` | `useHerdEscapeToClose`, the capture-phase Escape rule for overlays: a stack in which the newest open overlay answers, with an optional `accepts` check. |
| `sources/components/herd/presence.ts` | `useHerdExit` and `HERD_EXIT`: an overlay keeps its last anchor, or open state, while its exit class plays. |
| `sources/components/herd/HerdExitLayer.web.tsx` (and a native `HerdExitLayer.tsx` that renders nothing) | The inert, pointer-transparent body layer a closed overlay leaves on, after its Modal has already ended. |
| `sources/components/herd/panels/*` | Side panel parts: `PanelTab` (pill tab with count or line badges and a close button that shows on hover, keyboard focus or when active), `PanelIconButton`, `PanelGrip` (the resize pill), `PanelOverlay` (scrim, Escape that skips text fields, the sheet width rule), `PanelScreenHeader` (phone back header) and `panelColors`. |
| `sources/components/{DesktopFileWorkspace,SessionSidebarDivider,LocalhostLiveView.web,InlineCommentReview.web}.tsx`, `sources/components/sideChatPresentation.ts`, `sources/app/(app)/workspace/index.tsx` | HappyHerd-owned Workspace and panel files, restyled for the panels: the Workspace tabs, file bar and `overlay` split mode, the grip divider, the framed live view, molten comment cards and a docked review bar, the overlay presentation rule (`rightPanelPresentation: 'overlay'` on non-phone web below 1,100 px), and the Workspace page on theme tokens. |
| `sources/components/herd/mobile/useHerdPhone.ts` | The phone web rule: web and narrower than 700 px. |
| `sources/components/herd/mobile/HerdBottomSheet.tsx` | The phone sheet: scrim, `herd-sheet-up` / `herd-sheet-down`, a drag handle that is also a labelled Cancel button (a drag past 72 px or a flick dismisses), and home-indicator padding. |
| `sources/components/herd/mobile/MobileHome.tsx` | The phone home header, its icon buttons, the focus row and the floating New session button. |
| `sources/components/herd/shell/HerdTopBar.tsx` | Desktop top bar: panel toggle, Zen, brand, history, command search, Focus mode, Inbox bell and machine menu. |
| `sources/components/herd/shell/HerdTopBarIconButton.tsx` | Square icon control for the top bar. |
| `sources/components/herd/shell/HerdInboxBell.tsx` | Inbox bell with the friend-request count (or an unread dot) and the Updates dropdown. |
| `sources/components/herd/shell/HerdMachineMenu.tsx` | Machine pill and menu. It shows and switches the machine New Session uses (`useNewSessionDraft.setMachineId`). |
| `sources/components/herd/shell/HerdSidebarEdgeToggle.tsx` | Secondary collapse handle on the panel edge. |
| `sources/components/herd/shell/sidebarTransition.tsx` | Collapse sequencing (`useHerdSidebarTransition`, `HerdSidebarFrame`). |
| `sources/components/herd/shell/sidebarShortcut.ts` | The ⌥⌘B chord and the shared collapse toggle. |
| `sources/components/herd/shell/commandPaletteBridge.ts` | `HerdCommandPaletteContext` for opening the palette from a control. |
| `sources/components/herd/shell/selectionGlide.ts` | Web FLIP glide for the session selection. |
| `sources/components/herd/shell/HerdSessionRowParts.tsx` | Row selection ring, ⋯ button, row data attributes and the touch-only long press (`useHerdRowLongPress`), shared by both session row components. |
| `sources/components/herd/shell/sessionRowPresentation.ts` | Row status line and agent chip rules. |
| `sources/components/herd/shell/windowInsets.ts` | `HerdWindowInsetsContext` / `useWindowSafeAreaInsets` for fullscreen content inside the shell body. |
| `sources/utils/newSessionMachine.ts` | `resolveNewSessionMachine`, the default-machine rule shared by New Session and the top bar's machine pill. |
| `sources/components/herd/newSession/StreamlineSections.tsx` | Streamline's Commander cards, working-folder cards (with the GitHub badge) and project chips; swipe rows on phones. |
| `sources/components/herd/newSession/StreamlineComposer.tsx` | Streamline composer chips and the defaults summary line. |
| `sources/app/(app)/settings/streamline.tsx` | Streamline settings: default mode, default agent, the GitHub worktree rule, and per-agent model/effort/permission defaults from a capability source machine. |
| `sources/sync/streamlineDefaults.ts` | Streamline code defaults and `resolveStreamlineSelection` (catalog-validated model, effort and permission). |
| `sources/sync/githubRepository.ts` | Git and GitHub detection for a machine folder through the existing bash RPC (plain `git`, cached). |
| `sources/hooks/useStreamlineLocations.ts` | Working folders from favorites, recent folders and Commander workspaces. |
| `sources/utils/normalizeMachinePath.ts` | Shared machine-path identity for Streamline. |
| `sources/components/herd/session/*` | Session screen parts: `ToolLine` and `toolLineModel`, `Collapse` (a collapsed body stays mounted on web but is `inert`), `color` (`herdAlpha`, which mixes the CSS-variable colors Unistyles hands web style factories with `color-mix`), `entranceMotion`, `permissionShortcuts`, `ComposerChips` and `composerChipModel`, `HeaderButton`, `SessionHeaderActions`. |
| `sources/components/herd/pages/*` | Page parts: `HerdPage` (header, buttons, chips, labels, notices, empty states), `HerdSheet`, `HerdCollapse`, `HerdList` (drop-in `ItemGroup`/`Item`), `HerdTimeline`, `SettingsFrame` (desktop section list), `commanderMemory`, `focusProgress`. `herd/session/Collapse` and `HerdCollapse` do the same job; merge them the next time either changes. |
| `sources/app/(app)/commanders/index.tsx` | The Commanders page. |
| `sources/app/(app)/settings/{connections,credentials,features}.tsx` | HappyHerd-owned settings pages. Their default exports are wrapped in `withSettingsFrame`, like the inherited ones. |
| `sources/components/SidebarNavigationButton.tsx` | HappyHerd-owned; restyled with tokens and given `active`, `emphasis` and `quiet` variants. |
| `sources/components/sidebarNavigationLayout.ts` | HappyHerd-owned; the boundary-toggle, persistent-header and header-clearance helpers were removed with those controls. |
