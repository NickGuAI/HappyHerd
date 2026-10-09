# Issue 369 native UI parity

Owner: [#369](https://github.com/NickGuAI/HappyHerd/issues/369), including the
[#341](https://github.com/NickGuAI/HappyHerd/issues/341) journeys. Audit base:
`3a3773303a5539f6c9deddbd04197b92cbab9a76`. The earlier issue's `0217e4c62`
source pointers are historical. No owner-approved exceptions have been recorded.

## Repair boundary

Window width chooses wide secondary pages, Settings navigation and docked chat
panels. Native phones retain their phone navigation in landscape; tablet and
Mac windows can become narrow. Streamline and Advanced use the synced default
on every host, including iPad and the iPad app on Mac. Provider selection,
one-click same-provider side-chat creation, authentication and session lifecycle
remain their existing owners' contracts.

The read-only audit found the original gaps still reachable, plus native palette
and canvas stubs and hidden wide-native row actions. Repair lanes are disjoint:

- Layout: shared page/Settings frame, Automations and Workspace layout,
  Streamline route, phone-window helper, SessionView/presentation/Changes entry,
  native panel divider and their regressions.
- Input: native responder input and existing shortcut owners, composer,
  permission eligibility and palette. Native module/config changes require
  parent coordination; no AppDelegate or PR #413 changes.
- Content: shared inline review, native Markdown/raw/canvas commenting and
  selected-machine live view. Native live transport must preserve machine
  identity; loading device-local `localhost` is not a substitute.
- Motion: native sidebar/disclosure/selection transitions, pointer hints and
  reachable row actions, respecting reduced motion.

Account/logout #375 and release workflows/availability #383 are separate owners.
This work does not publish, install, activate, merge or close an issue.

## Human journey and acceptance record

For every row below, exercise each of these surfaces independently: Web Desktop
1440×900; Web Mobile 390×844; physical iPhone; physical iPad (wide and narrow
multitasking windows); iPad app running on Mac (wide and narrow); and rebuilt
Tauri on Mac. Tauri uses WebKit and is not the iPad app on Mac. No physical or
signed/live evidence has been obtained by this work. Rows remain **Unproved**
until exact-head evidence is recorded; a JS test or simulator export cannot
change their physical-device status.

| Journey: visible entry → gesture → observable result | Required retained state / failure evidence |
|---|---|
| Sidebar toggle / ⌥⌘B → collapse and expand | Selected session retained; native motion and reduced motion |
| Session row → switch session | Selection glides; draft and correct session identity retained |
| Inline question / permission card → answer or approve | One submission; advertised provider choices; number-key eligibility |
| Completed tool group → open and close Worked row | Output retained; expansion motion |
| Side chats header → open, create, select, resize and close | One click creates one same-provider child; parent/child focus and drafts retained |
| Workspace header / composer + → browse machine and open file | Correct machine/path, full-screen narrow native, docked wide, tabs and dirty edits retained |
| Workspace divider → drag / accessibility adjust | Useful width range and clamped boundaries; no remount/data loss |
| File Preview → select source line / canvas node → comment → send batch | Exact source anchor, one batch to exact chat, failed-send draft retention |
| Localhost URL → live page → Start commenting → select element → send | Selected-machine resources/scripts/styles/fetch, HTML/CSS/bounds and actual cropped screenshot |
| New Session → Streamline → Commander/folder/project/chips → first send | Synced defaults and worktree rule; exactly one session; native folder/picker sheets |
| New Session → Advanced → configure → first send | Existing full-form capabilities, exactly one session |
| Streamline settings → change defaults → reopen New Session | Synced mode/model/effort/permission choices apply |
| Session ⋯ → Continue with… | Existing handoff contract and retained source session |
| Automations → Run now / expand row | Running then Completed with real authorized daemon state; failure/retry |
| Focus mode → Start / end | Diagonal amber sweep, countdown and completion |
| Commander memory file → edit → save | Saved contents; concurrent stale save refused |
| Settings → every section → option → Back | No separate home; wide section list; narrow navigation and title action |
| Top-bar command palette / ⌘K → search → execute | Native visible palette; keyboard navigation; action once |
| Theme setting → light / dark | Persisted preference and readable controls |
| Phone drawer → toggle, scrim, drag, Escape, row, current-page row, workspace + | Drawer closes; navigation occurs once; Web also left-edge swipe |
| Session row long press / header ⋯ → dismiss / action | Native safe-area sheets and reachable wide-native row actions |
| Narrow native Side chats / Changes / Workspace → open / close | Full-screen native behavior allowed by #341; Web right sheet retains chat strip |
| Hardware composer → Enter, Shift+Enter, Shift+Tab | Send/newline/permission cycling without stealing text or duplicate dispatch |
| Menu / sheet / dialog → Escape | Foremost eligible surface closes; background permissions do not execute |
| Pointer over icon → hint | Native pointer hint visible; touch action and accessibility label retained |
| Resize across 700/900/1000/1100 px thresholds | Appropriate shell/page/Settings/panel layouts; dirty fields and tabs retained |
| iPad / Android tablet nested page or session → header Back | Existing native Back remains reachable |

Also verify English/Chinese/German, light/dark, Dynamic Type, VoiceOver and
44-point native touch targets on affected controls. Source, focused tests,
rendered Web interaction, JS exports, native compilation, signing, installation
and physical/live journeys are separate evidence planes.

## Native build recipes (prepared, not executed)

Use the parent-assigned heavy slot for frozen dependency installation and local
checks. Use pinned Node 20.20.2 and pnpm 10.11.0, from `server/`. Native build and
runtime activation require the separately selected Xcode/signing/account/device
environment. Do not download new toolchains, invoke EAS or publish artifacts.
The existing [native build guide](native-app-builds.md) owns release configuration.

After checking out the reviewed commit in an authorized build workspace:

```sh
APP_ENV=production pnpm --filter happyherd-app exec expo export --platform ios --output-dir dist-ios-369
APP_ENV=production pnpm --filter happyherd-app exec expo prebuild --platform ios
xcodebuild -workspace packages/happyherd-app/ios/HappyHerd.xcworkspace \
  -scheme HappyHerd -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/happyherd-369-simulator CODE_SIGNING_ALLOWED=NO build
```

The first command proves JS assembly only. The second generates native files and
may install CocoaPods dependencies; it requires the native build slot/environment.
The third proves simulator compilation only. Retain the first failure in full;
do not weaken checks or repeatedly retry an unexplained failure.

For separately authorized signed physical-device builds, use the selected team,
registered bundle ID and distribution identities from the build guide:

```sh
xcodebuild -workspace packages/happyherd-app/ios/HappyHerd.xcworkspace \
  -scheme HappyHerd -configuration Release -destination 'generic/platform=iOS' \
  -archivePath /private/tmp/HappyHerd-369.xcarchive archive
```

For the iPad app on Apple-silicon Mac, first inspect `xcodebuild
-showdestinations` for the generated scheme. Select its supported **Mac (Designed
for iPad)** destination; do not substitute a Catalyst or Tauri build. Record the
exact destination and installed artifact revision. Account provisioning and
installation are separately coordinated; this recipe does not grant either.

For Tauri, in its authorized Rust/WebKit environment:

```sh
pnpm --filter happyherd-app tauri:build:production --no-sign --bundles app
```

This is an unsigned local artifact, not public availability, notarization or
proof of Tauri gestures. Sign/install/run only with the parent's concrete
approval. PR #413 owns existing iOS 27 startup work; do not incorporate it without
direction, and preserve any baseline startup failure separately.

## Native live preview: unmet prerequisite

Native live preview remains unimplemented, without an owner-approved exception.
The existing Web transport validates its service-worker source and registered
view token (`sources/sync/workspaceLive.ts`), then calls the existing encrypted
machine RPC (`sources/sync/apiSocket.ts`). Wire and CLI owners impose the existing
loopback, payload/header and redirect contract (`happyherd-wire/src/workspaceLive.ts`
and CLI `registerCommonHandlers.ts`). Native WebView has no equivalent existing
resource-request bridge. The installed dependency's HTTP-server source does not
support arbitrary binary/concurrent resource forwarding.

A proposed native per-view listener adds a device-local caller-to-machine broker,
including new bind/exposure, request framing, lifetime and origin/cookie behavior.
It cannot be demonstrated to be unchanged upstream behavior. Under
[the security-feature approval gate](../.dev/playbooks/security-feature-approval.md),
which explicitly includes “privileged brokering or helping,” this sublane is
stopped before module creation. The parent must obtain the recorded maintainer
approval for the concrete owning issue/PR, or an explicit native-feature exception.
The existing Web journey and a static native snapshot are possible alternatives,
but neither satisfies native live preview with assets, scripts, fetch/XHR and
HTML/CSS plus actual element screenshot feedback. Native localhost entry points
remain unexposed until a working implementation is authorized. No new token,
proxy, sandbox, refusal or supervisor was added as a workaround.

## Implementation verification (local source; native journeys still unproved)

- Frozen task-local install passed with pnpm 10.11.0 / Node 20.20.2; lockfile
  unchanged. Existing expo-tailcat Node >=22 advisory retained in the log.
- Focused native/Web host regressions include Settings state retention,
  Streamline default/mode/picker ownership, iOS/iPad-on-Mac dock/resize/full-screen
  Workspace retention, one-click side chats, native review anchors/Canvas, motion,
  pointer hints, native keyboard registrations and palette hosts.
- The one broad app command was `vitest run --exclude '**/*.browser.test.ts'
  --maxWorkers=3`. It excluded 35 browser files and was **not** a full app or
  contract pass. First result: 339 passing / 11 failing files, 3,462 passing /
  3 failing tests, one pre-existing skipped benchmark; nine suites failed
  collection. New native imports needed explicit native mocks, and three old
  assertions encoded the superseded narrow-tablet behavior. The affected
  reruns passed after these fixes; the additional wide-native folder-picker
  regression caught and fixed a duplicate native/Web picker host.
- First focused collection/type errors and the reachable header, keyboard,
  picker findings were retained privately, then fixed at their owning boundary.
  No timeout, skip, assertion weakening or CI workflow change was used.
- Catalog validation passes 1,710 keys in en/cn/de with zero production copy
  exceptions. Inventory generation records 45 routes, 346 surfaces and 84 smoke
  cases. This inventory is not execution of the browser smoke matrix.
- Changelog parser generated 192 entries with latest title “October 8 — Native
  layouts, shortcuts and Workspace comments”. Production Web export passed with
  three Metro workers. Neither proves native compilation or physical behavior.
- Independent source reviews identified and resolved permission target ordering,
  ordinary hardware Enter-to-send and duplicate native folder-picker hosts.
  Native responder eligibility and lifecycle still need compiled hardware proof.

Exact-head CI, final review, golden comparison and any later native evidence are
recorded in the PR/handoff. Local browser, golden, native build, signing,
installation, account actions, physical-device checks and runtime activation were
not performed. Raw local logs are private and are not committed.

Final content follow-ups: all-negative Canvas fit and Markdown blank/separator
line reveal passed 72 focused tests. Input follow-ups passed 42 tests, including
software Return versus bridge-delivered hardware Enter and completed-modal
focus restoration. Restoring the old Canvas geometry and old advertised-key
suppression independently made the new regressions fail; both mutations were
restored before delivery. Native autolinking resolves the local `HerdInput` pod
and module with no AppDelegate subscribers; this is source wiring evidence only.
The #375 owner acknowledged the exact palette diff, including iOS command-label
modifiers, and the logout callback is byte-identical to the assigned base.
