# Upstream integration through 4cf54d18 — issue #370

This integration preserves HappyHerd's current interface and owned contracts while importing the approved upstream behavior. **Acceptance is in progress. Group 1's visible checklist/help affordance is awaiting the owner's presentation decision; no completed-delivery claim is made for that portion.** The PR must stay open for Athena. No merge to main, deployment, shared installation, daemon restart, account mutation, or historical production-session continuation is authorized by this report.

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

Post-rebuild: Commander context Chromium matrix (eight cases) and the existing wheel interaction case passed. The focused app run passed 121 tests but exposed one newly reached native dependency in the CommanderContextRow unit fixture; the fixture now passes all nine tests after mocking that native boundary. The inherited range-diff preserves all 683 ledger subjects as exact matches. Two shell animation assertions remain under diagnosis.

Still required before review clearance: final clean frozen install and full contract/package runs, final-head range-diff/verifiers, production export/smoke, all required interaction matrices, exact KILV comparison and only four changelog baseline updates, exact-head six required CI jobs, and review resolution. Native iOS/Android device journeys, physical wake and authenticated live journeys remain explicit proof boundaries. Historical production continuation requires a separately authorized runtime effect under the implementation brief; simulated continuity is not described as that continuation.

The proposal-automation read-only query returned no listed automations or blocked runs. It did not prove the requested schedule/latest-run state; no production automation was created or changed to fill that evidence gap.
