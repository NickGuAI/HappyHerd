# Upstream UI parity record

<!-- rename:preserve -->
HappyHerd's interface now departs from the one it inherits from upstream Happy
(`slopus/happy`).
<!-- /rename:preserve -->
This record lists every inherited screen, component and style
the overhaul replaces or modifies, the HappyHerd file that now owns the
behavior, what stayed compatible, and how to carry a future upstream change into
the new design. Follow it during every upstream merge (see the
`happyherd-sync-upstream` skill); update it in the same pull request as any UI
change that touches an inherited file.

- **Upstream base for this record:** `4b7d763ee3afda04985f3210b9cb9acf9359c7d9`
  (the most recent upstream commit merged into `main` when the overhaul began).
<!-- rename:preserve -->
- **Path mapping:** upstream `packages/happy-app/sources/<path>` is HappyHerd
  `server/packages/happyherd-app/sources/<path>`.
- **Check provenance of a file** (prints `upstream` when the path exists
  upstream):

  ```bash
  U=4b7d763ee3afda04985f3210b9cb9acf9359c7d9
  f='components/SidebarView.tsx'
  git cat-file -e "$U:packages/happy-app/sources/$f" 2>/dev/null && echo upstream || echo happyherd
  ```
<!-- /rename:preserve -->

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
| `sources/theme.ts` | Restyled | `borderRadius` scale is now `sm 6, md 8, lg 10, xl 12, xxl 14` (was 4/4/4/6/6); `kilv.radius` 8 and `kilv.radiusCard` 12; new `kilv.radiusSheet`, `kilv.radiusPill`, and for phone surfaces `kilv.radiusBottomSheet` (22, bottom sheets' top corners); motion scale `kilv.motionFast/Base/Slow` and `kilv.easeOut/InOut/In`; new `colors.selection { border, background, ring }`. | Every existing token name and color value; `kilv.motion` (150 ms) still exists for current callers. | Take new upstream tokens by name. If upstream changes a radius or motion value, keep HappyHerd's value; if upstream adds a new semantic color, add it to both KILV palettes. Regenerate `theme.light.json` and `theme.dark.json` with `pnpm exec tsx sources/theme.gen.ts`. |
| `sources/theme.css` | Extended | Adds the fluid-motion layer: `herd-*` keyframes and classes, stagger steps `herd-d1`…`herd-d10`, `herd-transition`, `herd-glide`, `herd-exit-left`, the overlay exits `herd-pop-out` / `herd-sheet-out` / `herd-sheet-down` / `herd-fade-out` (each also stops pointer input), the hover reveals `herd-shell-reveal` / `herd-row-reveal` with their hosts `herd-shell` / `herd-row` (hidden on touch-only screens, where row text is also not selectable so a long press can open the row's actions), and a reduced-motion block that disables all of them. | All existing global rules (scrollbars, Pierre diff reset, session-title shimmer, focus rings, 16 px phone inputs). | Keep the `herd-*` block together and after upstream rules; merge upstream global rules above it. `components/herd/motion.test.ts` fails if a class used in code is missing here. |

## Desktop shell

The desktop layout is now a HappyHerd top bar above the permanent drawer.
Upstream's absolute `PersistentHeader` overlay (Zen, Back, Forward) and the
boundary collapse toggle no longer exist. Zen and the collapse toggle live in
`components/herd/shell/`; the Back and Forward buttons were removed (see
History below). Phones use the same top bar with the panel as a drawer (see
*Phone shell*).

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/components/SidebarNavigator.tsx` | Replaced (layout) | Renders `HerdTopBar` above a body that holds the `Drawer` and `HerdSidebarEdgeToggle`. The drawer width follows `useHerdSidebarTransition` (content slides out, then the width snaps). The body overrides `SafeAreaInsetsContext` with `top: 0` because the top bar consumes the top inset. `PersistentHeader` and `DesktopNavigationBoundaryToggle` were deleted. | Drawer options (`permanent` on desktop, hidden `front` drawer on phones), `lazy: false`, the 250–360 px width rule, the rule that drawer width is never animated, the Zen and collapse semantics, and the element order, so the navigator never remounts when the layout changes. | Port new upstream header controls into `herd/shell/HerdTopBar.tsx`, not back into this file. Do not port header Back or Forward buttons (see History below). Take upstream drawer-option changes here. If upstream animates the drawer width, do not take it; see the comment above `drawerNavigationOptions`. |
| `sources/components/SidebarView.tsx` | Restyled | The top padding that reserved the old header strip is gone. Tokens replace hard-coded radii and colours. Destinations show an active state for the current route (`usePathname`). New session uses the `emphasis` button and Settings the `quiet` one. Border on the right edge only. | Both rows: icon-only Workspace (behind `machineWorkspace`), Projects, Automations; then New session with its `N` hint and the archive toggle. Also `VoiceAssistantStatusBar`, `MainView variant="sidebar"`, and Settings with its `,` hint. | Take upstream structure and behavior. Keep the two rows and the token styles. A new destination gets `active={pathname.startsWith(...)}`. |
| `sources/components/FlatSessionRow.tsx` | Restyled + Extended | Inset rounded rows (`marginHorizontal` 8, `kilv.radius`), transparent on web with a hover tint. Adds an agent chip (`herd/shell/sessionRowPresentation.ts`), a status line while a session waits on the user (it takes the worktree line when that line is empty), `HerdRowMoreButton` (⋯), `HerdRowSelection` (gliding selection ring) and an `entranceIndex` stagger for the first 12 rows. On touch-only web (`hover: none`), a long press opens the actions (`useHerdRowLongPress`), because iOS Safari sends no context menu; the row cancels that touch's release so the browser does not click the new sheet's backdrop. Removed `showBorder` (no dividers). Titles are 16 px; timestamps and daemon identity use mono. | Every data line (title, project, daemon label and short id, worktree, git counts), the unread-ring grace period, the faded offline state, shortcut badges, right-click and `SessionActionsPopover` on web, long press, and swipe-to-archive on native (native rows stay opaque for the swipe). | Merge upstream row logic and data fields normally. Keep new visual elements inside the existing lines, and keep the row background transparent on web, or the glide cannot pass behind neighbouring rows. |
| `sources/components/ActiveSessionsGroupCompact.tsx` (`CompactSessionRow`) | Extended (web) | Rounded inset rows with a hover tint, `HerdRowSelection` and `HerdRowMoreButton`. On web, dividers and the selected fill give way to the shared selection ring. The touch-only long press matches `FlatSessionRow`. | Native rendering, swipe, long press, right-click, the identity line and git counts. | Same rule as `FlatSessionRow`. |
| `sources/components/SessionsList.tsx` | Restyled | Mono uppercase group and archive headers aligned with the inset rows. Passes `entranceIndex`; no longer passes `showBorder`. The panel marks the open session in every layout but the phone layout (`useHerdPhoneLayout`), where upstream used the device rule. | Data building, grouping modes, archive toggle, search and virtualization settings. | Take upstream list logic and re-apply the header style. |
| `sources/components/SessionActionsPopover.tsx` | Restyled (web) + Extended (phone web) | `kilv.radiusCard` card with the `herd-pop` entrance and 40 px rounded rows that tint on hover, with no dividers on web. Under 700 px it is the same card, titled with the session name in mono, as wide as the window allows up to 330 px and kept 8 px inside it, with 48 px rows on the 16 px gutter, a separator before destructive actions and no shortcut hints. The phone card is capped to the window less 8 px at the top and bottom and scrolls its actions below the title. The card keeps its last anchor while it leaves (`useHerdExit`). | Actions, labels, keyboard chords (they still work with a keyboard), Escape, anchoring maths and the native sheet. | Upstream action changes flow into both presentations. Keep the phone metrics inside the web card branch, and keep the web row styles. |
| `sources/components/CommandPalette/CommandPaletteProvider.tsx` | Extended | Publishes its opener through `HerdCommandPaletteContext` (null unless signed in on web with the palette enabled), so the top bar's search control opens the same palette as ⌘K. | Commands, shortcuts and `ShortcutHintsProvider`. | Keep the context provider wrapped around `children` when merging. |
| `sources/app/(app)/projects/[id].tsx` | Call site | No `showBorder`; passes `entranceIndex`. | Everything else. | — |
| `sources/components/AgentQuestionModal.tsx` | Call site | Reads `useWindowSafeAreaInsets()` instead of `useSafeAreaInsets()`, because it is a fullscreen modal inside the shell body (see the inset rule below). | Everything else. | Keep the window-insets hook when merging. Apply the same rule to any new fullscreen modal that pads by the top inset. |
| `sources/app/(app)/new/index.tsx` | Call site | A fresh draft picks its machine through `resolveNewSessionMachine` (`utils/newSessionMachine.ts`), which the top bar's machine pill shares. | The rule itself: the newest known machine for a fresh draft, and a stale explicit choice kept in place. | Change the default-machine rule in `utils/newSessionMachine.ts` so New Session and the pill stay in agreement. |

Deliberate behavior changes (owner-approved in the overhaul issue):

- **History.** The top bar has no Back or Forward buttons on any platform,
  and upstream's header arrows are not ported. On web, history stays with the
  browser's own controls, the mouse side buttons and an unconsumed Escape
  (`useBrowserNavigationShortcuts`), which still unwinds an open file diff or
  file view (`useOverlayNav`) before route history. The desktop app has no
  browser controls, so it relies on the mouse buttons and Escape. Web windows
  700 px and wider show no header Back. On native tablets, and on the iOS app
  on a Mac at any window size, every screen header shows its own Back (owner
  decision, September 27), although the device rule calls a small Mac window
  a phone. On the iPad routes that keep UIKit's header (most of them; see
  `app/(app)/_layout.tsx`), that is UIKit's Back. Elsewhere it is the custom
  headers' own: `ChatHeaderView` on the session screen, which steps out of an
  open diff or file first and otherwise leaves the session, and
  `navigation/Header`, which Android, the iOS app on a Mac and the signed-in
  iPhone use for every route. The iPad, and the iPhone's signed-out pages,
  keep UIKit's header. Phones show Back on
  nested pages, and in a session only while a diff or file is open over the
  chat; the drawer's destinations have none. The top bar's brand still
  returns to the session list, iOS keeps the stack's swipe-back and Android
  the system Back.
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
- **Escape in menus.** `HerdPopover`, the web `SessionActionsPopover` and
  the composer's chip pickers consume Escape on
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
  the brand shows only its mark.
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
| `sources/app/(app)/new/index.tsx` | Extended | A `sessionMode` state (the synced default on the web and on native phones, owner decision September 27; native tablets keep Advanced, and so does the iOS app on a Mac at any window size, although the device rule calls a small Mac window a phone) and a mode switch in both layouts. Streamline renders `StreamlineSections`, composer chips (`StreamlineComposerChips`, opening the same `PickerContent` through an anchored `HerdPopover`) and `StreamlineSummary`. Effects apply the default agent once per entry and `resolveStreamlineSelection` once per agent, machine and catalog. A GitHub folder (`useGithubRepository`) gets `worktreeKey='__new__'` unless a Commander is selected, the setting is off, or the user edited the worktree chip for that folder. In Streamline, model, effort and permission picks change the launch only and never write Agent Defaults. Streamline lays out by width alone (`STREAMLINE_PHONE_MAX_WIDTH` 700), independent of the `fileDiffsSidebar` panel. On phones (UI overhaul) the whole Streamline page scrolls: the stacked title and full-width mode switch (44 px segments), the choices, then the composer and its summary. A chip's picker spans the composer (`streamlineComposerRef`), and the folder browser floats on the bottom edge, 8 px from the window's sides and bottom, at up to 56% of the height. Its whole content scrolls inside that card, so every control stays reachable on a short phone. On phones the page carries its own title, so the header row is hidden in Streamline. Native phones use the same page, with the composer pinned below it as in the Advanced form, so the keyboard handling is the Advanced form's. There the chips replace the agent and settings buttons, chip pickers open as the menu sheet, and the folder browser reuses the Advanced form's keyboard-aware path popover (`KeyboardStickyView`). Native pickers anchor to the whole pinned composer, its summary included, and above its bottom spacer. On a native phone under the phone top bar the screen starts the top inset plus `HERD_PHONE_TOP_BAR_HEIGHT` below the window's top (HerdSheet's rule), so the picker anchor subtracts that distance from the window height, and the screen's `KeyboardAvoidingView` (react-native-keyboard-controller, which compares the view's frame in its parent with the window's keyboard) takes it as `keyboardVerticalOffset`. The web, native tablets, the iOS app on a Mac and signed-out screens keep their previous values. The native New Session header has no Back, because the drawer leads away. | The Advanced form, pickers, keyboard, attachments, dictation, launch, validation, retry and native layouts; Advanced still writes GrokBuild/dsh/rig picks to Agent Defaults as before. | Take upstream changes to the form, pickers and `handleSend`. When upstream adds a launch dimension, give Streamline a chip for it if users should see it before sending. Keep the Streamline effects keyed so later chip edits survive re-renders. |
| `sources/app/(app)/_layout.tsx` | Call site | Registers the `settings/streamline` Stack screen. | Every other screen. | Keep the entry when merging. |
| `sources/sync/settings.ts` | Extended | Four synced settings: `newSessionMode` (default `'streamline'`), `streamlineAgent` (default `'claude'`; a plain string so newer agent keys survive sync, with `normalizeStreamlineAgent` owning the read fallback), `streamlineAgentDefaults` (default `{}`, the same override shape as `agentDefaultOverrides`) and `streamlineGithubWorktree` (default `true`). `settingsToSyncPayload` compacts both override maps the same way. | Every existing field, default and sync rule. | Merge upstream settings changes normally. Keep the four fields in `SettingsSchema` and `settingsDefaults`, and keep both override maps in the compaction loop. |

The Streamline defaults are Claude Opus 5.5 at xhigh with accept edits; Codex
gpt-6-astra at xhigh with default permissions; GrokBuild on its catalog
default at high with accept edits; and dsh deepseek-v4-flash at medium with
default permissions. Gemini has none, because it is retired in the launch
registry, and agy and rig start from Agent Defaults. The defaults live in
`sync/streamlineDefaults.ts` and resolve against the exact machine's
advertised catalog. Choices come from the machine, so display names are the
daemon's values (for example `claude-opus-5-5`, `acceptEdits`), exactly as in
the Advanced pickers.

## Session screen

The session stream, dock, composer and header keep every upstream behavior and
gain a web presentation. Phones, web and native, share it (see *Phone
shell*). Other native paths are unchanged unless a row says otherwise.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/-session/SessionView.tsx` | Extended | The web header renders `herd/session/SessionHeaderActions` (Workspace toggle, Side chats with a count badge, ⋯ opening `SessionActionsPopover`). A `desktopWorkspaceHidden` flag hides the Workspace without closing tabs; `collapseSidebarPanels` and a session change clear it. Passes the composer's agent chip and `connectionStatus.state`. Below 1,100 px on desktop web, the right panel and the Workspace render as one sheet over a scrim through `DesktopFileWorkspaceSplit`'s `overlay` prop (`resolveHerdSheetWidth`); `rightOverlayDismissed` hides the sheet without closing panels and is cleared by `openSidebarPanel`, `selectSidebarPanel` and `collapseSidebarPanels`, and the header state follows the sheet (`sideChatSidebarShown`). Phones, on web and native, take the same header; the native avatar button gave way to ⋯ → Details, and the title opens session info as before. The phone header's Back shows only while a diff or file is open over the chat, because the top bar leads out of the session. Native tablets, and the iOS app on a Mac at any window size (the device rule calls a small Mac window a phone), also get Back when nothing is open, and it leaves the session (`router.back()`). The chat, dock and composer sit on the 16 px gutter. Web Mobile uses the same sheet as below 1,100 px, leaving a 16 px strip of the chat (`HERD_PHONE_SHEET_LEFTOVER`). The phone checks (that strip, the gutter, the voice bar, compact header buttons, and upstream's landscape Back and CLI notice) use `useHerdPhoneLayout`, so a web window 700 px or wider lays out as the desktop. The iOS app on a Mac (`isRunningOnMac()`) is excluded from the native landscape-phone treatment. In a landscape window the device rule calls a phone, it keeps the session header with its own Back and its top padding, and gets neither the floating Back nor the floating Side chats (owner decision, 2026-09-27). Native phones in landscape keep upstream's floating controls. | The native tablet header, the docked layout from 1,100 px, full-screen side chats and Workspace on native phones, and all workspace, side-chat, link, overlay-history, draft and composer logic. | Merge logic normally; keep the header, the hidden flag, the overlay wiring and the chip wiring. New header buttons go into `SessionHeaderActions`. Any new path that reveals a panel or the Workspace must go through those helpers so the dismissal clears. Keep all four `!isRunningOnMac()` checks when merging. |
| `sources/navigation/browserNavigation.ts` | Extended | `getKeyboardNavigationDirection` ignores an Escape that cancels an IME composition (`isComposing`), so cancelling a composition never navigates Back. | Every other Escape, modifier and mouse rule. | Keep the composition check when merging. |
| `sources/components/ChatHeaderView.tsx` | Restyled | Web: a full-width bar with a hairline, a folder / title crumb with hover, and no left clearance (shell controls live in the top bar). Phones, web and native, use the same bar. The folder sits above the title, and over a file the folder and title sit above the file's path. Back is a 44 px square on the gutter, and the controls end on the gutter. The glass header is off. Back shows whenever `onBackPress` is set in the phone layout and on native tablets (the iOS app on a Mac included), never on the web at 700 px and wider. | Props, the native tablet branch (its glass code is kept, switched off), the back button and `rightSlot`. Both Back buttons are now labelled `common.back`. | Take behavior; re-apply the web and phone styles and keep the labels. |
| `sources/components/MessageView.tsx` | Restyled | Web user bubbles; replies use the Markdown `reply` tone; event rows (`AgentEventRow`); an `entrance` prop. On phones, tool cards sit on the 16 px gutter (`toolContainerPhone`). | Message kinds, pending and error frames, options, copy, safeguard, native island. | Keep web values in `Platform.select`; route new event types through `AgentEventRow`. |
| `sources/components/ChatList.tsx` | Extended | A row rises in once (first paint, live arrival, group reveal), never on scroll or recycle; the Jump to latest control is a pill. | Inverted list, windowing, grouping, focus, wheel handling. | Merge list logic; keep the entrance tracker hooks. |
| `sources/components/AgentWorkGroupHeader.tsx` | Restyled | A leading chevron that rotates, a hover wash, a member count, entrance props. | Labels, `aria-expanded`, equal row heights. | Keep the equal heights and the chevron-first layout. |
| `sources/components/tools/ToolView.tsx` | Extended | A web-only render path: `ToolLine` rows (icon, verb, mono argument, +N −N, live timer, spinner then check) expanding in place through `herd/session/Collapse`, a warning-edged permission card, and bare cards for todo lists and questions. Every card keeps a Details link to the detail screen, and an empty todo list keeps its tool line. | Tool classification, specific tool views, errors, native path, detail navigation. | Port changes into the shared code above the web branch and mirror new cases in the web path. |
| `sources/components/tools/PermissionFooter.tsx` | Restyled + Extended | Each provider's choices become one ordered list (same labels and handlers). Web adds number keys 1..n (`herd/session/permissionShortcuts.ts`) for the oldest pending card that is on screen (inside the chat list's scroll area and not covered by an overlay), and a decided state. The choices stretch in the phone layout (`useHerdPhoneLayout`) and are right-aligned otherwise, where upstream used the device rule. | Every handler, label and decision rule; native styles. | Add new choices to the provider's list. List order is the key number. |
| `sources/components/tools/views/TodoView.tsx` | Extended | `WebTodoCard` with a progress bar and done/total count. `readTodos` is exported for the web path in `ToolView`. | Parsing, native list. | Parsing changes apply to both. |
| `sources/components/tools/views/InlineQuestionForm.tsx` | Restyled | Web: an info-edged card, circular radios, the selection ring, staggered options and `aria-checked`. | Submit, cancel, Other, multi-select and secret logic. | Take logic; re-apply the web styles. |
| `sources/components/AgentInput.tsx` | Extended | Web chips after the + button (agent opens "Continue with…"; model, effort and permission open popovers built from the same option renderers as the settings popover); a context meter (`agentInput.context.remaining`, following the existing "Always show context size" setting); a theme-colored status row; restyled controls. Chip pickers close with `herd-pop-out`, keeping the last picker through `useHerdExit`. Up to 700 px wide, all four chips sit on their own sideways-scrolling row above the buttons, pickers open across the composer's width, and the composer pads 16 px. | All input behavior and shortcuts, the native composer, the combined settings popover in the + menu. | Keep `renderPermission/Model/EffortOptions` shared so new options appear in the chips too. |
| `sources/components/AgentGoalBar.tsx`, `QueuedMessagesPanel.tsx` | Restyled | Web single-line goal; single-line queued rows ("Sends after this turn · +N queued"). On phones the queue sits flush with the composer (`panelPhone`). | Actions and labels; native layouts. | Merge as-is; keep the web branches. |
| `sources/components/SafeguardReminderCard.tsx`, `ProviderContinuationLinks.tsx`, `markdown/MarkdownView.web.tsx`, `markdown/MarkdownView.types.ts` | Restyled | Card sizing and quote rule; molten continuation pills; the Markdown `reply` tone (list markers, links, inline code, code blocks, option pills). | Contrast values the tests assert; content and links. | Take behavior; keep the web styles and the `reply` tone. |
| `sources/components/sessionPresentation.test.ts`, `sources/components/tools/ToolView.test.ts` | Test | The header tests expect the phone layout on iPhone, Android and Web Mobile, and the native layout on iPad. `ToolView.test.ts` mocks `utils/responsive`. | Every other assertion. | — |

Open decisions recorded for the owner: the context meter follows the existing
"Always show context size" setting, which is off by default, so it shows only
at 10% or less remaining. The send button keeps its current behavior (Stop
stays in the + menu and on Esc).

## Side panels and Workspace

The right panel and the Workspace follow the mock: pill tabs for Changes
and Side chats, a Changes list with a branch summary, a grip divider, a
Workspace with folder-style tabs and a file bar, molten comment cards, and a
framed live view. Below 1,100 px on the web, phones included, they slide
over the chat as one sheet (see `SessionView.tsx` above). `herd/panels/panelColors.ts`
derives the few tints the mock uses that have no theme token (the fainter
hairlines, the active tab's rim, the panel and Workspace grounds) from KILV
tokens; a future theme token can replace each.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/components/FilesSidebar.tsx` | Restyled + Extended | Pill tabs (`herd/panels/PanelTab`): Changes with +N −N, then Side chats with its count, in fixed order and level with the chat header (`useHeaderHeight`); a closed Changes pill opens the panel. Picker cards with a description and shortcut; the add-panel menu inline under its "+" (`HerdMenuItem`, `herd-pop`); a branch and staged/unstaged summary; mono tree rows with per-file counts, a molten edge on the open file, folders through `HerdCollapse`; an optional `onHidePanel`; a `presented` flag (false while the sheet below 1,100 px is hidden) closes the add-panel menu and turns its shortcuts off, and Escape closes that menu before the sheet. The pills sit in their own strip, which shrinks and scrolls sideways when the panel is narrow (the phone sheet), so Add and Hide always fit. | Props, picker and menu actions and shortcuts (active only while the picker or menu shows), git refresh on mount, tree building, deleted-file handling, the native glass menu. | Take upstream data and behavior; keep the pill order (`ALL_PANELS`), the inline menu and the row styles. A new panel gets a pill and a picker card. |
| `sources/components/SideChatPanel.tsx` | Restyled + Extended | One pill per side chat (close on hover or when active); "+" beside the tabs and full screen at the row's end, replacing the toolbar row; a molten empty-state hero; the native phone full-screen host uses `HerdPanelScreenHeader` (collapse, parent-session subtitle, "+" in the header through `newChatInTabs={false}`); a restyled modal header. | Exports and props, `SideChatAccessButton` (native, unchanged), the `sideChat.close/expand/collapse/newChat` labels, unlabelled tab semantics, the Modal flow, the embedded `SessionViewLoaded`. | Take upstream behavior; keep the tab row (tabs, "+", spacer, full screen) and the full-screen header. |
| `sources/components/FileViewPanel.tsx` | Restyled | Preview/Edit as one sunken pair with a molten selected state (`aria-pressed`); labelled icon Download and Delete in the wide Workspace bar (`iconActions`); compact headers keep a labelled Download and native keeps a labelled Delete; an edit bar with the file name, save state, Cancel and a primary Save; bars on theme surfaces. | All read, write, delete, download, conflict and preview logic, and every accessible name. | Take upstream logic; keep the `iconActions` split. |

## Secondary pages

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/app/(app)/automations/index.tsx`, `components/HappyHerdAutomationDetail.tsx` | Replaced (layout) | Expandable rows, one open at a time, carrying every detail capability (Run now with Running then Completed, Pause/Resume, Edit or Open target, History, instructions, schedule, previous runs, Delete). The create/edit form is a sheet on desktop and inline on phones. | RPCs, exec-run polling, profiling, and every action. | Port behavior into the expanded row; keep one row open at a time. |
| `sources/components/SettingsView.tsx` | Extended | A Commanders row at the end of Features and a Streamline row beside Agent Defaults. In the phone layout (UI overhaul; on the web, below 700 px) the section list card (`SettingsSectionList`) follows the profile and replaces the Features group and the device pairing row, which only repeat its pages. | All rows, handlers and order; web windows 700 px and wider and native tablets keep every group. | Keep both rows. A new section page belongs in `SETTINGS_SECTIONS`, which also feeds the phone list. |
| `sources/app/(app)/settings/{index,account,appearance,agents,language,usage,voice,voice/language,connect/claude}.tsx` | Extended | Default export wrapped in `withSettingsFrame('<section>', Screen)`, so from 1,000 px on web the section list appears beside the page. On web the page keeps the same parent Views at every width, so a resize never remounts it, and a nested page's highlighted section still returns to that section's page. While the section list shows (web, 1,000 px and wider), `SettingsFrame` hides the Stack header and draws the page's 28 px title in the page, on the cards' left edge: the section's name, or a nested page's `title` passed to `withSettingsFrame` (`settings/voice/language.tsx` and `settings/connect/claude.tsx` pass `settingsVoice.preferredLanguage` and `settings.connectClaudeTitle`). `useSettingsFrameAction(Component)` shows a page's header control beside that title. | Bodies, props, routes, and phone and native rendering. | Merge body edits normally and keep the wrapper. A new settings page gets a `SETTINGS_SECTIONS` entry. |
| `sources/components/InboxView.tsx`, `FeedItemCard.tsx`, `app/(app)/session/[id]/info.tsx`, `app/(app)/machine/[id].tsx` | Restyled | `HerdItemGroup` / `HerdItem` drop-in imports (`herd/pages/HerdList.tsx`). | All JSX, data, actions and states. | Keep the import lines; new rows inherit the look. |
| `sources/app/(app)/projects/index.tsx`, `projects/[id].tsx` | Restyled | A card grid with session counts and recent avatars; the project detail has a header with Rename and its sessions in one card. | Data, actions, archive toggle, focus project. | Take behavior; keep the card layout. |
| `sources/app/(app)/changelog.tsx` | Restyled | Entries render through `HerdTimelineGroup`, centred at 760 px. | Parsing, links, images, Markdown, last-viewed state. | Keep `HerdTimelineGroup` and the timeline style. |
| `sources/components/FocusModeControl.tsx` | Restyled | The setup card uses `HerdSegmentedControl` for duration and chips for the project. The active state is a pill with a progress ring. Timers also store `startedAt` in the synced focus setting (unknown fields pass through older clients). | The amber transition, heading, testIDs and the focus data flow. | Take behavior; keep the ring maths in `herd/pages/focusProgress.ts`. |
| `sources/components/CommandPalette/{CommandPalette,CommandPaletteInput,CommandPaletteItem,CommandPaletteResults,CommandPaletteModal}.tsx` | Restyled | Sheet radius token, 640 px wide, amber section labels, an accent bar on the highlighted row, key caps, a hint footer, `aria-selected`. Under 700 px (`useHerdPhoneWeb`) the palette spans the window less 8 px a side, 8 px below the notch, up to 78% of the height or 640 px. It drops the key caps and the hint footer, a 44 px close button (`command-palette-close`) ends the input row, and rows are 48 px with their content on the 16 px gutter. | Commands, keyboard handling (Escape still closes), grouping, animations. | Take upstream logic; keep the style blocks, the footer and the phone branches. |
| `sources/components/CommandPalette/CommandPaletteProvider.tsx` | Extended | Adds a Commanders command (and publishes the opener, see *Desktop shell*). | All existing commands and shortcuts. | Keep the command after Create Commander. |

The new Commanders page (`app/(app)/commanders/index.tsx`) is HappyHerd-owned.
It reads memory files through the existing `machineReadFileWithinRoot` call,
bounded to each Commander's AgentContext folder, so older daemons show an
error with Retry.

Known gaps: the Usage page keeps its current look; Credentials, Connections,
Commander avatar settings and the Inbox update banner were outside this pass;
Settings sub-pages keep the base list look until `ItemGroup`/`Item` adopt the
`HerdList` treatment.

## Phone shell

Signed-in phones, both Web Mobile and the native iPhone and Android apps,
use the desktop shell at phone size (owner-approved phone design,
2026-09-27). The phone layout is `useHerdPhoneLayout()`
(`herd/mobile/useHerdPhone.ts`). On the web it is a window narrower than
700 px, and every window 700 px or wider gets the desktop layout, including a
1024 × 768 window and an iPad in portrait that the device rule in
`utils/responsive.ts` calls phones (owner decision, 2026-09-27). The apps keep
the device rule (`!useIsTablet()`), so a phone stays a phone in landscape.
Checks about the device itself keep the device rule: native headers and glass,
the typography floor against iOS Safari's input zoom, and the mobile PDF
preview. The HappyHerd top bar sits over every screen. The
desktop left panel is the page on the session list and slides in as a
drawer everywhere else. The tab bar, the phone home header and the floating
New session button were removed.

One spacing rule holds on every phone surface. Content sits 16 px inside the
surface that holds it. Lists of selectable rows pad the list 8 px and each
row 8 px, so a row's highlight reaches 8 px past its content. Bar controls
are 44 px targets placed so that their icon lands on the 16 px gutter.

Floating surfaces keep 8 px from the window's edges
(`HERD_PHONE_FLOAT_MARGIN`). Below 700 px on the web
(`herd/mobile/useHerdPhone.ts`, the same width rule as Streamline), menus
and pickers stay anchored cards that fit the window, with 48 px rows. Native
phones open them as bottom sheets that clear the home indicator. Dialogs rest
on a phone's bottom edge: page sheets (`HerdSheet`), the web alert and prompt
dialogs, and the duplicate and continuation sheets. Previews and other large
modals stay centered. Menus and sheets leave with motion on web
(`herd/presence.ts` `useHerdExit`); reduced motion closes them at once, and
native fades them.

| Inherited file | Status | HappyHerd change | Kept compatible | Porting future upstream changes |
|---|---|---|---|---|
| `sources/components/SidebarNavigator.tsx` | Extended (phones) | Signed in, the phone layout (`useHerdPhoneLayout`: the web below 700 px, native phones) renders `herd/shell/HerdPhoneTopBar` above the body and mounts `herd/shell/HerdPhoneDrawer` over it. Every other signed-in window gets the desktop shell, so the split follows the same rule instead of the device rule. The body's top inset is 0 and `HerdWindowInsetsContext` holds the window's insets whenever either top bar shows. Any navigation closes the drawer, and so does leaving the phone layout. | The hidden `front` drawer on phones, the desktop branch and the element order. | Put new phone shell controls in `HerdPhoneTopBar`, not in this file. |
| `sources/components/SidebarView.tsx` | Extended (phones) | `docked` renders the panel as the phone session list page. `list` replaces its session list, which `PhoneHome` uses for the native search and the dock inset. `settingsInNav` moves Settings into the icon row on native phones, so the home dock keeps the bottom edge. On phones, rows and controls put their content on the 16 px gutter, and the bottom inset pads the Settings row. Docked on phones and as the desktop panel, it shows `herd/shell/HerdConnectionStatus` above the list, the unhealthy-connection line the phone home header used to carry (`shouldShowHomeConnectionStatus`, the `status.*` copy). The phone drawer, an overlay over another page, does not. Choosing any destination closes the phone drawer, even the page already open underneath. | The desktop panel, every destination and hint, `VoiceAssistantStatusBar` and the archive toggle. | Take upstream structure; keep the three props and the phone spacing styles. |
| `sources/components/FlatSessionRow.tsx` | Restyled (phones) | Rows pad 8 px inside their 8 px inset (`rowPhone`), so titles sit on the gutter. | Everything in its *Desktop shell* row. | Keep `rowPhone` last in the row style. |
| `sources/hooks/useNavigateToSession.ts` (+ test) | Extended (phones) | A row press (`useSessionPressHandlers`) closes the phone drawer before it navigates, so choosing the session already open closes the drawer too. | Preparation on touch-down, tracking and the encoded destination. | Keep the close before `navigateToSession`. |
| `sources/components/ProjectGroup.tsx` (+ test) | Extended (phones) | On phones the workspace "+" closes the drawer before it opens New Session or the home dock's composer. | The draft prefill for the group's checkout, and the home dock request with its `/new` fallback. | Keep the close before `requestHomeDockFocus`. |
| `sources/components/TabBar.tsx` | Removed | Deleted with the tab bar. The drawer's rows and the top bar reach its destinations. | — | Do not port upstream tab bar changes; give a new destination a row in `SidebarView`. |
| `sources/components/MainView.tsx` | Replaced (phones) | Only the panel's session list (`variant="sidebar"`) and the blank tablet index (`variant="phone"`) remain. The phone home moved to `herd/mobile/PhoneHome.tsx`: the docked panel, the native session search and the native `HomeDock`. | The sidebar list with its loading and empty states, and the blank tablet index. | Port phone home changes (dock, search, empty states) into `PhoneHome`, and sidebar list changes here. |
| `sources/app/(app)/index.tsx` | Extended | Signed in, wider layouts render `herd/pages/HerdLanding` (the mock's landing and horizon) beside the left panel instead of `MainView`'s blank `phone` variant; the phone layout renders `herd/mobile/PhoneHome`. | The signed-out branch. | Keep this split when merging. |
| `sources/app/(app)/_layout.tsx` | Extended (phones) | `screenOptions` gives the phone layout under the top bar `createHeader` (`navigation/Header`) on iOS too, as on Android and the web, so signed-in iPhone pages get the phone title row and Back; the iPad and signed-out iPhone pages keep UIKit's header. It hides Back (`headerBackVisible: false`) on the routes the drawer and top bar open directly (`herd/shell/phoneRoutes.ts`), except in the iOS app on a Mac, which keeps that Back at any window size, although the device rule calls a small Mac window a phone. Pages opened from those routes keep Back. | Every screen's options. | Keep `phone` in `shouldUseCustomHeader`, and the `isRunningOnMac()` exception in the Back rule. Add a new drawer destination to `HERD_PHONE_TOP_LEVEL_ROUTES`. |
| `sources/components/navigation/Header.tsx` | Restyled (phones) | Phone web (below 700 px): an opaque `surface` bar with no shadow (skips `styles.shadow`), 56 px, a labelled Back (`header-back`), a left-aligned 16 px title and a 12 px faint subtitle. Under the phone top bar, on web and native, the header is the page's title row: opaque, with no glass or hairline, and Back is a 44 px square whose arrow lands on the gutter. The row ends 4 px from the edge, so a 44 px control at its end has its icon on the gutter. The title is the page's, left-aligned at 24 px, or 22 px beside Back, and Back is the mock's arrow on web and native alike. | `goBack`, custom `headerLeft` / `headerRight`, and the tablet, desktop and signed-out headers. Back is hidden only on the web at 700 px and wider (`shouldHideBackButton`); native tablets, the iOS app on a Mac included, show it. The phone checks use `useHerdPhoneLayout`. | Keep the `webPhone*` and then the `phoneShell*` styles last in each style array. |
| `sources/app/(app)/settings/index.tsx` | Extended | On a custom server, the title row ends in `herd/pages/SettingsServerButton`, which opens `/server`, on every layout. It is the only signed-in way to the server configuration; the phone Settings tab's header used to carry it. In the desktop frame the button sits beside the page title through `useSettingsFrameAction`. | The page, its frame and its sections. | Keep the `Stack.Screen` `headerRight` rule, independent of the layout. |
| `sources/app/(app)/{automations,projects}/index.tsx` | Restyled (phones) | The compact page content sits on the 16 px gutter (was 14 px), as on the HappyHerd-owned Commanders page. | Everything else. | Keep `contentCompact` at 16. |
| `sources/components/InboxView.tsx`, `sources/app/(app)/inbox/index.tsx` | Extended (phones) | `InboxView` draws its title row with Find Friends on tablets and under the phone top bar. The route renders `InboxView` alone, because the separate phone header was removed. | The feed, friend requests and their actions. | Merge normally; keep `showHeader`. |
| `sources/components/HomeHeader.test.ts` | Test | The phone home test and its mocks moved to the phone shell browser suite (`herd/mobile/mobileShell.browser.test.ts`). | Every native assertion. | — |
| `sources/components/herd/HerdPopover.tsx` (HappyHerd-owned) | Extended (phones) | Under 700 px on the web the card keeps 8 px from the window's edges, never grows wider than the window less that margin, and pads 8 px around 48 px rows whose content sits on the gutter (`useHerdTouchMenu`). Native phones render the content in a `HerdBottomSheet`. | The desktop card, anchoring and Escape. | Not inherited; listed here because every top bar menu and Streamline chip picker gets the phone metrics through it. |
| `sources/modal/components/BaseModal.tsx`, `CustomModal.tsx`, `sources/modal/types.ts` | Extended (phones) | `placement="dialog"` (a `presentation: 'dialog'` field on a `Modal.show` config) rests the content on the bottom edge in the phone layout (`useHerdPhoneLayout`: the web below 700 px, native phones), 8 px from its sides and bottom plus the home indicator, at that full width. The bottom gap is the content's margin, because iOS keyboard avoidance replaces the container's bottom padding with the keyboard's height. In both placements the side padding, the dialog's 8 px or the centered 20 px, includes the window's left and right insets, so content clears a landscape phone's notch. `HerdPhoneDialogContext` (`herd/mobile/phoneDialog.ts`) tells the content. `HerdModalContentWidthContext` (`herd/modalArea.ts`) gives it the width inside that padding (`resolveModalContentWidth`), which the image previews size to. | The centered default for every other modal (image previews, the side chat modal), the backdrop, keyboard avoidance and the fade. | Keep the `placement` prop and both context providers when merging, and the side-inset padding last in the container style, since an inline `padding` overrides earlier sides on the web. A new small dialog passes `presentation: 'dialog'`. |
| `sources/components/markdown/MarkdownView.tsx`, `markdown/MarkdownView.web.tsx`, `sources/components/tools/views/FileView.tsx` (+ test) | Extended | The native Markdown and attachment image previews take `useHerdModalPreviewWidth` (`herd/modalArea.ts`): the modal's content width, at most 1,120 px, where they took the window less 32 px. On an 844 × 390 iPhone with 47 px side insets that is 710 px, so the card and its Close button stay on screen. The web Markdown preview (`.hh-markdown-image-modal`) is at most the window less 40 px and both side insets (`env(safe-area-inset-*)`), and `box-sizing: border-box` keeps its 16 px padding inside that width. | The 1,120 px cap, the height rule, zoom, the Close button and every label. | Keep the hook and the CSS width when merging; a new preview in a centered modal sizes to `useHerdModalPreviewWidth`. `herd/modalArea.ts` imports only React, which keeps `react-native-safe-area-context` out of `MarkdownView`'s imports, so do not read the insets there directly. |
| `sources/modal/components/WebAlertModal.tsx`, `WebPromptModal.tsx` | Extended (phones) | Both open with `placement="dialog"` and span the window in the phone layout (below 700 px). | Their look, buttons, input and results. | Keep the placement and the phone width. |
| `sources/components/DuplicateSheet.tsx`, `sources/utils/duplicateSheetLayout.ts` (+ test), `sources/hooks/useSessionQuickActions.ts` | Extended (phones) | The duplicate and continuation sheets open as dialogs (`presentation: 'dialog'`). On a phone, `getDuplicateSheetFrame(window, true)` spans the window less 8 px a side. Both sheets pass the window's insets as its third argument, so their width leaves the left and right insets clear in either placement. | Sheet contents, the frame rule elsewhere, and every action. | Keep the second and third arguments and the presentation field. |


## HappyHerd-owned modules

These files do not exist upstream; upstream merges never conflict with them.

| File | Purpose |
|---|---|
| `sources/components/herd/motion.ts` | Motion scale and helpers (`HERD_MOTION`, `herdWebClasses`, `herdStaggerClass`) for applying the CSS motion classes through Unistyles `_web._classNames`. |
| `sources/components/herd/motion.test.ts` | Guards the motion classes, reduced-motion coverage and the overhaul tokens in both themes. |
| `sources/components/herd/SegmentedControl.tsx` | Equal-width segmented control with a sliding selection thumb; `size="touch"` gives phones 44 px segments. |
| `sources/components/herd/HerdPopover.tsx` | Anchored dropdown (`HerdPopover`, `HerdMenuItem`, `HerdMenuTitle`, `HerdMenuSeparator`) for top bar menus: a touch-size card on phone web, a bottom sheet on native phones. It re-exports `useHerdEscapeToClose`. |
| `sources/components/herd/escape.ts` | `useHerdEscapeToClose`, the capture-phase Escape rule for overlays: a stack in which the newest open overlay answers, with an optional `accepts` check. |
| `sources/components/herd/presence.ts` | `useHerdExit` and `HERD_EXIT`: an overlay keeps its last anchor, or open state, while its exit class plays. |
| `sources/components/herd/HerdExitLayer.web.tsx` (and a native `HerdExitLayer.tsx` that renders nothing) | The inert, pointer-transparent body layer a closed overlay leaves on, after its Modal has already ended. |
| `sources/components/herd/panels/*` | Side panel parts: `PanelTab` (pill tab with count or line badges and a close button that shows on hover, keyboard focus or when active), `PanelIconButton`, `PanelGrip` (the resize pill), `PanelOverlay` (scrim, Escape that skips text fields, the sheet width rule and the phone's 16 px strip), `PanelScreenHeader` (phone back header) and `panelColors`. |
| `sources/components/{DesktopFileWorkspace,SessionSidebarDivider,LocalhostLiveView.web,InlineCommentReview.web}.tsx`, `sources/components/sideChatPresentation.ts`, `sources/app/(app)/workspace/index.tsx` | HappyHerd-owned Workspace and panel files, restyled for the panels: the Workspace tabs, file bar and `overlay` split mode, the grip divider, the framed live view, molten comment cards and a docked review bar, the overlay presentation rule (`rightPanelPresentation: 'overlay'` on the web below 1,100 px, phones included), and the Workspace page on theme tokens. |
| `sources/components/herd/mobile/useHerdPhone.ts` | The web breakpoint. `useHerdPhoneLayout` is the phone layout for the shell, pages, sheets and dialogs: the web below 700 px, native phones by device. `useHerdPhoneWeb` is its web half, for the web-only menu cards. `HERD_PHONE_FLOAT_MARGIN` is the 8 px floating surfaces keep from a phone's edges. |
| `sources/components/herd/mobile/HerdBottomSheet.tsx` | The native phone menu sheet: scrim, a drag handle that is also a labelled Cancel button (a drag past 72 px or a flick dismisses), home-indicator padding, a fade on native and `herd-sheet-up` / `herd-sheet-down` on web. On native it rises above the keyboard that a field in it opens, such as a picker's Search, and a sheet taller than the room left shrinks to fit below the status bar. `HerdTouchMenuContext` / `useHerdTouchMenu` give its rows, and a phone web card's, touch size. It reads the window's safe-area insets (`useWindowSafeAreaInsets`), so a sheet opened in a screen under the phone top bar still clears the status bar. |
| `sources/components/herd/mobile/phoneDialog.ts` | `HerdPhoneDialogContext` / `useHerdPhoneDialog`: whether `BaseModal` is presenting a dialog on a phone's bottom edge. |
| `sources/components/herd/modalArea.ts` | `HerdModalContentWidthContext` and `resolveModalContentWidth`: the width `BaseModal` leaves its content, the window less the placement's side padding and the side safe-area insets. `useHerdModalPreviewWidth`: a centered preview's width, that content width or, outside a modal, the window less 40 px, at most the given maximum. It imports only React. |
| `sources/components/herd/mobile/PhoneHome.tsx` | The phone session list: the docked left panel, the native session search and the native home dock. |
| `sources/components/herd/shell/HerdTopBar.tsx` | Desktop top bar: panel toggle, Zen, brand, command search, Focus mode, Inbox bell and machine menu. |
| `sources/components/herd/shell/HerdPhoneTopBar.tsx` | Phone top bar: the panel toggle (hidden on the session list), the brand, search (the command palette on web, the session search on native), Focus mode, the Inbox bell and the machine pill, as 44 px targets on the gutter. The machine name steps aside below 360 px and during Focus. |
| `sources/components/herd/shell/HerdPhoneDrawer.tsx` | The left panel as a phone drawer, 92% of the width up to 360 px, over a scrim. The scrim, a drag or flick left, Escape, Android Back and any navigation close it; a web touch swipe from the left edge opens it. It slides through `Animated` on web and native, and reduced motion makes it instant. |
| `sources/components/herd/shell/phoneShell.ts` | Phone shell state: whether the drawer and the native session search are open, and the search query. |
| `sources/components/herd/shell/phoneRoutes.ts` | The routes the drawer and top bar open directly, which show no Back on phones. |
| `sources/components/herd/shell/topBarLayout.ts` | `HerdTopBarLayoutContext`, which tells shared top bar controls whether they sit in the desktop or the phone bar, plus the phone bar height and touch target. |
| `sources/components/herd/shell/HerdTopBarIconButton.tsx` | Square icon control for the top bar; a 44 px target in the phone bar. |
| `sources/components/herd/shell/HerdHeaderIconButton.tsx` | A 44 px icon control for the end of a phone page's title row. |
| `sources/components/herd/shell/HerdConnectionStatus.tsx` | The connection line on the phone session list and the desktop panel: a status dot and the `status.*` label while the connection is not healthy, announced politely. |
| `sources/components/herd/pages/SettingsServerButton.tsx` | The Settings title row's server configuration button, shown on a custom server on every layout. |
| `sources/components/herd/shell/HerdInboxBell.tsx` | Inbox bell with the friend-request count (or an unread dot) and the Updates dropdown. |
| `sources/components/herd/shell/HerdMachineMenu.tsx` | Machine pill and menu. It shows and switches the machine New Session uses (`useNewSessionDraft.setMachineId`). In the phone bar the pill sits in a 44 px target that may shrink, so a long name ellipsizes instead of pushing the bar off screen, and `nameHidden` leaves only its status dot. |
| `sources/components/herd/shell/HerdSidebarEdgeToggle.tsx` | Secondary collapse handle on the panel edge. |
| `sources/components/herd/shell/sidebarTransition.tsx` | Collapse sequencing (`useHerdSidebarTransition`, `HerdSidebarFrame`). |
| `sources/components/herd/shell/sidebarShortcut.ts` | The ⌥⌘B chord and the shared collapse toggle. |
| `sources/components/herd/shell/commandPaletteBridge.ts` | `HerdCommandPaletteContext` for opening the palette from a control. |
| `sources/components/herd/shell/selectionGlide.ts` | Web FLIP glide for the session selection. |
| `sources/components/herd/shell/HerdSessionRowParts.tsx` | Row selection ring, ⋯ button, row data attributes and the touch-only long press (`useHerdRowLongPress`), shared by both session row components. |
| `sources/components/herd/shell/sessionRowPresentation.ts` | Row status line and agent chip rules. |
| `sources/components/herd/shell/windowInsets.ts` | `HerdWindowInsetsContext` / `useWindowSafeAreaInsets` for fullscreen content inside the shell body. |
| `sources/utils/newSessionMachine.ts` | `resolveNewSessionMachine`, the default-machine rule shared by New Session and the top bar's machine pill. |
| `sources/components/herd/newSession/StreamlineSections.tsx` | Streamline's Commander cards, working-folder cards (with the GitHub badge) and project chips. Phones get 104 px square Commander cards and folder chips (the name, then the machine) in rows that scroll sideways edge to edge, and 44 px project chips that wrap. |
| `sources/components/herd/newSession/StreamlineComposer.tsx` | Streamline composer chips and the defaults summary line. |
| `sources/app/(app)/settings/streamline.tsx` | Streamline settings: default mode, default agent, the GitHub worktree rule, and per-agent model/effort/permission defaults from a capability source machine. |
| `sources/sync/streamlineDefaults.ts` | Streamline code defaults and `resolveStreamlineSelection` (catalog-validated model, effort and permission). |
| `sources/sync/githubRepository.ts` | Git and GitHub detection for a machine folder through the existing bash RPC (plain `git`, cached). |
| `sources/hooks/useStreamlineLocations.ts` | Working folders from favorites, recent folders and Commander workspaces. |
| `sources/utils/normalizeMachinePath.ts` | Shared machine-path identity for Streamline. |
| `sources/components/herd/session/*` | Session screen parts: `ToolLine` and `toolLineModel`, `Collapse` (a collapsed body stays mounted on web but is `inert`), `color` (`herdAlpha`, which mixes the CSS-variable colors Unistyles hands web style factories with `color-mix`), `entranceMotion`, `permissionShortcuts`, `ComposerChips` and `composerChipModel`, `HeaderButton` (a 44 px target around its frame on phones), `SessionHeaderActions`. |
| `sources/components/herd/pages/*` | Page parts: `HerdPage` (header, buttons, chips, labels, notices, empty states), `HerdSheet` (a centered card, and on phones the same card on the bottom edge, 8 px from the window's sides and bottom), `HerdCollapse`, `HerdList` (drop-in `ItemGroup`/`Item`), `HerdTimeline`, `SettingsFrame` (desktop section list, and `SettingsSectionList`, the phone Settings home's card), `commanderMemory`, `focusProgress`. `herd/session/Collapse` and `HerdCollapse` do the same job; merge them the next time either changes. |
| `sources/components/herd/pages/HerdLanding.tsx`, `HerdLandingArt.tsx`, `HerdLandingArt.web.tsx` | The signed-in landing: the gradient brush mark, title, subtitle, Start New Session / Automations / Workspace (Workspace behind `machineWorkspace`), the What's new pill for the latest changelog entry and, on web, the horizon backdrop (the body fading into `kilv.bg`, the masked molten rim and its glow). Colors come from kilv tokens through `herdAlpha` and `color-mix`; `herd-rise` and `herd-fade` respect reduced motion. Native tablets get it without the horizon. |
| `sources/app/(app)/commanders/index.tsx` | The Commanders page. |
| `sources/app/(app)/settings/{connections,credentials,features}.tsx` | HappyHerd-owned settings pages. Their default exports are wrapped in `withSettingsFrame`, like the inherited ones. |
| `sources/components/SidebarNavigationButton.tsx` | HappyHerd-owned; restyled with tokens and given `active`, `emphasis` and `quiet` variants. |
| `sources/components/sidebarNavigationLayout.ts` | HappyHerd-owned; the boundary-toggle, persistent-header and header-clearance helpers were removed with those controls. |
