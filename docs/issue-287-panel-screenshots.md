# PR #289 — per-panel screenshot review

Reviewer request: [PR comment, September 20, 2026](https://github.com/NickGuAI/HappyHerd/pull/289#issuecomment-5746628262): “for verification, we should attach screenshot of each modified panels.”

This index maps **84 panels / 380 screenshots** to the actual production sources changed by the KILV rebuild. The direct TSX reconciliation covers **117 of 118 changed files** with screenshots; every remaining file is named below. Several files form one visible panel; shared controls can appear in more than one panel. A source imported into a bundle is not by itself a coverage claim—the table names the scene where the owner is visibly rendered.

**Source boundary:** UI diff `189c504b..a38fae51`. Screenshot scripts and fixtures add review evidence without changing production UI. Shared theme, font, style and packaging changes are represented by their consuming panels; this index complements the [945-path disposition](issue-287-ui-disposition.tsv).

## Evidence types

- **Production export:** 20 images from the actual exported Web app, including its real Unistyles runtime and route shell. The local host has no authenticated backend. Restore QR ready/success is unproved.
- **Component fixture:** 360 images of production components with synthetic account/session/project/automation data. Real theme, Typography, font files and Expo vector-icon glyphs are retained. Some neighboring avatar/provider/status renderers are fixture replacements and are not claimed as their own visual evidence. Environment records name every mocked module, native bridge and the real source graph.
- **Native/live gaps:** Web emulation and DOM rendering of native source do not prove installed iOS/Android/macOS/Windows clients, physical Safari keyboard/zoom or authenticated live workflows. The existing [journey acceptance matrix](issue-287-ui-acceptance.md) remains separate.

## Panel index

| Group | Panel | Changed presentation | Evidence | Images |
|---|---|---|---|---|
| production | [Signed-out landing](acceptance/issue-287/panels/production/README.md#panel-landing) | KILV welcome artwork, warm light/dark backgrounds, Space Grotesk headings and shared primary actions. | `production-export` | 4 |
| production | [Restore with Secret Key](acceptance/issue-287/panels/production/README.md#panel-restore-key) | Themed secret-key form, readable mobile input and KILV restore action. | `production-export` | 4 |
| production | [Link a mobile device](acceptance/issue-287/panels/production/README.md#panel-restore-device) | KILV pairing instructions and alternate restore action; offline pairing state is shown. | `production-export` | 4 |
| production | [Server configuration](acceptance/issue-287/panels/production/README.md#panel-server-config) | KILV grouped server form, URL input and readable settings actions. | `production-export` | 4 |
| production | [Changelog with KILV release entry](acceptance/issue-287/panels/production/README.md#panel-changelog) | KILV release-note typography and grouped Markdown surfaces, including the terminal input layout fix. | `production-export` | 4 |
| routes | [Artifacts](acceptance/issue-287/panels/routes/README.md#panel-artifacts) | Space Grotesk artifact-list copy and KILV list/empty-state presentation. | `component-fixture` | 4 |
| routes | [Artifact details](acceptance/issue-287/panels/routes/README.md#panel-artifact) | KILV artifact title, metadata and rendered content presentation. | `component-fixture` | 4 |
| routes | [New artifact editor](acceptance/issue-287/panels/routes/README.md#panel-artifact-new) | KILV typography and themed input/editor presentation for a new artifact. | `component-fixture` | 4 |
| routes | [Edit artifact](acceptance/issue-287/panels/routes/README.md#panel-artifact-edit) | KILV typography and themed input/editor presentation for an existing artifact. | `component-fixture` | 4 |
| routes | [Friends](acceptance/issue-287/panels/routes/README.md#panel-friends) | KILV friend-list typography and grouped row presentation. | `component-fixture` | 4 |
| routes | [Find friends](acceptance/issue-287/panels/routes/README.md#panel-friend-search) | KILV search field, result rows and friend actions. | `component-fixture` | 4 |
| routes | [Inbox](acceptance/issue-287/panels/routes/README.md#panel-inbox) | KILV inbox headings, activity rows and secondary text hierarchy. | `component-fixture` | 4 |
| routes | [Machine details](acceptance/issue-287/panels/routes/README.md#panel-machine) | KILV machine settings groups, readable paths and machine action presentation. | `component-fixture` | 8 |
| routes | [Session details](acceptance/issue-287/panels/routes/README.md#panel-session-info) | KILV navigation/row surfaces, shared typography, compact controls and semantic status treatment. | `component-fixture` | 8 |
| routes | [Recent sessions](acceptance/issue-287/panels/routes/README.md#panel-recent) | KILV navigation/row surfaces, shared typography, compact controls and semantic status treatment. | `component-fixture` | 4 |
| routes | [Account settings](acceptance/issue-287/panels/routes/README.md#panel-account) | KILV form surfaces, readable primary/secondary actions, Space Grotesk labels and 16px inputs. | `component-fixture` | 8 |
| routes | [Synthetic account key](acceptance/issue-287/panels/routes/README.md#panel-account-key) | KILV form surfaces, readable primary/secondary actions, Space Grotesk labels and 16px inputs. | `component-fixture` | 4 |
| routes | [Agent defaults](acceptance/issue-287/panels/routes/README.md#panel-agents) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 8 |
| routes | [Appearance](acceptance/issue-287/panels/routes/README.md#panel-appearance) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 8 |
| routes | [Features](acceptance/issue-287/panels/routes/README.md#panel-features) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 6 |
| routes | [Commander profile pictures](acceptance/issue-287/panels/routes/README.md#panel-commanders) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 4 |
| routes | [Interface language](acceptance/issue-287/panels/routes/README.md#panel-language) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 4 |
| routes | [Voice settings](acceptance/issue-287/panels/routes/README.md#panel-voice) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 8 |
| routes | [Voice language](acceptance/issue-287/panels/routes/README.md#panel-voice-language) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 4 |
| routes | [Connect Claude](acceptance/issue-287/panels/routes/README.md#panel-claude) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 4 |
| routes | [Connect terminal](acceptance/issue-287/panels/routes/README.md#panel-terminal) | Shared KILV palette, typography, border geometry and interactive control styling. | `component-fixture` | 4 |
| routes | [Select text](acceptance/issue-287/panels/routes/README.md#panel-text-selection) | Shared KILV palette, typography, border geometry and interactive control styling. | `component-fixture` | 4 |
| routes | [Terminal connection request](acceptance/issue-287/panels/routes/README.md#panel-terminal-confirm) | Shared KILV palette, typography, border geometry and interactive control styling. | `component-fixture` | 4 |
| routes | [Invalid terminal link](acceptance/issue-287/panels/routes/README.md#panel-terminal-invalid) | Shared KILV palette, typography, border geometry and interactive control styling. | `component-fixture` | 4 |
| routes | [User profile](acceptance/issue-287/panels/routes/README.md#panel-user) | Shared KILV palette, typography, border geometry and interactive control styling. | `component-fixture` | 4 |
| routes | [Settings](acceptance/issue-287/panels/routes/README.md#panel-settings) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 8 |
| routes | [Saved credentials](acceptance/issue-287/panels/routes/README.md#panel-credentials) | KILV form surfaces, readable primary/secondary actions, Space Grotesk labels and 16px inputs. | `component-fixture` | 6 |
| routes | [Provider usage](acceptance/issue-287/panels/routes/README.md#panel-usage) | KILV settings rows and grouped panels, Space Grotesk labels, JetBrains Mono data and themed controls. | `component-fixture` | 4 |
| chat | [Conversation transcript](acceptance/issue-287/panels/chat/README.md#panel-chat-list) | Transcript text and work summaries use the shared font and theme hierarchy. | `component-fixture` | 4 |
| chat | [Human and agent messages](acceptance/issue-287/panels/chat/README.md#panel-messages) | Human text and formatted agent replies use themed surfaces and shared typography. | `component-fixture` | 4 |
| chat | [Goal, completed work and message queue](acceptance/issue-287/panels/chat/README.md#panel-goal-work-queue) | Goal and queue text adopt the shared type hierarchy and theme colors. | `component-fixture` | 4 |
| chat | [Empty conversation](acceptance/issue-287/panels/chat/README.md#panel-empty) | Host, path and empty-message copy use the shared display and monospaced fonts. | `component-fixture` | 4 |
| chat | [Session status and connected voice](acceptance/issue-287/panels/chat/README.md#panel-status) | Model/context status and voice controls use themed colors and shared fonts. | `component-fixture` | 4 |
| chat | [Attachment source menu](acceptance/issue-287/panels/chat/README.md#panel-attachment-menu) | Device-file and photo actions adopt the shared menu border, radius, palette and typography. | `component-fixture` | 4 |
| chat | [Agent question modal](acceptance/issue-287/panels/chat/README.md#panel-question) | Question headings, options, selected controls and submit action use the shared KILV palette and fonts. | `component-fixture` | 8 |
| chat | [Provider continuation links and sheet](acceptance/issue-287/panels/chat/README.md#panel-continuation) | Continuation text, provider choices and links adopt shared typography and themed surfaces. | `component-fixture` | 4 |
| chat | [Session actions popover](acceptance/issue-287/panels/chat/README.md#panel-session-actions) | Action rows and destructive state use themed colors and shared type. | `component-fixture` | 4 |
| chat | [Native code editor](acceptance/issue-287/panels/chat/README.md#panel-native-editor) | The native multiline editor now derives its monospaced face from Typography.mono(). | `component-fixture` | 4 |
| chat | [Compact tool and provider command results](acceptance/issue-287/panels/chat/README.md#panel-tool-shells) | Tool labels and Codex/Gemini command renderers adopt shared type and KILV command colors. | `component-fixture` | 4 |
| chat | [Tool detail and error result](acceptance/issue-287/panels/chat/README.md#panel-tool-full) | Tool detail sections use themed headings, code surfaces and error styling. | `component-fixture` | 4 |
| chat | [Tool execution and permission states](acceptance/issue-287/panels/chat/README.md#panel-tool-states) | Running/completed/error indicators and permission actions use semantic theme colors. | `component-fixture` | 4 |
| chat | [Compact patch, expanded patch and multiple edits](acceptance/issue-287/panels/chat/README.md#panel-tool-patch) | Patch labels and edit summaries adopt the shared typography and themed action colors. | `component-fixture` | 4 |
| chat | [Image attachment result](acceptance/issue-287/panels/chat/README.md#panel-tool-file) | Attachment filename uses the shared typography alongside the themed image boundary. | `component-fixture` | 4 |
| chat | [Inline question form](acceptance/issue-287/panels/chat/README.md#panel-tool-question) | Question labels, options and submit/cancel actions adopt the shared theme and type. | `component-fixture` | 8 |
| chat | [Subagent trace, task activity and checklist](acceptance/issue-287/panels/chat/README.md#panel-tool-agents) | Agent outcomes, nested activity and task checklist text adopt shared fonts and semantic status colors. | `component-fixture` | 4 |
| chat | [Searchable path selector](acceptance/issue-287/panels/chat/README.md#panel-selector) | Search and selected/favorite rows use the shared palette, borders, radii and fonts. | `component-fixture` | 4 |
| chat | [Destructive confirmation modal](acceptance/issue-287/panels/chat/README.md#panel-alert) | Alert content uses the dark lifted surface and themed destructive action. | `component-fixture` | 4 |
| chat | [Session conversation and composer](acceptance/issue-287/panels/chat/README.md#panel-session) | Session surfaces, reply island and composer adopt the shared KILV palette and typography. | `component-fixture` | 4 |
| chat | [Message composer with draft](acceptance/issue-287/panels/chat/README.md#panel-composer) | Composer border, input text and send/attachment controls use KILV tokens. | `component-fixture` | 4 |
| chat | [Native Markdown, code and terminal renderers](acceptance/issue-287/panels/chat/README.md#panel-native-text) | Native text renderers use Space Grotesk and JetBrains Mono with themed code and terminal surfaces. | `component-fixture` | 4 |
| chat | [Shared button and item states](acceptance/issue-287/panels/chat/README.md#panel-controls) | Buttons and item groups use KILV borders, radii, colors and typography across action states. | `component-fixture` | 4 |
| chat | [Text entry modal](acceptance/issue-287/panels/chat/README.md#panel-prompt) | Prompt content and input use shared typography, themed surfaces and focus styling. | `component-fixture` | 4 |
| workspace | [Desktop navigation and project/session groups](acceptance/issue-287/panels/workspace/README.md#panel-sidebar-projects) | Sidebar actions and session rows use KILV surfaces, compact geometry and Space Grotesk typography. | `component-fixture` | 4 |
| workspace | [Active session workspace groups](acceptance/issue-287/panels/workspace/README.md#panel-session-workspace-groups) | Workspace and project groups use semantic borders, status tones and compact session row spacing. | `component-fixture` | 4 |
| workspace | [Project detail and assigned sessions](acceptance/issue-287/panels/workspace/README.md#panel-project-detail) | Project detail actions, grouped session cards and mono workspace metadata inherit KILV tokens. | `component-fixture` | 4 |
| workspace | [File workspace · Markdown preview](acceptance/issue-287/panels/workspace/README.md#panel-workspace-markdown) | File tabs, review toolbar and Markdown source-line controls share KILV surfaces and mono labels. | `component-fixture` | 4 |
| workspace | [File workspace · source and diff controls](acceptance/issue-287/panels/workspace/README.md#panel-workspace-source) | Source review uses the KILV surrounding toolbar and tokenized syntax/line-review surfaces. | `component-fixture` | 4 |
| workspace | [Localhost live preview workspace](acceptance/issue-287/panels/workspace/README.md#panel-workspace-live) | Live preview controls inherit the workspace material and typography while retaining real iframe behavior. | `component-fixture` | 4 |
| workspace | [Workspace file link and feedback composer](acceptance/issue-287/panels/workspace/README.md#panel-workspace-link) | Linked-file chrome and feedback composer use KILV input, action and border tokens. | `component-fixture` | 4 |
| workspace | [New session · model, machine, workspace and prompt](acceptance/issue-287/panels/workspace/README.md#panel-new-session) | New-session machine, provider and prompt controls adopt the KILV palette and compact spacing. | `component-fixture` | 4 |
| workspace | [New session · machine folder picker](acceptance/issue-287/panels/workspace/README.md#panel-new-session-path) | Machine path browser uses semantic selection surfaces, compact folder rows and mono paths. | `component-fixture` | 4 |
| workspace | [Home dock · start a session](acceptance/issue-287/panels/workspace/README.md#panel-home-dock) | Home composer and machine/model pickers adopt the KILV palette, mono metadata and flatter geometry. | `component-fixture` | 4 |
| workspace | [Empty sessions · terminal connection onboarding](acceptance/issue-287/panels/workspace/README.md#panel-empty-onboarding) | Empty-session onboarding uses the KILV artwork, typography and terminal command surface. | `component-fixture` | 4 |
| workspace | [No active sessions · connected machine](acceptance/issue-287/panels/workspace/README.md#panel-empty-tablet) | Empty connected-machine state uses the KILV icon, action contrast and typography. | `component-fixture` | 4 |
| workspace | [Signed-out welcome and connect](acceptance/issue-287/panels/workspace/README.md#panel-signed-out) | Welcome artwork, headline and connect/restore controls use the KILV visual system. | `component-fixture` | 4 |
| workspace | [Source code editor](acceptance/issue-287/panels/workspace/README.md#panel-code-editor) | Source editor uses KILV foreground/background tokens and JetBrains Mono. | `component-fixture` | 4 |
| workspace | [Automations · scheduled and paused tasks](acceptance/issue-287/panels/workspace/README.md#panel-automations-list) | Automation navigation, filters and list items use semantic KILV surfaces and dense rows. | `component-fixture` | 4 |
| workspace | [Automation · create a scheduled job](acceptance/issue-287/panels/workspace/README.md#panel-automation-create) | Automation form fields, scheduling controls and footer actions adopt KILV surfaces and typography. | `component-fixture` | 8 |
| workspace | [Automation · instruction, schedule and history](acceptance/issue-287/panels/workspace/README.md#panel-automation-detail) | Automation details, instruction preview and schedule sections use KILV borders and typography. | `component-fixture` | 4 |
| workspace | [Automation card · expanded actions and history](acceptance/issue-287/panels/workspace/README.md#panel-automation-card) | Expanded automation cards use KILV surfaces, status dots, tags and action colors. | `component-fixture` | 4 |
| workspace | [Command palette · navigation and session actions](acceptance/issue-287/panels/workspace/README.md#panel-command-palette) | Command search, selected rows and shortcut hints use KILV palette, corners and type. | `component-fixture` | 4 |
| workspace | [Duplicate session · choose a rewind point](acceptance/issue-287/panels/workspace/README.md#panel-duplicate-session) | Rewind selection sheet uses semantic KILV surfaces, selected rows and action colors. | `component-fixture` | 4 |
| workspace | [Project and session Git status indicators](acceptance/issue-287/panels/workspace/README.md#panel-git-status) | Git indicators preserve added/removed meaning while adopting KILV palette and mono counts. | `component-fixture` | 4 |
| workspace | [Inline file review · pinned comment and draft](acceptance/issue-287/panels/workspace/README.md#panel-inline-comment-review) | Pinned comment cards use KILV seams, border glow, mono labels and input/action tones. | `component-fixture` | 4 |
| workspace | [Files sidebar · changes, workspace and side-chat actions](acceptance/issue-287/panels/workspace/README.md#panel-files-sidebar) | Files sidebar sections and file actions use KILV borders, typography and compact geometry. | `component-fixture` | 4 |
| workspace | [Navigation · header, tab bar and new-session action](acceptance/issue-287/panels/workspace/README.md#panel-navigation-bars) | Header, tab selection and new-session action use the shared KILV surfaces and typography. | `component-fixture` | 4 |
| workspace | [Home main view · sessions and navigation](acceptance/issue-287/panels/workspace/README.md#panel-main-view) | Main view chrome and session layout inherit the KILV background and navigation tokens. | `component-fixture` | 4 |
| workspace | [Side chat panel · start a delegated conversation](acceptance/issue-287/panels/workspace/README.md#panel-side-chat-panel) | Side chat empty state uses KILV typography and correctly contrasted primary actions. | `component-fixture` | 4 |
| workspace | [Connect terminal · paste authentication URL](acceptance/issue-287/panels/workspace/README.md#panel-connect-terminal) | Terminal connect actions and URL input adopt KILV surfaces, borders and typography. | `component-fixture` | 4 |

## Directly changed source coverage

[Machine-readable source table](acceptance/issue-287/panels/source-coverage.tsv) · [Capture summary](acceptance/issue-287/panels/summary.json)

| Production source | Visible panel evidence |
|---|---|
| `-session/SessionView.tsx` | [chat/session](acceptance/issue-287/panels/chat/README.md#panel-session) |
| `app/(app)/_layout.tsx` | [production/landing](acceptance/issue-287/panels/production/README.md#panel-landing) |
| `app/(app)/artifacts/[id].tsx` | [routes/artifact](acceptance/issue-287/panels/routes/README.md#panel-artifact) |
| `app/(app)/artifacts/edit/[id].tsx` | [routes/artifact-edit](acceptance/issue-287/panels/routes/README.md#panel-artifact-edit) |
| `app/(app)/artifacts/index.tsx` | [routes/artifacts](acceptance/issue-287/panels/routes/README.md#panel-artifacts) |
| `app/(app)/artifacts/new.tsx` | [routes/artifact-new](acceptance/issue-287/panels/routes/README.md#panel-artifact-new) |
| `app/(app)/automations/index.tsx` | [workspace/automations-list](acceptance/issue-287/panels/workspace/README.md#panel-automations-list), [workspace/automation-create](acceptance/issue-287/panels/workspace/README.md#panel-automation-create) |
| `app/(app)/friends/index.tsx` | [routes/friends](acceptance/issue-287/panels/routes/README.md#panel-friends) |
| `app/(app)/friends/search.tsx` | [routes/friend-search](acceptance/issue-287/panels/routes/README.md#panel-friend-search) |
| `app/(app)/inbox/index.tsx` | [routes/inbox](acceptance/issue-287/panels/routes/README.md#panel-inbox) |
| `app/(app)/index.tsx` | [production/landing](acceptance/issue-287/panels/production/README.md#panel-landing), [workspace/signed-out](acceptance/issue-287/panels/workspace/README.md#panel-signed-out) |
| `app/(app)/machine/[id].tsx` | [routes/machine](acceptance/issue-287/panels/routes/README.md#panel-machine) |
| `app/(app)/new/index.tsx` | [workspace/new-session](acceptance/issue-287/panels/workspace/README.md#panel-new-session), [workspace/new-session-path](acceptance/issue-287/panels/workspace/README.md#panel-new-session-path) |
| `app/(app)/restore/index.tsx` | [production/restore-device](acceptance/issue-287/panels/production/README.md#panel-restore-device) |
| `app/(app)/restore/manual.tsx` | [production/restore-key](acceptance/issue-287/panels/production/README.md#panel-restore-key) |
| `app/(app)/server.tsx` | [production/server-config](acceptance/issue-287/panels/production/README.md#panel-server-config) |
| `app/(app)/session/[id]/info.tsx` | [routes/session-info](acceptance/issue-287/panels/routes/README.md#panel-session-info) |
| `app/(app)/session/recent.tsx` | [routes/recent](acceptance/issue-287/panels/routes/README.md#panel-recent) |
| `app/(app)/settings/account.tsx` | [routes/account](acceptance/issue-287/panels/routes/README.md#panel-account) |
| `app/(app)/settings/agents.tsx` | [routes/agents](acceptance/issue-287/panels/routes/README.md#panel-agents) |
| `app/(app)/settings/appearance.tsx` | [routes/appearance](acceptance/issue-287/panels/routes/README.md#panel-appearance) |
| `app/(app)/settings/connect/claude.tsx` | [routes/claude](acceptance/issue-287/panels/routes/README.md#panel-claude) |
| `app/(app)/settings/features.tsx` | [routes/features](acceptance/issue-287/panels/routes/README.md#panel-features) |
| `app/(app)/settings/language.tsx` | [routes/language](acceptance/issue-287/panels/routes/README.md#panel-language) |
| `app/(app)/settings/voice.tsx` | [routes/voice](acceptance/issue-287/panels/routes/README.md#panel-voice) |
| `app/(app)/settings/voice/language.tsx` | [routes/voice-language](acceptance/issue-287/panels/routes/README.md#panel-voice-language) |
| `app/(app)/terminal/connect.tsx` | [routes/terminal](acceptance/issue-287/panels/routes/README.md#panel-terminal) |
| `app/(app)/text-selection.tsx` | [routes/text-selection](acceptance/issue-287/panels/routes/README.md#panel-text-selection) |
| `app/(app)/user/[id].tsx` | [routes/user](acceptance/issue-287/panels/routes/README.md#panel-user) |
| `app/+html.tsx` | [production/landing](acceptance/issue-287/panels/production/README.md#panel-landing) |
| `app/_layout.tsx` | [production/landing](acceptance/issue-287/panels/production/README.md#panel-landing) |
| `components/AccountKeyPanel.tsx` | [routes/account-key](acceptance/issue-287/panels/routes/README.md#panel-account-key) |
| `components/ActiveSessionsGroupCompact.tsx` | [workspace/session-workspace-groups](acceptance/issue-287/panels/workspace/README.md#panel-session-workspace-groups) |
| `components/AgentGoalBar.tsx` | [chat/goal-work-queue](acceptance/issue-287/panels/chat/README.md#panel-goal-work-queue) |
| `components/AgentInput.tsx` | [chat/session](acceptance/issue-287/panels/chat/README.md#panel-session), [chat/composer](acceptance/issue-287/panels/chat/README.md#panel-composer) |
| `components/AgentQuestionModal.tsx` | [chat/question](acceptance/issue-287/panels/chat/README.md#panel-question) |
| `components/AgentWorkGroupHeader.tsx` | [chat/goal-work-queue](acceptance/issue-287/panels/chat/README.md#panel-goal-work-queue) |
| `components/AttachmentInputMenu.tsx` | [chat/attachment-menu](acceptance/issue-287/panels/chat/README.md#panel-attachment-menu) |
| `components/ChatList.tsx` | [chat/chat-list](acceptance/issue-287/panels/chat/README.md#panel-chat-list), [chat/session](acceptance/issue-287/panels/chat/README.md#panel-session) |
| `components/CodeEditor.tsx` | [chat/native-editor](acceptance/issue-287/panels/chat/README.md#panel-native-editor) |
| `components/CodeEditor.web.tsx` | [workspace/code-editor](acceptance/issue-287/panels/workspace/README.md#panel-code-editor) |
| `components/CodeView.tsx` | [chat/native-text](acceptance/issue-287/panels/chat/README.md#panel-native-text) |
| `components/CommandPalette/CommandPalette.tsx` | [workspace/command-palette](acceptance/issue-287/panels/workspace/README.md#panel-command-palette) |
| `components/CommandPalette/CommandPaletteInput.tsx` | [workspace/command-palette](acceptance/issue-287/panels/workspace/README.md#panel-command-palette) |
| `components/CommandPalette/CommandPaletteItem.tsx` | [workspace/command-palette](acceptance/issue-287/panels/workspace/README.md#panel-command-palette) |
| `components/CommandPalette/CommandPaletteModal.tsx` | [workspace/command-palette](acceptance/issue-287/panels/workspace/README.md#panel-command-palette) |
| `components/CommandPalette/CommandPaletteResults.tsx` | [workspace/command-palette](acceptance/issue-287/panels/workspace/README.md#panel-command-palette) |
| `components/CommandView.tsx` | [chat/native-text](acceptance/issue-287/panels/chat/README.md#panel-native-text) |
| `components/CommanderAvatarSettings.tsx` | [routes/commanders](acceptance/issue-287/panels/routes/README.md#panel-commanders) |
| `components/CompactGitStatus.tsx` | [workspace/git-status](acceptance/issue-287/panels/workspace/README.md#panel-git-status) |
| `components/ConnectButton.tsx` | [workspace/connect-terminal](acceptance/issue-287/panels/workspace/README.md#panel-connect-terminal) |
| `components/CredentialsSettingsView.tsx` | [routes/credentials](acceptance/issue-287/panels/routes/README.md#panel-credentials) |
| `components/DesktopFileWorkspace.tsx` | [workspace/workspace-markdown](acceptance/issue-287/panels/workspace/README.md#panel-workspace-markdown), [workspace/workspace-source](acceptance/issue-287/panels/workspace/README.md#panel-workspace-source), [workspace/workspace-live](acceptance/issue-287/panels/workspace/README.md#panel-workspace-live) |
| `components/DuplicateSheet.tsx` | [workspace/duplicate-session](acceptance/issue-287/panels/workspace/README.md#panel-duplicate-session) |
| `components/EmptyMainScreen.tsx` | [workspace/empty-onboarding](acceptance/issue-287/panels/workspace/README.md#panel-empty-onboarding) |
| `components/EmptyMessages.tsx` | [chat/empty](acceptance/issue-287/panels/chat/README.md#panel-empty) |
| `components/EmptySessionsTablet.tsx` | [workspace/empty-tablet](acceptance/issue-287/panels/workspace/README.md#panel-empty-tablet) |
| `components/FABWide.tsx` | [workspace/navigation-bars](acceptance/issue-287/panels/workspace/README.md#panel-navigation-bars) |
| `components/FileViewPanel.tsx` | [workspace/workspace-markdown](acceptance/issue-287/panels/workspace/README.md#panel-workspace-markdown), [workspace/workspace-source](acceptance/issue-287/panels/workspace/README.md#panel-workspace-source), [workspace/workspace-link](acceptance/issue-287/panels/workspace/README.md#panel-workspace-link) |
| `components/FilesSidebar.tsx` | [workspace/files-sidebar](acceptance/issue-287/panels/workspace/README.md#panel-files-sidebar) |
| `components/FlatSessionRow.tsx` | [workspace/sidebar-projects](acceptance/issue-287/panels/workspace/README.md#panel-sidebar-projects), [workspace/project-detail](acceptance/issue-287/panels/workspace/README.md#panel-project-detail) |
| `components/GitStatusBadge.tsx` | [workspace/git-status](acceptance/issue-287/panels/workspace/README.md#panel-git-status) |
| `components/HappyHerdAutomationCard.tsx` | [workspace/automation-card](acceptance/issue-287/panels/workspace/README.md#panel-automation-card) |
| `components/HappyHerdAutomationDetail.tsx` | [workspace/automation-detail](acceptance/issue-287/panels/workspace/README.md#panel-automation-detail) |
| `components/HomeDock.tsx` | [workspace/home-dock](acceptance/issue-287/panels/workspace/README.md#panel-home-dock) |
| `components/InlineCommentReview.web.tsx` | [workspace/inline-comment-review](acceptance/issue-287/panels/workspace/README.md#panel-inline-comment-review) |
| `components/Item.tsx` | [chat/controls](acceptance/issue-287/panels/chat/README.md#panel-controls) |
| `components/ItemGroup.tsx` | [production/server-config](acceptance/issue-287/panels/production/README.md#panel-server-config), [chat/controls](acceptance/issue-287/panels/chat/README.md#panel-controls) |
| `components/LocalhostLiveView.web.tsx` | [workspace/workspace-live](acceptance/issue-287/panels/workspace/README.md#panel-workspace-live) |
| `components/MachinePathBrowser.tsx` | [workspace/new-session-path](acceptance/issue-287/panels/workspace/README.md#panel-new-session-path) |
| `components/MainView.tsx` | [workspace/main-view](acceptance/issue-287/panels/workspace/README.md#panel-main-view) |
| `components/MessageView.tsx` | [chat/chat-list](acceptance/issue-287/panels/chat/README.md#panel-chat-list), [chat/messages](acceptance/issue-287/panels/chat/README.md#panel-messages), [chat/session](acceptance/issue-287/panels/chat/README.md#panel-session) |
| `components/OAuthView.tsx` | **Unproved — see gaps below** |
| `components/ProjectGitStatus.tsx` | [workspace/git-status](acceptance/issue-287/panels/workspace/README.md#panel-git-status) |
| `components/ProjectGroup.tsx` | [workspace/session-workspace-groups](acceptance/issue-287/panels/workspace/README.md#panel-session-workspace-groups) |
| `components/ProviderContinuationLinks.tsx` | [chat/continuation](acceptance/issue-287/panels/chat/README.md#panel-continuation) |
| `components/ProviderContinuationSheet.tsx` | [chat/continuation](acceptance/issue-287/panels/chat/README.md#panel-continuation) |
| `components/QueuedMessagesPanel.tsx` | [chat/goal-work-queue](acceptance/issue-287/panels/chat/README.md#panel-goal-work-queue) |
| `components/RoundButton.tsx` | [production/landing](acceptance/issue-287/panels/production/README.md#panel-landing), [chat/controls](acceptance/issue-287/panels/chat/README.md#panel-controls) |
| `components/SearchableListSelector.tsx` | [chat/selector](acceptance/issue-287/panels/chat/README.md#panel-selector) |
| `components/SessionActionsPopover.tsx` | [chat/session-actions](acceptance/issue-287/panels/chat/README.md#panel-session-actions) |
| `components/SessionStatusBar.tsx` | [chat/status](acceptance/issue-287/panels/chat/README.md#panel-status) |
| `components/SessionsListWrapper.tsx` | [workspace/empty-onboarding](acceptance/issue-287/panels/workspace/README.md#panel-empty-onboarding) |
| `components/SettingsView.tsx` | [routes/settings](acceptance/issue-287/panels/routes/README.md#panel-settings) |
| `components/ShimmerView.tsx` | [chat/status](acceptance/issue-287/panels/chat/README.md#panel-status) |
| `components/SideChatPanel.tsx` | [workspace/side-chat-panel](acceptance/issue-287/panels/workspace/README.md#panel-side-chat-panel) |
| `components/SidebarNavigationButton.tsx` | [workspace/sidebar-projects](acceptance/issue-287/panels/workspace/README.md#panel-sidebar-projects) |
| `components/SidebarView.tsx` | [workspace/sidebar-projects](acceptance/issue-287/panels/workspace/README.md#panel-sidebar-projects) |
| `components/TabBar.tsx` | [workspace/navigation-bars](acceptance/issue-287/panels/workspace/README.md#panel-navigation-bars) |
| `components/UserSearchResult.tsx` | [routes/friend-search](acceptance/issue-287/panels/routes/README.md#panel-friend-search) |
| `components/VoiceAssistantStatusBar.tsx` | [chat/status](acceptance/issue-287/panels/chat/README.md#panel-status) |
| `components/WorkspaceFeedbackComposer.tsx` | [workspace/workspace-link](acceptance/issue-287/panels/workspace/README.md#panel-workspace-link) |
| `components/WorkspaceLinkViewer.tsx` | [workspace/workspace-link](acceptance/issue-287/panels/workspace/README.md#panel-workspace-link) |
| `components/diff/PierreDiffView.tsx` | [workspace/workspace-source](acceptance/issue-287/panels/workspace/README.md#panel-workspace-source) |
| `components/markdown/MarkdownView.tsx` | [chat/native-text](acceptance/issue-287/panels/chat/README.md#panel-native-text) |
| `components/markdown/MarkdownView.web.tsx` | [production/changelog](acceptance/issue-287/panels/production/README.md#panel-changelog), [workspace/workspace-markdown](acceptance/issue-287/panels/workspace/README.md#panel-workspace-markdown), [workspace/workspace-link](acceptance/issue-287/panels/workspace/README.md#panel-workspace-link) |
| `components/navigation/Header.tsx` | [production/landing](acceptance/issue-287/panels/production/README.md#panel-landing), [workspace/navigation-bars](acceptance/issue-287/panels/workspace/README.md#panel-navigation-bars) |
| `components/tools/PermissionFooter.tsx` | [chat/tool-states](acceptance/issue-287/panels/chat/README.md#panel-tool-states) |
| `components/tools/ToolError.tsx` | [chat/tool-states](acceptance/issue-287/panels/chat/README.md#panel-tool-states) |
| `components/tools/ToolFullView.tsx` | [chat/tool-full](acceptance/issue-287/panels/chat/README.md#panel-tool-full) |
| `components/tools/ToolSectionView.tsx` | [chat/tool-states](acceptance/issue-287/panels/chat/README.md#panel-tool-states) |
| `components/tools/ToolStatusIndicator.tsx` | [chat/tool-states](acceptance/issue-287/panels/chat/README.md#panel-tool-states) |
| `components/tools/ToolView.tsx` | [chat/tool-shells](acceptance/issue-287/panels/chat/README.md#panel-tool-shells) |
| `components/tools/views/CodexBashView.tsx` | [chat/tool-shells](acceptance/issue-287/panels/chat/README.md#panel-tool-shells) |
| `components/tools/views/CodexPatchView.tsx` | [chat/tool-patch](acceptance/issue-287/panels/chat/README.md#panel-tool-patch) |
| `components/tools/views/FileView.tsx` | [chat/tool-file](acceptance/issue-287/panels/chat/README.md#panel-tool-file) |
| `components/tools/views/GeminiExecuteView.tsx` | [chat/tool-shells](acceptance/issue-287/panels/chat/README.md#panel-tool-shells) |
| `components/tools/views/InlineQuestionForm.tsx` | [chat/tool-question](acceptance/issue-287/panels/chat/README.md#panel-tool-question) |
| `components/tools/views/MultiEditViewFull.tsx` | [chat/tool-patch](acceptance/issue-287/panels/chat/README.md#panel-tool-patch) |
| `components/tools/views/SubagentView.tsx` | [chat/tool-agents](acceptance/issue-287/panels/chat/README.md#panel-tool-agents) |
| `components/tools/views/TaskView.tsx` | [chat/tool-agents](acceptance/issue-287/panels/chat/README.md#panel-tool-agents) |
| `components/tools/views/TodoView.tsx` | [chat/tool-agents](acceptance/issue-287/panels/chat/README.md#panel-tool-agents) |
| `components/usage/UsageBar.tsx` | [routes/voice](acceptance/issue-287/panels/routes/README.md#panel-voice), [routes/usage](acceptance/issue-287/panels/routes/README.md#panel-usage) |
| `components/usage/UsageChart.tsx` | [routes/usage](acceptance/issue-287/panels/routes/README.md#panel-usage) |
| `components/usage/UsagePanel.tsx` | [routes/usage](acceptance/issue-287/panels/routes/README.md#panel-usage) |
| `modal/components/BaseModal.tsx` | [chat/alert](acceptance/issue-287/panels/chat/README.md#panel-alert), [chat/prompt](acceptance/issue-287/panels/chat/README.md#panel-prompt) |
| `modal/components/WebAlertModal.tsx` | [chat/alert](acceptance/issue-287/panels/chat/README.md#panel-alert) |
| `modal/components/WebPromptModal.tsx` | [chat/prompt](acceptance/issue-287/panels/chat/README.md#panel-prompt) |

## Specific unproved panels and prerequisites

- **components/OAuthView.tsx:** The native-only OAuth WebView is not mounted by the Web Claude route. No installed iOS/Android provider-auth host is available. The Web manual setup route is captured without claiming OAuthView coverage.
- **installed native:** All artifacts here use React Native Web. Native font/layout/device behavior and system integrations require installed-device acceptance.
- `components/OAuthView.tsx` has no screenshot coverage in this set. A rendered target host is still needed; another panel screenshot is not a substitute.
- **Mobile-device pairing / QR ready state:** the production route is captured with an offline backend. A ready QR and completed pairing require a test server/account; neither is shown as verified.
- **Native Markdown, native CodeEditor and voice Shimmer:** their source has DOM fixture screenshots, but native font metrics, selection/keyboard integration, alpha-mask animation and glass compositing require the installed native host.
- **Installed-client shells and splash:** desktop/native window chrome, iOS/Android safe areas and the physical Safari keyboard/zoom behavior require their actual devices. Web panel screenshots do not substitute for those checks.

## Visual findings retained in the evidence

- **UsageChart:** the fixture exposes clipping at the top of tall bars and their value labels. The baseline `189c504b` has the same height/padding/bar-height geometry; this UI diff changes its font and semantic colors.
- **ConnectButton:** the action label remains shortened inside its fixed-width button, as in the bounded historical comparison. Screenshot review also exposed a new URL-input overflow caused by the larger monospace field; `a38fae51` fixes it with `minWidth: 0` while retaining 16px text. The [before/after evidence and measurements](acceptance/issue-287/connect-input-regression/README.md) document the fix. Final panel screenshots show the repaired input.
The original screenshots retain these findings. They are not marked as clean visual passes or silently corrected in the capture adapters.

## Reproduce

Run capture scripts from the dedicated repository worktree with the pinned workspace dependencies installed. Production capture requires the current exported Web artifact; it starts and removes its own loopback static server. All fixture data is synthetic.

```sh
node scripts/kilv-capture/production.mjs /path/to/expo-export
node scripts/kilv-capture/routes.mjs
node scripts/kilv-capture/chat.mjs
node scripts/kilv-capture/workspace.capture.mjs
python3 scripts/kilv-capture/report.py
```

No deployed revision, authenticated account, merge, deployment, service restart or reviewer-comment reply is implied by this evidence update.
