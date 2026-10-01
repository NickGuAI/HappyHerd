# Upstream integration through 4cf54d18 — issue #370

This integration preserves HappyHerd's current interface and owned contracts while importing the approved upstream behavior. **Acceptance is in progress. Group 1's visible checklist/help affordance is awaiting the owner's presentation decision; no completed-delivery claim is made for that portion.** [Draft PR #374](https://github.com/NickGuAI/HappyHerd/pull/374) must stay open for Athena. No merge to main, deployment, shared installation, daemon restart, account mutation, or historical production-session continuation is authorized by this report.

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
| 1 | Partial / owner decision pending. Existing offline detection, restore navigation and pairing success UI retained; existing troubleshooting content extended with the maintained help destination. Persistent setting schema exists, but a hidden setting is not counted as a delivered visible checklist. [Blocked note](https://github.com/NickGuAI/HappyHerd/issues/370#issuecomment-5936506702). |
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
| 24 | Own October changelog entry, followed by every retained HappyHerd/upstream historical entry. No imported upstream September replacement notes. |
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
| Full app suite | 365 files;4,205 passed,10 existing skips. |
| Full contract suite | Passed on `0cd3425379b2b8c3ddf5f0bb09ef08f6b3aa22ef`: all repository verifiers, app4,205, wire84, control agent260, HappyHerd agent52, CLI2,088 and server201. |
| `i18n:check` / inventory | 1,675 keys per locale; zero hardcoded-copy exceptions;45 routes,338 surfaces,84 smoke cases. |
| Production Web export / smoke / CLI build | Passed; export and smoke repeated successfully after the Rig edit fix. |
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

See [selected interaction captures](acceptance/issue-370/README.md). Group2/18 Web ownership is additionally covered by retained header/chip/browser suites; native rendering/gesture proof remains separate. Group23 Web attachment paths are covered above; its native chooser remains a device proof gap. Group1’s visible checklist/help controls remain blocked on the numbered owner decision.

Review found and fixed a real newer-Rig-draft race: uncontrolled text could advance before its deferred React mirror was stamped, allowing acceptance to clear the newer live text. Local edits are now stamped at the input event; remote drafts are not restamped and non-Rig debounce is unchanged. Two real-hook/store/writer regressions plus existing send/side-chat cases pass (123 tests total); independent review confirmed the fix.

Additional first failures were retained and corrected at their actual boundaries: a Linux-only shell shortcut in a macOS fixture; a no-op navigation mock in the first New Chat test; a stale installed-router state probe; Expo Web index resolution; duplicate ToolView filenames; and an offscreen image-preview stand-in. Visual review rejected that preview evidence and replaced the fixture with the production modal host plus viewport bounds. Prompt readiness now waits for the real active dialog; an initially assumed return-focus contract was disproved on the exact base before correcting that new test’s expectation. No production focus behavior or timing threshold was changed.

Still required before review clearance: completion of remaining interaction proof, exact KILV comparison and only four changelog baseline updates, exact-head six required CI jobs/verifiers, and review resolution. Native iOS/Android device journeys, physical wake and authenticated live journeys remain explicit proof boundaries. Historical production continuation requires a separately authorized runtime effect under the implementation brief; simulated continuity is not described as that continuation.

The fourth run’s three failures were fixture synchronization races: the unchanged focus timer initially renders against its pre-setup clock before its effect samples the frozen clock, and the phone row test compared moving geometry captured on different frames. The fixtures now wait for the exact expected timer text and measure row/button/text bounds in one evaluation. Exact duration, tick, overlap, containment and timing assertions remain unchanged; no production owner changed. Both original failures and their baseline-source comparisons are retained. Both affected browser files then passed all 56 cases, followed by app typecheck; this focused pass does not substitute for the full rerun.

The first PR Quality run ([36907209569](https://github.com/NickGuAI/HappyHerd/actions/runs/36907209569)) passed Clean install, Lint, Typecheck, production Web export and smoke. KILV stopped before comparison because its static route fixture lacked the newly imported navigation-helper export. The missing fixture export was added without changing navigation proof, comparator, masks or thresholds; all eight local appearance/terminal captures then completed. The partial Linux artifact contains20 production captures:16 non-changelog panels have zero differing pixels and only the four expected changelog panels differ. All four were visually reviewed, but this partial artifact is not complete KILV acceptance and was not used to update baselines.

The proposal-automation read-only query returned no listed automations or blocked runs. It did not prove the requested schedule/latest-run state; no production automation was created or changed to fill that evidence gap.
