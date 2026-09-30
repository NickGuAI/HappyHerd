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
