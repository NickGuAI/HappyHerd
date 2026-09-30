# Issue 345 authenticated acceptance

Owner: [#345](https://github.com/NickGuAI/HappyHerd/issues/345). PR: [#367](https://github.com/NickGuAI/HappyHerd/pull/367). Durable session: `cmun8rx40083it0o1o82chj4s`.

Runtime source: `62eaa1555621d35a4ab1042d111c2afed850bf1d`; comparison base: `0217e4c629415eda601856cd21e535489e5e1f06`. This continuation validates the existing implementation under the owner's authorization for reversible isolated deployment, authenticated journeys and native test builds. Shared production services were not installed, restarted or reconfigured, and other sessions' runtimes were not changed. The earlier default-service test-account mistake is disclosed below.

## Original acceptance

| Criterion | Web Desktop | Web Mobile | Native app |
| --- | --- | --- | --- |
| Title-row Done marks every Inbox update read | PASS: real click, persisted account feed | PASS: real touch gesture, persisted account feed | Pending installed-app execution |
| Inbox bell's unread indicator clears | PASS: indicator absent after Done | PASS: indicator absent after Done | Pending installed-app execution |
| Reading a single update still works | PASS: one timestamp changes; exact automation destination retained | PASS: one timestamp changes; exact automation destination retained | Pending installed-app execution |
| Cards show a dot until read; Done clears all dots | PASS: per-ID dots before/after; newer arrival stays unread | PASS: per-ID dots before/after; newer arrival stays unread | Pending installed-app execution |

Independent friend-request, app-update and changelog indicators keep their established behavior. The live accounts had none of those independent notifications; focused hook tests cover them. Live feed content is the supported `automation_blocked` kind. Text/friend/accepted-friend and all shared platform branches retain the existing focused regression coverage.

## Real Web deployment and evidence

[Machine-readable receipt](web/web-acceptance.json), [executed acceptance runner](web/run-web-acceptance.mjs).

All **13 stages passed** from `2026-09-30T02:15:10.637Z` to `2026-09-30T02:15:23.530Z`. Thirteen Inbox screenshots and 29 sanitized received feed socket updates were retained. Chrome `154.0.8037.58`, Playwright `1.62.1`, Desktop `1440×900`, Mobile `390×844` with `isMobile` and touch enabled. Web Mobile is a touch/viewport browser run, not a physical-phone claim.

The exact production Web export is served at `http://127.0.0.1:43545` by the actual standalone Fastify server, with account authentication, Socket.IO and disk-backed Prisma/PGlite. All 41 real migrations, including the additive read-state migration, were applied only to this isolated database. The maintained self-host configuration supplies the same-origin API address. No response interception, injected application state, mocked authentication or socket transport is used.

Accounts A and B were generated only for this isolated deployment. Each client logged in using the normal **Restore with Secret Key → Restore Account** UI and the canonical grouped backup-key format. Keys and tokens stayed in process memory or the application's normal authenticated storage; no keys, tokens, storage dumps, traces or runtime databases are included here. Feed events were published through authenticated `/v1/machines` and `/v1/feed/automation-blocked` APIs, then received through actual transport. The publisher machine is an offline protocol record; this proves Inbox behavior and does not claim a provider/daemon execution journey.

The HTTP-served entry `/_expo/static/js/web/index-dc8f96e38ff59f6ca91744088ab9cb86.js` embeds the exact runtime SHA and has SHA-256 `47716f0051901a89d3454d0ee911f3626e7a5acfff784e97b763d461ffe586c2`. An independent read-back matched the export's entry JS/CSS hashes to the build manifest.

| Journey | Direct evidence |
| --- | --- |
| Empty Inbox | Normal bell → Inbox navigation; Done disabled, no card/bell dots. [Desktop](web/desktop-empty-inbox.png) |
| Per-item unread state | Two real persisted unread updates appear on both clients. [Desktop](web/desktop-two-unread.png), [Mobile](web/mobile-two-unread.png) |
| Desktop single read | Actual card click immediately navigates to the exact machine/automation; only that ID gets `readAt`; passive mobile receives a real `feed-read` event and loses only that dot. |
| Desktop Done | Actual title action persists the observed snapshot and clears both clients. [Desktop](web/desktop-done-cleared.png), [passive Mobile](web/mobile-socket-cleared.png) |
| Mobile single read and Done | Actual card tap and title-action tap update the server and passive desktop; exact automation destination preserved. [Mobile](web/mobile-done-cleared.png) |
| Already read/repeat delivery | Another Done and duplicate publisher episode preserve IDs, cursors and original read timestamps. |
| Reload | Both clients reload normally; the same four read timestamps remain and dots stay absent. |
| Offline/reconnect | Observed authenticated mobile socket closes before desktop Done. Mobile keeps its old dot while offline, then a new authenticated socket and real feed fetch reconcile it. [Offline](web/mobile-offline-unread.png), [reconnected](web/mobile-reconnected-cleared.png) |
| Arrival during Done | Real Chromium network latency leaves Done pending; a new real publication has a cursor beyond the sent snapshot and remains unread on both clients. [Desktop](web/desktop-new-arrival-unread.png), [Mobile](web/mobile-new-arrival-unread.png) |
| Account scope | Account B starts empty. A Done leaves B unread; B cannot read A's item by ID; B Done leaves A unread. [B after Done](web/account-b-done-cleared.png) |
| Durable service restart | Only the designated isolated server child restarts, retaining its master secret in parent memory and its database on disk. Existing tokens, cursors and read timestamps survive; both clients reload with the correct remaining unread update. [Desktop](web/desktop-after-server-restart.png), [Mobile](web/mobile-after-server-restart.png) |

### Commands and configuration

Toolchain: Node `20.19.0`, pnpm `10.11.0`, Bun `1.3.11`; `TZ=UTC`. The fresh export used a task-private Metro cache:

```sh
APP_ENV=production \
HAPPYHERD_BUILD_COMMIT_SHA=62eaa1555621d35a4ab1042d111c2afed850bf1d \
EXPO_PUBLIC_HAPPYHERD_SERVER_URL=http://127.0.0.1:43545 \
TMPDIR="$PWD/.artifacts/issue-345/live-acceptance/web-tmp" \
pnpm --dir server --filter happyherd-app exec expo export \
  --platform web --clear \
  --output-dir "$PWD/.artifacts/issue-345/live-acceptance/web-dist-fresh"
```

The export was verified and moved to `web-dist`. The isolated launcher runs `node --import <repo>/server/node_modules/tsx/dist/loader.mjs sources/standalone.ts serve` from `server/packages/happyherd-server`, with `<repo>` resolved to the absolute worktree path, with `DB_PROVIDER=pglite`, task-owned data paths, loopback host/port, the exported static directory, `METRICS_ENABLED=false`, and a randomly generated master secret held only in parent memory. `HAPPYHERD_INJECT_HTML_CONFIG` sets the loopback server URL and disables analytics. Its explicit `SIGUSR2` handler restarts only its own child; it is not a shared-service supervisor.

The retained runner is a snapshot of the executed script. Copy it into `.artifacts/issue-345/live-acceptance/` and import that copy: it resolves workspace dependencies and isolated PID-file paths relative to its own module URL, not the shell working directory. Never print its return object, which intentionally holds in-memory credentials for the subsequent native journey:

```js
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = await runAcceptance({
  browser,
  origin: 'http://127.0.0.1:43545',
  artifactDir: live + '/web-final-62eaa155-attempt4',
  sha: '62eaa1555621d35a4ab1042d111c2afed850bf1d',
  runnerPid: 50629,
});
// Inspect only result.receipt; do not serialize result itself.
```

## Retained setup failures

The first export reused stale Metro build metadata. It was superseded by the private-cache `--clear` export and none of its captures count as final evidence. Before this correction, one normal restore reached the default service and created an empty generated test account; no existing account data was accessed. The context was closed and its credentials were not retained or used for acceptance.

The first final-build run found the earlier isolated runner had exited and failed before authentication. The task server alone was relaunched and health-checked. The next run passed nine stages but an observer retained a pre-reload socket; connection tracking was corrected to observe the current document's authenticated connection and actual close. A later run passed eleven stages but a random raw base64url key containing a hyphen was interpreted by the existing restore parser as a formatted key. The runner now uses the application's canonical grouped-base32 backup format. None of these corrections changes product code or weakens the required assertions. All attempt receipts remain under the task's ignored artifact directory.

The prior local contract failure and historical CI failures remain disclosed in the PR. This live receipt does not relabel those failures as passes.

## Native acceptance

The exact hosted Release app has been built, independently verified and installed on a private iOS simulator. Authenticated Inbox execution remains pending. Export, shared renderer tests and installation are not a native interaction pass. This section must be completed with the selected artifact, simulator/device identity, actual gestures and sanitized captures before full issue acceptance is claimed.

### Native setup attempts retained

Eight local native build attempts produced no application. Their receipts distinguish generated-project/deployment-target errors, incompatibilities between the installed Swift 6.4 compiler and RevenueCat 5.65.0 source or prebuilt interfaces, and stops at the agreed swap/RAM-volume reserves. An isolated copy of the SDK used the upstream initializer relocation while investigating compiler compatibility; it compiled that dependency but never produced an app. That copy is not native acceptance evidence. All original logs, SDK provenance and resource-stop receipts remain in the task's ignored artifact directory.

The unmodified hosted build uses explicit Xcode 26.2 and unchanged locked dependencies. Its [first attempt](https://github.com/NickGuAI/HappyHerd/actions/runs/36664180944) failed before compilation because CocoaPods resolved Expo from the repository root; the next revision runs `pod install` from the generated iOS project. The temporary build recipe also exposed a rename-contract failure for two intentionally retained environment-variable compatibility names. The maintained compatibility annotations correct that recipe; the Contract suite on `67a22ead` actually passed ([run](https://github.com/NickGuAI/HappyHerd/actions/runs/36669543933/job/109741429609)). The final evidence commit will require its own passing checks.

The [second hosted attempt](https://github.com/NickGuAI/HappyHerd/actions/runs/36664567677) was cancelled at its 60-minute job limit. Its [uploaded failure artifact](https://github.com/NickGuAI/HappyHerd/actions/runs/36664567677/artifacts/11077656070) preserves the complete 23,251,338-byte compiler log. Native work progressed at `04:28:04.467Z`, followed by more compilation and the Expo updates resource script before cancellation at `04:29:00.361Z`. No compiler error or prolonged final-script hang was established. Several SDK libraries reached archive steps, but the app verification step was skipped and no completed app is claimed.

Independently reviewed `67a22ead631e384802e5f7a8657ff674c07ab28d` restores the generated project's normal Release compiler settings, removing the local experiment's single-file/no-batch overrides. It retains Xcode 26.2, one build job, `-O`, arm64 and original SDK sources. The build step has a bounded 75-minute budget within a 90-minute job, with `pipefail`, streamed logs, build timings and upload headroom. These build resource budgets do not change product test timeouts, assertions, skips or golden thresholds. The [third hosted attempt](https://github.com/NickGuAI/HappyHerd/actions/runs/36669543990) **passed**. The Release build completed in 36m59s and produced [artifact 11078832466](https://github.com/NickGuAI/HappyHerd/actions/runs/36669543990/artifacts/11078832466). Root and independent review matched all 729 app files; archive SHA-256 is `d28905ccf3fcf3d8156a44798a018d766d123afeb3982585a0bcbc56ad8d6133`. Extraction, arm64 executable, embedded SHA, bundle ID and isolated API address also passed verification. The native app is unchanged from that artifact.

The separately compiled XCTest runner is test tooling, not the product app. Its successful build alone proves no Inbox gesture. The native test uses the normal public-key QR request and real companion approval endpoint; it does not type an account key or inject authenticated app state. Explicit image attachments are limited to the server selection screen and authenticated Inbox.

### Local installed-app attempts

The private iPhone 17 / iOS 27.0 simulator installed the exact app and verified
`http://127.0.0.1:43545` in its normal Server Configuration screen. An initial
XCTest configuration used a physical-device-only artifact option and stopped
before authentication; restoring the generated simulator artifact paths fixed
that setup error. The next attempt actually tapped **Login with mobile app**.
The isolated server received successful authentication-request polling, but the
test's Vision decoder did not recognize the visible public QR within its bound.
No companion approval or Inbox checkpoint occurred; the app was terminated
before recording the sanitized failure. The precise QR decoder/rendering cause
was not established.

An independently inspected Core Image decoder replaced only the test-side
screen decoder and the test runner rebuilt successfully. Its next execution
stopped at resource preflight: shared-host swap was `10304.25 MiB`, above the
unchanged `10258.88 MiB` limit. No native test ran in that attempt. The task's
private simulator was shut down and its evidence preserved. Reducing the task
RAM disk from 4 GiB to 3 GiB did not lower global swap; the remaining native
journey is therefore being moved to an independent macOS CI machine with a
fresh private simulator, server and generated accounts. The local browser,
server, coordinator and RAM volume were then released; no shared service or
existing simulator was changed. These local attempts remain failures, not
native acceptance passes.

### Continuation CI failure retained

At `6f73a629`, [Contract run 36676547729](https://github.com/NickGuAI/HappyHerd/actions/runs/36676547729)
failed one unchanged Focus animation timing assertion: the measured onset
difference was `152.447058823576 ms`, above its existing `<150 ms` bound. The
app suite otherwise had 3,939 passes and ten existing skips. The same-head Unit
job passed the app suite, and the complete product tree is identical to the
previous passing `62eaa155` and `67a22ead` Contract revisions. The first failure
log is retained. No timing threshold, assertion or skip was changed; a later
exact-head Contract pass is still required.

The later [`6ccb8dc5` Contract run](https://github.com/NickGuAI/HappyHerd/actions/runs/36678849724/job/109769738810)
passed with the identical product tree and no animation/test changes. This
establishes intermittency across those executions; it does not establish the
precise scheduling cause or relabel the first failed run. Final delivery still
requires passing checks on its own exact head.

At [`f3cc900a` Unit](https://github.com/NickGuAI/HappyHerd/actions/runs/36683230740),
three unchanged browser-suite setup hooks exceeded their existing 30-second
bound: CredentialsSettingsView, desktopWorkspace and sideChatHeader. 3,702 app
tests passed; 238 did not run because setup failed, alongside ten existing
skips. Later package suites did not execute. The exact stalled setup operation
is unknown. Independent comparison matched the test/configuration files to main
and the complete product tree to passing `39f46cbf`. The [same-head Contract
suite](https://github.com/NickGuAI/HappyHerd/actions/runs/36683231386/job/109783220202)
passed; this supports intermittency without relabeling the failed Unit run. No
threshold or skip changed and no manual Unit retry was performed.


At [`4933c0c7` Unit](https://github.com/NickGuAI/HappyHerd/actions/runs/36733047931/job/109947545876),
the same three unchanged browser setup hooks exceeded 30 seconds: Credentials
Settings, desktop Workspace and side-chat Header. 3,702 tests passed; 238 did not
run after setup failure, plus ten existing skips. Their files, the complete
product tree and both verification workflows are byte-identical to passing
`7bb61275`. The log does not identify which fixture/server/browser setup phase
stalled and contains no classified resource-exhaustion signal. This supports
intermittent setup timing, without establishing its cause or relabeling the
failure. The [same-head Contract suite](https://github.com/NickGuAI/HappyHerd/actions/runs/36733047067/job/109947530173)
passed all 359 app test files and 3,940 tests, including all 238 tests from those
three suites; only the ten existing skips remain. No timeout, threshold,
assertion or skip was changed; final-head Unit and Contract passes remain
required.

### Launch rejection and normal-signing build comparison

The narrowed diagnostic at `7bb61275` completed its owned-simulator query without
truncation or timeout. [Run 36729388901](https://github.com/NickGuAI/HappyHerd/actions/runs/36729388901)
([artifact 11104637921](https://github.com/NickGuAI/HappyHerd/actions/runs/36729388901/artifacts/11104637921))
again failed at activation before startup, authentication or Inbox. It retained
only launch-rejection enums and safe domain/code pairs: `FBProcessExit/64`,
`FBSOpenApplicationServiceErrorDomain/1`, `RBSRequestErrorDomain/5`,
`NSPOSIXErrorDomain/162`, and `NSOSStatusErrorDomain/-10814`. No crash signal was
observed. Apple's signed `/bin/launchctl error posix 162` decodes the underlying
code as `162: Codesigning issue` on the local macOS 27.0 build 26A428; the
hosted comparison repeats that read-only decoder and retains only a fixed enum.
This supports a signing-related failure class, but does not identify a unique
signature or entitlement defect. All 13 real Web stages passed with the new
transparent transport relay; the full 16-checkpoint native continuation remains
unproved.

The next bounded build comparison uses the successful Xcode 26.2 Release recipe
with only its explicit signing-disable override removed. This is supported by
the observed contrast: the original artifact reached normal QR authentication,
while its verified signature-only derivative repeatedly fails before startup.
That contrast and the domain-specific decoder support investigating the signing
path, without claiming an identified entitlement defect. Xcode will generate and
apply its normal simulator signing configuration; no guessed entitlement, developer account or provisioning profile
is introduced. Apple describes simulator [Sign to Run Locally](https://developer.apple.com/forums/thread/826882)
as ad-hoc signing that needs no Apple Development identity.

The original archive and custom derivative failures remain preserved. A new
build must have its own manifest, archive hash, effective-signing metadata and
sanitized generated-entitlement evidence before selection for native acceptance.
It cannot inherit the prior derivative's claim of unchanged executable bytes.
The [normal-signing recipe](native-signed-build-workflow.yml) is an experiment
until the installed artifact completes normal authentication and all native
criteria. It changes no product source, initial activation call, assertion,
timeout, screenshot requirement or skip.

For this build-only comparison, the existing journey temporarily accepts only
`opened` and `reopened` pull-request events, preventing a synchronize event from
rerunning the already-failed derivative. Pull-request path filters alone cannot
isolate this experiment because they evaluate the whole PR diff. Restore
`synchronize` when the new artifact is verified and selected. No native pass or
acceptance skip is claimed for the build-only head.


The [normal-signing build](https://github.com/NickGuAI/HappyHerd/actions/runs/36733047107)
at `4933c0c7` passed its Release build in 49m58s, signing verification and archive
upload. [Artifact 11109961474](https://github.com/NickGuAI/HappyHerd/actions/runs/36733047107/artifacts/11109961474)
contains 736 manifest-verified files; its archive SHA-256 is
`0a692dee476bc6fb12a79879a75fb7865c7ace0c2c3ab4960b90b26cc1d762b5`.
The [build evidence](native-signed-build-evidence.json),
[complete manifest](native-signed-build-manifest.json) and
[sanitized signing receipt](native-signed-signing-receipt.json) are retained here.
The durable manifest uses standard JSON Unicode escapes for at-signs in image
filenames, which the publication checker otherwise misclassifies as emails.
Parsed filenames/hashes are unchanged, and reversing only those escapes
reconstructs the original manifest bytes and recorded SHA-256 exactly. The
signing receipt remains byte-identical to the build output.
Read-only archive and extracted-app verification, including strict codesign,
passed. Product source remains unchanged.

The hosted macOS 26.6.2 decoder also maps POSIX 162 to `codesigning-issue`.
Xcode enabled local ad-hoc signing without a development team. It generated
normal and simulator entitlement inputs: only the simulator input reports an
application identifier matching this app; the normal XML signature reports no
application identifier. These are fixed presence/match flags, not raw entitlement
values. Independent Mach-O inspection also found the normal build contains
simulator XML and DER entitlement sections absent from the original unsigned
build. These differences support using Xcode's own simulator-signing path; they
do not yet prove startup, normal authentication or Inbox behavior, or isolate a
single cause of the earlier signature rejection.

The next journey selects the original normally signed artifact directly and
verifies every installed manifest file, with no post-build re-signing. The
journey's synchronize trigger is restored; the completed build comparison's
synchronize trigger is suspended to avoid rebuilding an already selected
artifact. Both retained workflow recipes match their active copies. All prior
failures, assertions, timeouts, screenshots, checkpoints and skips remain
preserved. Native acceptance is still unproved until the full journey passes.

The subsequent installed-artifact diagnostic found six permission mismatches
while all 736 file hashes, file/member sets, types and link targets matched.
The [retained failure history and preparation](hosted-native/README.md)
describe conditional restoration of only the six declared framework executable
permissions on the owned simulator, followed by all original integrity and
strict signature checks. The archive and app bytes remain unchanged, with no
re-signing. This preparation is an explicit installed-metadata change; at that
point native launch, authentication and the full Inbox journey remained unproved.

The subsequent [native attempt 13](https://github.com/NickGuAI/HappyHerd/actions/runs/36748692792)
passed the actual installed-permission restoration and integrity checks, native
startup, normal QR authentication and the first eight persisted checkpoints.
Per-item navigation/read, Done/bell/card dots, authenticated relaunch and real
arrival/remote-Done now have installed iOS simulator proof in that failed run.
The test then failed during normal logout before account B; the remaining
account-scope, native Done race and durable restart/reconnect criteria are still
unproved. The [retained history](hosted-native/README.md) records the source-based
phone drawer navigation correction and all original failure hashes. Partial
checkpoint success is not a full native acceptance pass.

The first `a6f1b8b3` macOS x64 installer job failed during the second isolated
host's installer-rerun stage with child exit 1. Both normal pairings and encrypted
RPC checks, nine self-host tests and the first host's retained-history upgrade
had passed. The exact failed child and cause were not retained by that test's
output. [Sanitized independent review](ci-a6f1b8b3-installer-failure.json)
preserves the failure, original log hash and comparison to the unchanged,
fully passing `bba99d30` installer source. The other three current targets passed.
One independently justified retry of only the failed job was started in
[run 36748692750, attempt 2](https://github.com/NickGuAI/HappyHerd/actions/runs/36748692750/attempts/2).
That retry passed: both normal pairings, both encrypted RPC checks and both
retained-history upgrade checks completed, with the final macOS x64 success
marker. The [sanitized retry receipt](ci-a6f1b8b3-installer-retry.json) binds its
private log hash and exact job; the first failure remains separate and unchanged.
No threshold, assertion or skip was changed. Final delivery still requires all
four targets on the final head.


[Native attempt 14](https://github.com/NickGuAI/HappyHerd/actions/runs/36752956252)
failed during resource monitoring of simulator boot, before app installation or
native UI. All 13 Web stages passed. Source and receipt timing distinguish a
ten-second resource-probe timeout from the unexpired 600-second boot deadline;
the exact probe was not retained. Cleanup succeeded, and completed samples
remained above the original floors. The [failure ledger and diagnostic recipe](hosted-native/README.md)
preserve the failure and add only fixed probe attribution, without changing
commands, timeouts, sampling or acceptance criteria. The drawer correction and
remaining native criteria are still unproved.


[Native attempt 15](https://github.com/NickGuAI/HappyHerd/actions/runs/36755579409)
passed resource monitoring, normal QR authentication and checkpoints 01–08.
The drawer correction completed Settings and Account navigation actions. It then failed
the Logout row visibility query within the unchanged twelve-swipe limit, before
any logout or B link. The [retained source review and failure history](hosted-native/README.md)
identify the test's unsupported label-prefix assumption and the targeted row
query correction. No resource-probe failure occurred, all 13 Web stages passed,
and cleanup succeeded. Full native account scope, race and restart remain
unproved.


The `ec7567a7` macOS x64 installer job also failed with unchanged installer,
test, workflow and product source, after all four targets passed on `7487650d`
and `7d570f36`. [Run 36759521990, job 110038207154](https://github.com/NickGuAI/HappyHerd/actions/runs/36759521990/job/110038207154)
passed both normal pairings, nine self-host tests and the first host's RPC and
retained-history upgrade. The second host's initial `daemon start` child then
exited 1 without a reported timeout. This is a different stage from the prior
`a6f1b8b3` failure. The [sanitized independent diagnosis](ci-ec7567a7-installer-failure.json)
preserves the exact child boundary, source comparisons and original log hash;
the captured child output was discarded, so its root cause remains unproved.
The other three installer targets passed. Narrow command/failure attribution is
being added to the test harness before another run, retaining all commands,
timeouts, assertions, authentication, continuity checks and cleanup. Only fixed
labels/categories and safe numeric fields may be published, never raw child
output, messages, arguments, paths or account material.


[Native attempt 16](https://github.com/NickGuAI/HappyHerd/actions/runs/36759522116)
proved the corrected Logout query: one matching row became hittable after two
swipes, and the normal Logout and confirmation taps completed. The app then
became not-running before login returned, so no B authentication occurred.
Native checkpoints 01–08 and all 13 Web stages passed; the full native test still
failed, with successful cleanup. [Retained evidence and bounded crash diagnostics](hosted-native/README.md)
preserve the unknown cause and inspect the owned app's reload/process failure
without changing the journey or automatically reopening the app.

[Native attempt 17](https://github.com/NickGuAI/HappyHerd/actions/runs/36764889053)
repeated the same post-Logout failure after checkpoints 01–08 and all 13 Web
stages passed. One recent app-named crash-report candidate failed exact identity
checks; no crash was classified, so the cause remains unknown. The
[retained failure and next narrow diagnostic](hosted-native/README.md) distinguish
the rejected identity predicates without relaxing ownership or changing behavior.
On that exact head, all six required gates passed in
[Quality](https://github.com/NickGuAI/HappyHerd/actions/runs/36764889054) and
[Contract](https://github.com/NickGuAI/HappyHerd/actions/runs/36764889068), as did
[all four installers](https://github.com/NickGuAI/HappyHerd/actions/runs/36764888923),
the [server/Web image](https://github.com/NickGuAI/HappyHerd/actions/runs/36764888996)
and [28 zero-difference goldens](https://github.com/NickGuAI/HappyHerd/actions/runs/36764889054/artifacts/11120097590).

[Native attempt 18](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957795)
again failed after Logout confirmation. The rejected report now shows matching
app identities and exact simulator coalition, with a wildcard-redacted process
path; it still provides no crash classification. The
[narrow diagnostic correction and retained failure](hosted-native/README.md)
bind that observed redaction case to the verified installed binary while keeping
simulator ownership and all journey criteria. At `0534e716`, all six required
gates passed in [Quality](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957771)
and [Contract](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957905), along
with [all four installers](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957803),
the [server/Web image](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957846)
and [28 zero-difference goldens](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957771/artifacts/11123635715).

The first [Unit job at `30ad7634`](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236146/job/110088102577)
failed one desktop Workspace test body at its unchanged 10-second limit. The
other three parameter variants passed; the app suite recorded 3,939 passes,
one failure and ten existing skips. This differs from the earlier three-suite
setup timeout. The registration stack does not identify the stalled gesture.
[Sanitized failure evidence](ci-30ad7634-unit-failure.json) preserves the log hash,
counts and byte-identical product/test/dependency/workflow comparisons against
the two preceding passing heads. Those comparisons do not establish a transient
runner cause. Any retry retains the deadline, assertions and skips; this first
failure remains recorded independently of subsequent outcomes.

The same Workspace variant passed in 5,499 ms in the exact-head
[Contract job](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236131/job/110088116673).
After independent review, one unchanged-head [Unit retry](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236146/job/110095771442)
passed with all original assertions, deadlines and skips retained. The previously
failed variant completed in 3,602 ms; all 48 Workspace cases passed. The app
suite passed 3,940 tests with ten existing skips, followed by passing wire,
control-agent, CLI and server suites. [Sanitized retry evidence](ci-30ad7634-unit-retry.json)
keeps the log hash and exact-head results separate from the first failure; the
precise cause of the first timeout remains unproved.

[Native attempt 19](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236151)
again failed after Logout, with native checkpoints 01–08 and all 13 Web stages
passed. The new ownership checks attributed one report to the exact installed
build and simulator: `EXC_BAD_ACCESS`, `SIGSEGV`, `SIGNAL/11`, captured 11.406
seconds after checkpoint 08 during the later Logout sequence. All ten captures
passed independent visual/privacy and integrity review; resource floors held and
cleanup succeeded. Sixteen symbolized frames yielded no existing fixed tags, so
the failing code remains unknown. The [durable failure and next bounded code
attribution](hosted-native/README.md) preserve this distinction without changing
the product or any native acceptance criterion. At this head, [all four
installers](https://github.com/NickGuAI/HappyHerd/actions/runs/36774235855), the
[server/Web image](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236533)
and [28 zero-difference goldens](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236146/artifacts/11125576210)
passed. Native acceptance remains incomplete.
