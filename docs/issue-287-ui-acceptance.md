# Issue #287 UI acceptance record

Scope: KILV visual rebuild, repository issue #287. The issue's source inventory is pinned to `4d339370bea7cc155d3731cf5ae8b862d2d46549`; implementation began at `189c504b5ab16eea7fa16e3c2fb33e98d147390d` on `feat/issue-287-kilv-ui`. The review commit and exact-head gate results are recorded in the pull request. The screenshots and source in this record travel in the same pull request; no deployed revision is claimed. No deployment or native-host acceptance is implied by this document.

The [disposition table](issue-287-ui-disposition.tsv) reconciles every one of the issue's 945 unique paths, including supplemental style/configuration owners and assets, against the implementation tree. Additional production TS/TSX/font/artwork owners are explicit as `added-at-implementation` or `supplemental-existing-owner`. The TSV path column percent-encodes the density-marker `@` as `%40`; URI-decoding yields each exact repository path (these filenames are not email addresses). `adapt` may be a direct style edit or inheritance from the shared Unistyles theme, typography, control or host named in the row. `keep` preserves data identity, runtime/platform behavior, wrappers or compiled references. `rebuild` replaces the central visual foundation. A row is a scoped disposition and source mapping, **not a visual acceptance pass**. `implementation` reports whether the file itself changed; `verification` deliberately keeps rendered/native gaps visible.

Assets are usage-review targets: deterministic avatar/empty-state image libraries, provider identities, raw user/agent images and approved Happy/Hervald product marks remain separate from KILV surface styling. No app, CLI or filesystem rename is authorized. Generated JSON is a theme reference, never runtime authority. Existing Unistyles breakpoints remain `xs0`, `sm300`, `md500`, `lg800`, `xl1200`.

## Human journey contracts

Human: an existing Happy user, except J01 begins signed out. Start on the ordinary production entry named below, in both populated and applicable empty/loading/error states. Every journey retains existing copy, data contracts, gestures and capability boundaries.

| ID | Journey / start and visible entry | Gesture | Visible outcome | Retention and failure | Production ownership |
|---|---|---|---|---|---|
| J01 | **Signed out / restore** — Signed-out Home; login, restore and server entries | Open the visible login/restore entry; focus and edit key or server field; submit or back | Existing authentication/restore result or visible validation error; submitted credentials stay out of screenshots | Authentication state persists by existing contract; unfinished input survives supported close/back paths; retry after validation error | EmptyMainScreen, restore/*, server, AccountKeyPanel, AuthContext |
| J02 | **Navigation / discovery** — Home and compact desktop navigation; session list and archive toggle | Click/tap Workspace, Projects, Automations, New Session and archive; open a session; resize | Correct destination, selected state, session title/status and accessible label remain visible | Selected session, list scroll and archive visibility retain existing ownership; offline state stays discoverable | MainView, SidebarNavigationButton, SidebarView, SessionListView |
| J03 | **New Session** — Visible New Session action, with online/offline machine states | Choose exact machine, path, Commander, provider, model, effort and permission; type a draft; send | Existing provider launch payload and resulting session; offline/error state offers existing recovery | Draft and canonical path/model selection survive supported resize/reopen; no display-label identity substitution | new/index, HomeDock, useNewSessionDraft |
| J04 | **Chat / tools / decisions** — Open existing active session from list | Send short and long Latin/CJK prompts; select/copy output; expand tool/diff; answer question/approval; cancel/retry | Readable reply island, tool/status distinctions, visible feedback and exact existing operation | Chat draft, selected text, scroll position, queued input and provider state survive supported resize/reconnect | SessionView, ChatList, MessageView, AgentInput, tools/*, markdown/* |
| J05 | **Side chats / Workspace** — Workspace navigation and session side-chat entry | Open side chat; select file; inspect diff/preview; edit and review; drag divider; add feedback; back | Same production workspace and file tabs respond, with readable code and far-right table columns reachable | Dirty edits, selected tabs, review/feedback and scroll survive resize/reconnect as current contract requires | workspace/index, DesktopFileWorkspace, FilesSidebar, SideChatPanel, FileViewPanel |
| J06 | **Projects** — Visible Projects destination | Create or open project; rename; toggle archive; assign session through Session Info | Project name, counts, assignment and selected project are shown with existing loading/error feedback | Project/session IDs and saved names retain existing sync; rename/assignment failure can retry | projects/*, session/[id]/project, ProjectGroup, FlatSessionRow |
| J07 | **Automations** — Visible Automations destination | Choose machine; search/filter; open details/history; expand instruction; edit existing form and cancel/save | Readable status/history/detail; existing validation and retry; no cadence/schema/lifecycle change | Selected machine/item/filter and saved configuration preserve existing ownership; failure retains recoverable form | automations/index, HappyHerdAutomationCard, HappyHerdAutomationDetail |
| J08 | **Settings / appearance / language** — Visible Settings entry and settings rows | Open appearance; switch light/dark and en/cn/de; choose provider defaults, feature or voice settings; back | Consistent theme and locale across existing settings controls; selected/disabled state remains distinct | Saved preference/default values persist; changing visuals does not change provider capability contracts | SettingsView, settings/*, Item, Switch |
| J09 | **Credentials / account** — Settings Account and Credentials rows | Select machine/provider; open existing form; focus inputs; save/cancel; reveal/copy/hide only synthetic test data | Existing status and errors remain readable; typed/revealed values and account actions preserve security contracts | Saved account/credential summaries retain existing ownership; no new guard or auth flow | CredentialsSettingsView, settings/account, AccountKeyPanel, AccountKeyBackupGate |
| J10 | **Artifacts** — Existing artifacts list entry | Create/open/edit artifact; type title/body; save/back; select/copy content | Readable list/editor/detail, existing save/error/loading feedback | Saved artifact content byte-faithful; unsaved-state behavior unchanged | artifacts/*, MarkdownView |
| J11 | **Friends / Inbox / profile** — Inbox and friends/search entries | Search; open user profile; inspect request/accepted states; operate an authorized synthetic request | Existing social affordances, empty/loading states and profile artwork remain visible | User IDs, profiles and request state retain sync; failures use existing feedback | friends/*, inbox/index, user/[id], InboxView, UserCard, UserSearchResult, FeedItemCard |
| J12 | **Usage / changelog / text selection** — Settings usage/changelog rows and message text-selection action | Select usage period/metric; scroll chart; open changelog links; select/copy long text | Readable totals and provider coverage, release notes, byte-faithful selected text | Selected period/metric and text source retain existing ownership; usage error can retry | UsagePanel, UsageChart, UsageBar, changelog, text-selection |
| J13 | **Machine / terminal / connection** — Settings machine and terminal/connect entries | Open machine; inspect capabilities; edit path; invoke existing connect entry; inspect unsupported/native handoff | Status/path/command presentation uses semantic theme; supported platform behavior unchanged | Machine/path/provider identity retained; no daemon restart or new connection policy implied | machine/[id], terminal/*, settings/connect/claude, OAuthView |
| J14 | **App packaging / native chrome** — Installed app launcher, splash and ordinary window | Launch app; inspect mark/splash/favicon/titlebar; switch theme and resize safe-area/keyboard host | Approved product identity, theme-aware content and existing OS chrome remain legible | Identity and runtime/platform configuration unchanged; N/A for decorative-art persistence | app.config, src-tauri configuration/icons, root layouts, assets |

## Target surface and variant contract

Web Desktop uses `1440×900`; Web Mobile separately uses `390×844` and `360×800`. Repeat both themes and `en`, `cn`, `de`: 18 Web viewport/theme/locale variants for each reachable journey. Existing native iOS, Android, macOS and Windows routes are targeted where the shipped host exposes that journey; no native row is excluded merely because hardware or credentials are unavailable. A platform unsupported by the existing source contract must prove its ordinary unsupported state and record a specific exclusion for the absent operation.

For every input, textarea, select, contenteditable, placeholder and compact composer variant in targeted mobile routes, computed entry text must be at least 16 CSS px. Focus on an actual iPhone Safari and check for no automatic visual-viewport jump; retain pinch zoom. Verify safe areas, software keyboard, native toolbar handoff, accessible names/focus/hover/pressed/selected/disabled/loading/offline/error states, touch targets, horizontal tables, and text selection/copy. Capture before/after screenshots and interaction evidence without account keys or live session secrets.

## Acceptance matrix

`U` = Unproved. `L` = locally exercised in the exported production Web bundle, limited to the step described in the evidence cell; this does not prove live authentication or a deployed host. Each row needs visible entry, actual gesture, visible result and named retention; a component fixture, source inspection, unit pass or Web export alone does not fulfill it. The final evidence column must name the exact commit plus production host/deployed revision and artifact path. Native absence means missing hardware/runtime proof, not success.

| Journey | Surface | Target | Entry | Gesture | Outcome | Retention | Final evidence / revision |
|---|---|---|---|---|---|---|---|
| J01 | Web Desktop | Targeted | L | L | U | L | [Local production Web evidence](acceptance/issue-287/web-results.json): visible restore entry, input focus, synthetic draft retained across resize; authentication result and live host remain unproved |
| J01 | Web Mobile | Targeted | L | L | U | L | [Local production Web evidence](acceptance/issue-287/web-results.json): visible restore entry, input focus, synthetic draft retained across resize; authentication result and live host remain unproved |
| J01 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J01 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J01 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J01 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J02 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J02 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J02 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J02 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J02 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J02 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J03 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J03 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J03 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J03 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J03 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J03 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J04 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J04 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J04 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J04 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J04 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J04 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J05 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J05 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J05 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J05 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J05 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J05 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J06 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J06 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J06 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J06 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J06 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J06 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J07 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J07 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J07 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J07 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J07 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J07 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J08 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J08 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J08 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J08 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J08 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J08 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J09 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J09 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J09 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J09 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J09 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J09 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J10 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J10 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J10 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J10 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J10 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J10 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J11 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J11 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J11 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J11 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J11 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J11 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J12 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J12 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J12 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J12 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J12 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J12 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J13 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J13 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J13 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J13 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J13 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J13 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |
| J14 | Web Desktop | Targeted | U | U | U | U | Pending final production-host evidence |
| J14 | Web Mobile | Targeted | U | U | U | U | Pending final production-host evidence |
| J14 | iOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J14 | Android | Targeted | U | U | U | U | Pending final production-host evidence |
| J14 | macOS | Targeted | U | U | U | U | Pending final production-host evidence |
| J14 | Windows | Targeted | U | U | U | U | Pending final production-host evidence |

## Review evidence

The implementation is **code-ready, not full cross-platform acceptance**. All 945 issue-baseline paths plus 17 supplemental owners/assets have a disposition (962 rows). Product UI and code fonts are self-hosted; derived font generation and licenses are included. Unistyles remains the runtime theme authority. No deployment, service restart, merge or issue closure forms part of this patch.

Representative exported-production screenshots, captured before at the implementation base and after the visual changes:

| Surface | Before | After |
|---|---|---|
| Desktop, English, light, 1440×900 | [Before](acceptance/issue-287/before-desktop-light.png) | [After](acceptance/issue-287/after-desktop-light.png) |
| Mobile, German, dark, 360×800 | [Before](acceptance/issue-287/before-mobile-dark.png) | [After](acceptance/issue-287/after-mobile-dark.png) |

The [18-case Web result record](acceptance/issue-287/web-results.json) covers the real exported Home and restore routes in en/cn/de, light/dark, and 1440×900 / 390×844 / 360×800. It checks mounted UI, loaded/nonzero artwork, no page errors or horizontal overflow, actual font loading, visible restore navigation, input focus at 16px, and a synthetic draft surviving resize. Screenshots contain no account keys. Chromium mobile emulation is explicitly not an iPhone Safari keyboard/zoom pass.

Reproduce that evidence from `server/` (the second script argument chooses an artifact directory):

```sh
APP_ENV=production pnpm --filter happy-app exec expo export --platform all --output-dir dist-ci
pnpm --filter happy-app web:smoke
pnpm --filter happy-app exec node scripts/verify-kilv-web.mjs dist-ci /tmp/kilv-web-evidence
```

Supporting browser fixtures exercise the real workspace, file editing/review, deletion, side chats, projects, credentials, settings, automation and usage components with synthetic service/state boundaries. They retain their operation, recovery, draft and scrolling assertions. They do not prove live authenticated journeys. Native render tests cover Markdown body/list/link/table/inline-code readability in both tones and themes; actual rendered Web pixels check that bold, headings and italic remain visually distinct with the loaded font faces.

| Evidence plane | State | Command / bounded evidence |
|---|---|---|
| Source disposition | Complete | 945 baseline + 17 supplemental paths; exact filenames recover by URI-decoding the path column |
| Frozen dependencies | Passed; lockfile unchanged | `pnpm install --frozen-lockfile` |
| App typecheck | Passed | `pnpm --filter happy-app typecheck` |
| Full app tests | 282 files / 2839 passed, 1 existing benchmark skipped before the native-build follow-up; latest-head result in PR | `pnpm --filter happy-app test --run --maxWorkers=2` |
| UI inventory and i18n | Passed | 40 routes, 277 UI owners, 84 smoke cases; 1532 keys per en/cn/de; zero hardcoded-copy exceptions |
| Changelog | Passed | September 19 — Native build reliability; 143 parsed entries, including the KILV interface entry |
| Production Web export | Passed | `APP_ENV=production ... expo export --platform all`, followed by production mount smoke |
| iOS / Android Hermes export | Passed | Existing Expo route collection included six Node/Vitest files. A route-root-only Metro exclusion fixes this; the actual Metro file-map/context regression test retains real routes and excludes those tests for all three platforms. Both native Hermes bundles now export successfully; installed hosts remain unproved |
| Production Web entry / restore | Local evidence | 18 combinations in the linked JSON; authenticated outcome unproved |
| CLI / server builds | Passed | Dependency `happy-agent` built first, then CLI and server production builds |
| Repository contract suite | UI commit `16249c9` passed all required GitHub gates; latest-head result in PR | `scripts/contract-suite.sh`; isolated Bash 5.3 and ShellCheck 0.11 tooling, canonical upstream lineage |
| Actual iPhone Safari keyboard / zoom | Unproved | Requires physical-device input focus and safe-area proof |
| Native iOS / Android / macOS / Windows hosts | Unproved | Requires applicable shipped-host runtime/hardware evidence |
| Full authenticated journey matrix / live deployment | Unproved | Existing account/server/runtime evidence needed; no deployment authorized in this task |

Issues #283 (mobile composer toolbars) and #286 (OS scroll direction) remain independent. This visual patch neither closes them nor substitutes screenshots for their behavioral acceptance.
