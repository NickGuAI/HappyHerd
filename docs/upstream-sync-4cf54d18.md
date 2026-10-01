# Upstream integration through 4cf54d18 — issue #370

This integration preserves HappyHerd's current interface and owned contracts while importing the approved upstream behavior. **Acceptance is in progress. The owner's acceptance correction confirms Group 1 as settled scope: persistent visible checklist behavior and help content must be delivered in the existing screens, with intentional visual-delta proof.** [Draft PR #374](https://github.com/NickGuAI/HappyHerd/pull/374) must stay open for Athena. No merge to main, deployment, shared installation/restart or account mutation is authorized. The latest instruction authorizes one inactive historical-session continuation through a safe issue-owned exact-source runtime; it excludes the active parent session and shared production daemon.

## Frozen inputs and topology

| Input | Exact revision |
| --- | --- |
| Initial fetched main (2026-10-01, includes #366) | `4a5ba9a93490685ea64a3205357178d439d13ad1` |
| Refreshed main after #361 merged | `793b05b8394cf1495834a6d2d0e24cb812b7a5c6` |
| Previous integrated upstream | `37e9479947e183800cd557d4ccb968c2e2298ac1` |
| Approved upstream target / observed upstream main | `4cf54d18488cba4787cc251cc37010f31125af29` |
| Resolved subtree merge | `815fd27aeba109060ed937a453bf48c73604d8c7` |
| Merge first parent | `793b05b8394cf1495834a6d2d0e24cb812b7a5c6` |
| Merge second parent | `4cf54d18488cba4787cc251cc37010f31125af29` |
| #361 reviewed head, subsequently merged | `1ed55450db31b1e189d10947da52e0164f104b66` |
| #367 observed open head | `c38546108aed65e732c4a8057b43efdef4811a2b` |

The merge has exactly two parents, changes only `server/`, and has subject `Merge commit '4cf54d18488cba4787cc251cc37010f31125af29'`. It retains the full upstream history. Follow-up commits are single-parent and ledgered. Main was not merged into the integration branch.

One owner resolved the integration. Provider-native subagents performed bounded audits, fixture proposals and isolated verification; they did not create competing integration states. The canonical checkout's unrelated changes were not read or copied into the integration.

## Rehearsal and conflict resolution

Both fresh read-only rehearsals, first on `4a5ba9a9` and again on `793b05b8`, reported **154 conflict events across 151 paths**: 55 content, 34 modify/delete, 60 file-location, four rename/delete, and one add/add. The path inventory did not change between these baselines. Rehearsal clones were disposable; their output and inventories remain in the issue-owned worktree.

Rerere was enabled. The first fully resolved tree was retained locally as checkpoint `65d689e9bf3a4df417237d106e53a69e8e5860ed`. After main advanced, the owner rebuilt from `793b05b8`, repeated the approved `git subtree merge --prefix=server` operation, and applied the reviewed old-base resolution delta with a three-way merge onto the new base. This produced six overlapping paths: ChatList, EmptyMessages, the changelog source, and three generated artifacts. No main merge was used. The two production files were resolved semantically; generated output was rebuilt from combined source.

| Conflict kind | Resolution |
| --- | --- |
| Content | Combined upstream behavior with current tokens, layout, localized copy, acceptance receipts, capability checks and provider ownership. |
| Modify/delete | Mapped old upstream paths to their renamed or replaced HappyHerd owners; reviewed the base-to-target delta instead of restoring deleted upstream screens. |
| File location | Moved accepted new modules into `happyherd-*`; excluded rejected bot publishing, tabs, onboarding layouts and store tooling. |
| Rename/delete | Retained the existing session action presentation and shared action hook rather than resurrecting upstream native menu owners. |
| Add/add | Kept HappyHerd's MessageView regression suite and added accepted pending-state assertions with the owned author position. |
| Clean merges | Reviewed for semantic regressions too: restored overwritten HomeHeader, NativeOptionsPicker, pairing success feedback and device-class layout; retained the 40 MiB socket boundary and single usage owner. |

Merged #366 contributes the encrypted Context window machine RPC, menu action and feature flag. These survive. Merged #361 contributes actual-read Commander context provenance, conflict-safe resume receipts and CommanderContextRow. The latter appears only at the real history start, with one header spacer; an empty history placeholder waits for exhaustion before showing it. Its desktop/phone, light/dark Chromium journeys passed after the rebuild.

The CLI and product rename scripts were run dry-run/apply/check, with semantic identity exceptions retained. Native helper archive names **and archive members** were rebuilt as `happyherd-capability` for arm64 and x64; changing filenames alone would not have been sufficient. The lockfile was regenerated with pnpm 10.11.0. i18n, route/surface inventory and changelog JSON were regenerated from source.

## Accepted decisions

“Ported” below describes source delivery, not completion of every acceptance gate. The verification section records actual evidence and outstanding work.

| Group | Disposition and retained boundary |
| --- | --- |
| 1 | Ported under the settled issue scope. Existing native install/run rows own independent persistent completion; first-run and QR/manual restore screens use the shared Get help action and existing modal. Offline detection, Troubleshoot/Copy AI prompt, pairing and recovery remain. No Web checklist or upstream layout/copy is imported. Verification is recorded below; the prior extra presentation-decision blocker is withdrawn. |
| 2 | Ported native header style-boundary and Android overlay fixes; timestamp slot may grow to its text. HappyHerd already keeps the timestamp mounted and shows unread on the avatar. No upstream unread-dot styling imported. |
| 3 | Ported explicit remote Claude plugin directory forwarding, including resume. Owned permission callbacks and live permission-mode support remain. |
| 4 | Ported five-page background budget, long-turn/group history progress, explicit retry/load-more and inverted Web patch. Retained deliberate cached-window growth, exact receipt focus, nested/horizontal/zoom wheel ownership, and the 16px normal-line-height fallback. |
| 5 | Ported precise expired-login diagnosis. Managed accounts use Settings → Credentials & Accounts → Log In Again on the owning machine; ambient accounts retain host Claude login guidance. No automatic resend or credential rotation. |
| 6 | Ported send-time queued-state metadata and one-second idle pending grace. HappyHerd receipt objects, strict attachment cancellation and accepted-text clearing remain. |
| 7 | Already present / appearance rejected. The mapped upstream commit changes the bare-picture presentation; no independent error-handling fix was found to port. Existing encrypted image frame, filename, thumbhash, preview and error layer remain. |
| 9 | Ported encrypted daemon-owned Rig drafts/modes, stamps, conflict reconciliation and cold-start pending writes. Text and picker edits made during send are retained; non-Rig draft ownership is unchanged. |
| 11 | Ported Android avoidance/focus and exactly-once prompt settlement within existing modal styling. Fixture modal providers own closing after confirmation, matching production. |
| 12 | Ported late/recreated transcript watching and same-session revival. |
| 13 | Ported native full-wake observation and closed delayed-reconnect guard. Both renamed architecture archives were rebuilt and signature checked; current-host helper exits after its disposable parent dies. |
| 14 | Ported singular Web session navigation. Existing keyed session owner resets transient attachments on switching; owned phone drawer behavior remains. |
| 15 | Ported one-composer paste/drop ownership, target/focus/visibility routing and per-event claim. Workspace upload limits and controlled image ownership remain. |
| 16 | Existing launchers retain input during preparation, newer edits and failed-send retry; session catalog is now read at submission rather than on every token update. Projects already subscribe to refreshed avatar data. No upstream checkout-tab structure was imported. Newer text remains in the New Chat draft; it is not claimed to transfer into an arrived session's composer. |
| 17 | Ported HTTP 409 for a machine ID owned by another account; unrelated errors still propagate. |
| 18 | Ported elastic middle/wrapper sizing and native trigger font/spacing fixes. Kept full model names, existing chip labels/padding/icons and selected-menu checkmark appearance. |
| 20 | Ported immediate archive marking and error rollback through the shared header/menu/flat/compact-row action. Ordinary cleanup and server fallback survive; bots require their owning session RPC and never use the ordinary fallback. |
| 21 | Ported renamed private mobile gym and isolated environment setup. Fixture-level isolation verified; real server/Metro lifecycle is not claimed. |
| 22 | Ported separate encrypt/send/wait/decrypt diagnostics. Native Socket.IO acknowledgment timeout and longer side-chat budget remain; no new retry or competing timer. |
| 23 | Ported native clipboard image chooser through the existing normalized, measured attachment path. Web picker/paste behavior and separate Workspace uploads remain. |
| 27 | Ported upstream release preflight and wiring. Tested only in disposable repositories; no release command executed. |
| 29 | CLI version 1.2.5, with `@happyherd/cli`, binary, environment and persisted identities retained. |

## Rejected decisions

| Group | Absence / retention proof |
| --- | --- |
| 8 | Deployment/public S3 configuration remains the baseline; no pinned upstream host. |
| 10 | No phone bot publisher, bot-face/name helpers, bot spawn target, DiceBear dependency or publishing blob method. Existing daemon-owned bot visibility/ownership remains. |
| 19 | No machine-first Home, ProjectHomeList or WorktreeTabStrip. Existing flat default, Projects, Workspace and Commanders remain. |
| 24 | Own October changelog entry in en/cn/de, followed by every retained historical entry. Display-only localization preserves canonical release/unread identity and exact English bytes. No imported upstream September replacement notes. |
| 25 | No app version 1.8.0 change; baseline app version derivation retained. |
| 26 | No upstream App Store / Google Play tooling or marketing screenshot assets. |
| 28 | Responsive device-class owner remains byte-identical to the frozen baseline; no width-based tablet rule. |

## Verification record and remaining proof

Toolchain: Node 20.20.2, pnpm 10.11.0. Local evidence is retained under `.artifacts/issue-370/` in the isolated worktree; it is not a committed runtime/log archive. No thresholds, masks, assertions, skips or timeouts were loosened to obtain a pass.

Initial-base checks, which must not be confused with final-head proof:

- Clean dependency installation with frozen regenerated lockfile passed. App and CLI typechecks passed after conflict fixes.
- Focused chat/pending/RPC cases: 95 passed. Focused CLI auth/plugin/transcript/wake cases: 64 passed. Wire: 83 passed.
- Full server suite: 201 passed; production typecheck/build passed with UTC timezone.
- Session continuity: 171 passed, including retained-session/restart fixtures. No historical production session was continued.
- macOS helper: both architecture signatures and binary architecture inspected; disposable parent-lifetime check passed.
- Gym/preflight: typecheck, 8 disposable preflight scenarios, 11 gym isolation assertions, 11 wiring assertions passed.
- Production Web export and React-mount smoke passed. i18n validated en/cn/de with zero production hardcoded-copy exceptions.
- Lineage, patch discipline, public boundary and sync-provenance fixtures passed at the original checkpoint.

First failures are retained and diagnosed: stale fixture APIs after shared-hook changes; lost drag/wheel focus release; repeated window growth from stale metrics; cancellation returning instead of throwing; Shift-wheel and normal-line-height ownership; macOS `/var` versus `/private/var` temporary paths; UTC event buckets under a non-UTC host; and browser teardown timeouts during the exploratory full run. A single-fixture teardown probe closed with zero HTTP connections; no timeout was increased. The original full app run had 3,820 passes / 16 failures / 225 existing skips, and the next exploratory run was interrupted for the required main-base rebuild. Neither is final acceptance.

Post-rebuild checks:

| Check | Result |
| --- | --- |
| `pnpm --filter @happyherd/cli test` | 195 files, 2,088 tests passed (isolated TMPDIR, UTC). |
| Wire/server suites | Wire 15 files /84 tests; server 37 files /201 tests passed; server production build passed. |
| `test:session-continuity` | 8 files /182 tests passed, including newer Commander cases. |
| App typecheck | Passed after integration, the Rig edit fix and browser-fixture corrections. |
| Full app suite | Latest clean-head run:366 files;4,222 passed,10 existing skips. |
| Full contract suite | Passed on `8e01a25fd5383b3405b42d892b07b488c7459526`: all repository verifiers (694 owned patches), app4,222, wire84, control agent260, HappyHerd agent52, CLI2,088 and server201. Evidence: `contract-final-layout-second.txt`. |
| `i18n:check` / inventory | 1,677 keys per locale after the release-note translations; zero hardcoded-copy exceptions;45 routes,339 surfaces,84 smoke cases. |
| Production Web export / smoke / CLI and server builds | Repeated successfully on `8e01a25f`; exported title is HappyHerd and React-mount smoke passed. |
| Changelog parser | 175 entries; latest “October 1 — Session reliability and shared drafts”. |
| Range-diff | All683 inherited ledger subjects are exact matches. |
| Lineage / public boundary / sync provenance | Passed; provenance has1 valid and4 rejected fixtures. |
| Full contract attempts | Whitespace and an unsupported commit prefix were corrected. The third attempt exposed an existing GNU `sed -i` assumption; the already-installed GNU sed was selected through PATH, with no source change. The fourth cleared repository contracts and app typecheck, then reported 363 passing /2 failing app files: 4,202 passed,3 failed,10 existing skips. The subsequent fifth full run passed. |

Rendered Chromium interaction fixtures use production components over synthetic data/transport at1440×900 and390×844, light/dark. They do not claim authenticated live behavior:

| Groups | Interaction proof |
| --- | --- |
| 4 | 8 new long-collapsed-history/budget/Load more/error/Retry/end cases;4 theme/viewport wheel cases. |
| 6 | 4 controlled-clock pending cases: no hint/dimming before1,000ms, then hint; queued identity survives agent-idle transition; settlement retains the message node. |
| 7 | 24 FileView/ToolView image cases: actual image renderer/thumbnail, download/decrypt error, filename/frame, metadata stability, and preview/Close through actual ModalProvider/CustomModal entirely within the viewport. |
| 11 | 20 real ModalProvider/ModalManager prompt cases: Enter/Save/Cancel/Escape/rapid-confirm, exact resolver count, ignored backdrop, initial and reopened autofocus, and retained geometry/style. |
| 14 | 4 real installed ExpoRoot/Stack cases: A→B→C keeps one session route; browser Back returns home.4 actual SessionView session-switch cases reset attachments. |
| 15 | 4 main/side-chat paste/drop cases: exactly one recipient, including target-versus-focus, hidden/outside/ambiguous negatives. |
| 16 | 4 New Chat cases: unchanged input node, edits during deferred preparation, failure and retry using one spawn, and retention of newer text after acceptance. |
| 20 | 24 header/header-menu/row-menu cases: immediate hide before acknowledgment, failure rollback, retry, ordinary cleanup/fallback and bot owner-only handling. |
| Owned #361 / shell | 8 Commander context matrix cases passed. Both focused shell animation/shortcut checks passed with unchanged timing assertions. |

See [selected interaction captures](acceptance/issue-370/README.md) and [localized release-note captures](acceptance/issue-370/changelog-locales/README.md). Group2/18 Web ownership is additionally covered by retained header/chip/browser suites; native rendering/gesture proof remains separate. Group23 Web attachment paths are covered above; its native chooser remains a device proof gap. Group1 is delivered in the existing screens with source-bound production-component evidence below; the previous numbered presentation question is withdrawn.

Review found and fixed a real newer-Rig-draft race: uncontrolled text could advance before its deferred React mirror was stamped, allowing acceptance to clear the newer live text. Local edits are now stamped at the input event; remote drafts are not restamped and non-Rig debounce is unchanged. Two real-hook/store/writer regressions plus existing send/side-chat cases pass (123 tests total); independent review confirmed the fix.

Additional first failures were retained and corrected at their actual boundaries: a Linux-only shell shortcut in a macOS fixture; a no-op navigation mock in the first New Chat test; a stale installed-router state probe; Expo Web index resolution; duplicate ToolView filenames; and an offscreen image-preview stand-in. Visual review rejected that preview evidence and replaced the fixture with the production modal host plus viewport bounds. Prompt readiness now waits for the real active dialog; an initially assumed return-focus contract was disproved on the exact base before correcting that new test’s expectation. No production focus behavior or timing threshold was changed.

Review clearance requires completed Group 1 delivery, one real historical-session continuation, all six successful checks on the new exact head and independent review. The prior head's 28/28 KILV pass does not prove the pending Group 1 changes; its approved-by-issue delta must be recorded and baselines intentionally refreshed. Current outcomes and exact-head links are maintained in [PR374](https://github.com/NickGuAI/HappyHerd/pull/374). Native iOS/Android device journeys and physical wake remain permitted proof gaps. The zero-automations readback is a bounded external evidence gap, not a GitHub/team review gate under the development lifecycle. No automation is created or changed to fill it. Historical continuation fixtures do not substitute for a real provider turn.

The fourth run’s three failures were fixture synchronization races: the unchanged focus timer initially renders against its pre-setup clock before its effect samples the frozen clock, and the phone row test compared moving geometry captured on different frames. The fixtures now wait for the exact expected timer text and measure row/button/text bounds in one evaluation. Exact duration, tick, overlap, containment and timing assertions remain unchanged; no production owner changed. Both original failures and their baseline-source comparisons are retained. Both affected browser files then passed all 56 cases, followed by app typecheck; this focused pass does not substitute for the full rerun.

The first PR Quality run ([36907209569](https://github.com/NickGuAI/HappyHerd/actions/runs/36907209569)) passed Clean install, Lint, Typecheck, production Web export and smoke. KILV stopped before comparison because its static route fixture lacked the newly imported navigation-helper export. The missing fixture export was added without changing navigation proof, comparator, masks or thresholds; all eight local appearance/terminal captures then completed. The partial Linux artifact contains20 production captures:16 non-changelog panels have zero differing pixels and only the four expected changelog panels differ. All four were visually reviewed, but this partial artifact is not complete KILV acceptance and was not used to update baselines.

Group24’s en/cn/de requirement was checked explicitly before finalization. The October1 title and five bullets now come from the catalogs for display only: the parser, canonical English identifier, historical entries, timeline keys and unread storage are unchanged. Seven focused locale/identity tests, typecheck and i18n passed, followed by production export/smoke and eight actual exported-page journeys in Chinese/German at1440×900 and390×844, light/dark. All translated bullets were present and reachable without horizontal overflow or page errors. Independent review confirmed the source hashes match the render manifest.

The complete Linux comparison on `dc87382bea2b5fb3caaea00432d12a43097709ce` ([Quality run36908936569](https://github.com/NickGuAI/HappyHerd/actions/runs/36908936569), [capture artifact](https://github.com/NickGuAI/HappyHerd/actions/runs/36908936569/artifacts/11185738971)) contains all28 variants. All24 non-changelog panels have zero differing pixels; only the four changelog panels differ, with unchanged dimensions. All four are byte-identical to the individually reviewed initial captures. After that workflow completed, the approved `golden:update` command imported its captures. Exactly the four reviewed changelog PNGs changed; the other24 baseline files remained byte-identical. Final-head CI must confirm the new baselines, including unchanged English rendering after catalog localization.

The proposal-automation read-only query returned no listed automations or blocked runs. It did not prove the requested schedule/latest-run state; no production automation was created or changed to fill that evidence gap.

Both Linux Unit tests and Contracts on `dc87382b` reached the server suite and failed only the new oversized-polling test at its existing5,000ms limit. Local transport diagnostics found the actual41MiB text request caused Engine.IO to rescan its growing buffer on every chunk; cleanup took0–1ms and was not the cause. The test now retains actual 1,400,000-byte polling acceptance, checks the advertised40MiB cap, and sends the full41MiB payload through the production WebSocket transport, requiring close1009 and no oversized metadata delivery. The send callback is awaited. The production configuration, payload sizes and timeout are unchanged; no synthetic413 or reduced cap is used. Explicit test-only WebSocket dependencies reuse versions already in the lock graph. Focused test and server typecheck passed on Node20; final-head suites remain required.

Additional group2/18 Web journeys close the previously indirect layout evidence: four real-Unistyles timestamp/unread cases, four chip-label-edge/long-model/fixed-Send cases, and the existing single-Agent-chip Streamline case expanded to all four viewport/theme combinations. All12 captures were independently inspected; see [layout journeys](acceptance/issue-370/layout-journeys/README.md). The first simplified timestamp harness was rejected for missing Web reveal styles; the final case uses the actual formatter/style runtime and checks visible text edges. Exact-zero-opacity hover controls are excluded only from visual occlusion, not pointer-target claims. Production styling, existing assertions and timeouts remain unchanged. The complete suite gains10 cases, included in the4,222 passing app cases of the latest full run.

The first full attempt on `8e01a25f` passed365 app files and4,221 cases, with10 existing skips, but the existing Focus pixel-animation sampler exceeded its unchanged150ms tolerance by16.3ms in one case. The animation production files are byte-identical to `793b05b8`. The unchanged focused case passed both themes; independent review identified sensitivity to uneven frame delivery, while noting that the original log cannot prove the scheduling cause. A second full contract run on the same clean head passed, including all17 shell cases. No production code, threshold, timeout, assertion or skip was changed in response. Both full-run logs and the focused result are retained.

Session continuity was separately repeated:8 files/182 cases passed. The local proposal-automation readback was repeated through the existing daemon control endpoint and still returned zero automations. This does not establish the required schedule or latest run; no automation or shared daemon was changed.

These Web journeys use real production components, synthetic data/transport and Chromium clicks at the required sizes/themes, with independent visual inspection. They cover human-facing behavior without claiming authenticated provider effects or a separate human-person signoff. Native iOS/Android rendering and gestures, physical wake, remain the explicit device boundaries described above; Group 1 and real historical continuation are tracked separately as required acceptance.

The frozen install was repeated from a clean tracked tree on `8e01a25f` with Node20.20.2/pnpm10.11.0 and produced no tracked changes. i18n again validated1,677 keys per locale,45 routes,339 surfaces and84 smoke cases. CLI/server production builds, Web export/title check and React-mount smoke all passed. This final report update is a separately ledgered documentation-only follow-up; exact-head CI and review outcomes are linked from PR374.


## Acceptance correction: Group 1 and historical continuation

The owner confirmed that issue #370's Group 1 is a settled decision, not a new
approve/reject question. Its persistent checklist and help content belong in
HappyHerd's existing screens. The earlier presentation blocker and PR review
handoff were withdrawn; the PR returned to draft while these acceptance items
are completed. No upstream onboarding layout, copy tone or visual treatment is
introduced.

The intended visual delta is limited to completion marks within the existing
native install/run badges and a secondary Get help action on first-run and
QR/manual recovery screens. The existing first-run secondary-action geometry
is reused (40px minimum height plus 4px top margin); its added height can move
centered content. Checklist bodies remain expanded, step 3 stays static and
Web has no new checklist. The existing alert shows localized help and links to
the maintained issue destination. Offline detection and Troubleshoot/Copy AI
prompt, CLI-first pairing and account recovery keep their existing owners.
The sixth localized release-note bullet describes this behavior. These are
issue-scoped expected pixels, not unexplained KILV drift; comparator settings
and masks remain unchanged.

### Historical continuation: concrete missing prerequisite

The required real continuation has not been performed. Read-only source and
file-presence investigation found no existing isolated authenticated historical
runtime in the issue artifact scope. The configured HappyHerd home belongs to
the shared production daemon. Authentication, machine identity, encrypted
reconnect state and daemon state derive from the same home. Starting the
exact-source daemon against it can stop a version-mismatched shared daemon;
retaining its machine identity also registers the shared remote machine.
Standalone supported Claude/Codex resume paths invoke authentication setup and
`ensureDaemonRunning`, so they do not provide an isolated bypass. Even the
supported session-inspect path persists authoritative reconnect state.

The missing prerequisite is an existing isolated authenticated home/machine
containing an inactive genuine historical HappyHerd session, with its original
provider thread/state/path and reconnect material, that can be operated under
the current issue authority. The parent has been asked for its path and session
ID, never credentials. No credential or reconnect material was copied, no
session turn was sent, and no shared daemon/account/automation was mutated.
A fresh synthetic session or unrelated sidecar restart would not satisfy this
proof. The 182 continuity fixtures remain supporting evidence only.

The read-only zero-automations result remains a bounded external evidence gap.
Per `.dev/playbooks/development-lifecycle.md` and `.dev/VERIFY.md`, machine-local
proposal automation is not a GitHub/team gate and does not hold the PR in draft.


### Group 1 verification before the refreshed full run

Node 20 focused checks passed: three files / five tests for actual rendered
batched toggles, external-link rejection/retry and real local persistence
load/save/reinitialization. The first implementation review found stale toggle
snapshots and an unhandled external-link rejection; both were corrected and
independently cleared. Initial renderer failures were incomplete theme/artwork
fixture boundaries; their logs remain separate.

Production-component Chromium journeys passed all 24 cases across en/cn/de,
1440×900 and 390×844, light/dark. Each Help journey visits first-run and both
recovery routes through the real modal host, including cancellation, failed
external navigation, error dismissal and retry. The native-branch journey
proves independent toggles, component remount/page reload retention and the
existing offline troubleshooting/copy action. Seven existing first-run
reachability cases also passed after the browser fixture supplied the new
storage contract and `process.env` import boundary. Existing assertions and
five-second timeouts were unchanged. Native branch rendering is emulated in
Chromium and does not claim actual device/MMKV/camera proof.

[Group 1 captures and source hashes](acceptance/issue-370/group1/README.md)
contain 16 German checkpoints, the longest help-copy case. The eight real
production-export Chinese/German changelog journeys were repeated with all six
bullets and final-bullet reachability; their refreshed
[captures](acceptance/issue-370/changelog-locales/README.md) retain exact source
hashes. App typecheck, production export and React-mount smoke passed.
Generated i18n/inventory checks report 1,680 keys per locale, 45 routes,
340 surfaces and 84 smoke cases with zero hardcoded-copy exceptions. Changelog
parsing retains 175 entries and the existing October 1 canonical title.

The refreshed full contract run, exact-head CI and intentional Linux KILV
baseline update are pending this commit; prior head results above are historical
supporting evidence rather than acceptance of this new source.


Independent visual inspection covered all 16 Group 1 captures and four mobile
localized changelog endings. New help text/buttons and completion marks are
readable and visible. The German phone QR screen retains a pre-existing long
alternate-recovery button label overflow behind the modal: its label,
RoundButton source, geometry and typography are unchanged from the frozen
base. This is documented as a retained limitation, not a new regression or a
claim that every background control is visually perfect.


The first Group 1 full run passed 369 app files and failed all 18 cases in the
remaining signed-out route fixture. Focused diagnosis captured `process is not
defined`: the new Help import reads product configuration, but this older
browser harness did not supply `process.env`. Supplying that fixture boundary
restored all 18 original journeys without changing their assertions or 20-second
timeouts. The first new commit also failed the canonical commit-identity check;
its author/committer metadata was corrected without changing its tree, and the
corrected head passed public-boundary verification. Both first failures remain
in the issue artifacts.

Two independent complete Linux comparisons of the identical Group 1 source
produced byte-identical captures: exactly eight restore and four changelog
panels differed, with 16 exact matches and no dimension changes. Two mobile
manual-restore variants include minor existing-button text/corner raster
changes. Same-browser prior/current exports on macOS have identical computed
button/text styles, bounds and button pixels; only enclosing height grows by
44px. Linux-only same-export diagnostic captures now record the button with
Help present/hidden after the original unmodified golden capture. These files
are separate from the 28 baseline panels and do not change thresholds, masks,
accepted UI states or baseline selection.

The first Linux diagnostic captured the light phone panel, then failed while
restoring the hidden Help control because a role locator excludes hidden
elements. Retaining its original element handle fixes that diagnostic boundary;
the full 20-panel production capture now completes locally with both diagnostic
JSON files. The retained Linux light pair is conclusive: Help-present matches
the preceding actual image, while Help-hidden matches the entire old expected
image pixel-for-pixel. Thus the light button raster delta is caused by Help
presence, not a separate control/style change. Dark-theme attribution and the
complete Linux comparison remain pending the corrected diagnostic run.
