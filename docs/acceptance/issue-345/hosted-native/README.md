# Isolated hosted Inbox acceptance

This temporary acceptance tooling runs the unchanged production app and actual
standalone server. It does not run fixtures or inject authenticated/read state.
The native app comes from successful build `67a22ead631e384802e5f7a8657ff674c07ab28d`
and [artifact 11078832466](https://github.com/NickGuAI/HappyHerd/actions/runs/36669543990/artifacts/11078832466).
The workflow requires its checkout's complete `server/` tree to match that build.

The workflow installs the pinned package toolchain, verifies all native app
files, exports production Web, and copies the three JavaScript helpers plus the
retained Web runner into the task's ignored artifact directory. `controller.mjs`
starts a new disk-backed PGlite database, applies all 41 production migrations,
and runs the 13 real Web stages using normal account-restore UI. It then leaves
two real unread updates for the installed iOS app and approves only that app's
visible public QR through the ordinary authenticated companion API.

`native-driver.py` builds the small XCTest target, creates one new private iOS
26.2 simulator matching the selected Xcode SDK, verifies its exact destination before boot, installs and verifies the selected app, and performs the actual
Inbox journey. The controller responds to its two static markers by publishing
a real incoming update and clicking Desktop Done. Success requires one passing,
non-skipped XCTest, all six ordered persisted checkpoints, native/desktop state
agreement and the deliberate screenshots. The driver cleans up only its newly
created simulator; the controller stops only its own browser/server processes.

Required environment is documented in the workflow and driver. The sensitive
runtime, raw logs, full xcresult and simulator data stay under
`HH345_ARTIFACT_DIR` or `RUNNER_TEMP`. Only explicit sanitized receipts and
allowlisted server/Inbox PNGs go to `HH345_PROOF_DIR`, which is the sole uploaded
directory. No seed, token, QR payload, storage dump or transcript is printed or
uploaded. Test accounts are generated for this isolated deployment, and the
publisher is an offline protocol machine: this is Inbox acceptance, not a
provider/daemon execution claim. A simulator pass is not physical-device proof.

The independent hosted machine has its own recorded resource measurements.
This does not relabel the stopped local attempts or raise their resource limits.
All failed attempts remain separate from any later passing run.

The first hosted journey at `aaf11cf0` reran all 13 real Web stages successfully
but failed before native authentication: Xcode 26.2 did not list the selected
iOS 26.5 private UDID as an available destination. App and runner installation
and hashes had passed; no XCTest Inbox gesture ran. The driver now selects the
installed runtime matching the actual simulator SDK ([Xcode 26.2 SDK](https://developer.apple.com/documentation/xcode-release-notes/xcode-26_2-release-notes)) and checks the destination
before boot, retaining sanitized runtime/destination diagnostics. This corrects
the runtime-selection weakness; the precise prior discovery cause remains
unconfirmed without its private destination log. It preserves the exact-UDID
requirement without changing the app or acceptance assertions.
The first failure remains at [run 36675257832](https://github.com/NickGuAI/HappyHerd/actions/runs/36675257832).

The second hosted journey at `6f73a629` selected installed iOS 26.2, verified
the exact private destination, installed the same app and executed XCTest.
The native screen's QR decoded successfully and the real companion approval
returned HTTP 200. The test then failed waiting for the authenticated bell; no
Inbox checkpoint passed. [Run 36676547772](https://github.com/NickGuAI/HappyHerd/actions/runs/36676547772)
and its sanitized receipt remain preserved.

The next harness revision handles only the normal HappyHerd notification
permission prompt, which production login requests on a fresh native app. It
chooses **Don't Allow** for this isolated test device; feed reads use the real
HTTP/socket connection and do not require push permission. The prior attempt's
route/error flags were sampled before approval, so the precise post-link failure
cause is still unconfirmed. Refreshed booleans now distinguish the current
login/restore/bell and app/system alert states, without retaining their content.
The companion also reads its approval back through the normal request endpoint,
asserting the stored encrypted response matches entirely in memory. That
read-back is not proof of native consumption. The 60-second authentication
bound and every Inbox assertion remain unchanged.

The third hosted journey at `6ccb8dc5` again decoded and approved the actual
native QR; the companion read-back confirmed the server retained exactly the
encrypted response and an authorized token. Fresh native diagnostics showed
the app in the foreground on its restore route with an app alert, no system
alert, no matched notification prompt and no bell. [Run 36678849730](https://github.com/NickGuAI/HappyHerd/actions/runs/36678849730)
did not detect the narrowly matched notification prompt; the app-alert cause
remains unknown. No native Inbox checkpoint passed.

A read-only Mach-O inspection confirmed the selected executable already has a
linker-generated ad-hoc signature, with no embedded entitlement slots. That
fact alone does not prove a SecureStore failure. The next diagnostic retains
only static error-category counts from this owned app's bounded simulator log
and existing private XCTest log. Queried unified-log messages stay in memory
and are discarded; the existing private XCTest log remains excluded from
uploaded proof. No credentials enter the diagnostic receipt. It does not change signing, authentication, read
state, acceptance assertions or timeouts. Zero matching log records remain
inconclusive.

The fourth hosted journey at `39f46cbf` reached real QR approval and then failed
before Inbox. Its bounded owned-app log query completed successfully without
truncation: one account-backup-state write failure and three static missing-
entitlement messages were observed; no numeric OSStatus was emitted.
[Run 36681073979](https://github.com/NickGuAI/HappyHerd/actions/runs/36681073979)
retains that first failure. The original Release executable has a linker ad-hoc
signature without application entitlements. The next isolated setup creates a
separate ad-hoc signed simulator variant with only its own application identifier,
preserving and re-verifying the original archive and extracted app. All non-
signature files, executable code/data sections and UUID must remain unchanged.
The derivative executable hash is recorded and checked after installation. This
is an explicit signing variant, not a byte-identical original executable or a
product authentication change; actual normal login and every Inbox assertion
remain required. No shared runtime or keychain is modified.

At `f3cc900a`, signature creation and all preservation checks passed: 729 original
files retained, only the executable signature changed and outer CodeResources
was added, and all 59 sections, UUID and non-signature executable payload
matched. The [first execution](https://github.com/NickGuAI/HappyHerd/actions/runs/36683230745/attempts/1)
then stopped before installation because a bounded resource probe timed out
during simulator boot; cleanup commands also timed out. No resource-floor
crossing was recorded. Independent review supported one unchanged-head retry.
That [retry](https://github.com/NickGuAI/HappyHerd/actions/runs/36683230745/attempts/2)
installed and verified the derivative, then failed its actual XCTest before
any server-settings capture or authentication diagnostics. Cleanup succeeded;
the exact startup failure remains unknown. The next harness waits for the normal
login screen before opening server settings and records only static phase
names and typed state flags. Existing server-field/authentication bounds, Inbox
assertions and evidence requirements remain unchanged. Signing's effect on
normal account persistence is still unproved.

The seventh journey at `4f0be596` reached only `setup` and `activate`:
XCTest failed at `app.activate()`, with app state `not-running` and no UI query.
The startup wait, server settings, QR/authentication and Inbox assertions never
ran. Signing and installed hashes passed, disk remained above the resource
floor, and simulator cleanup succeeded. [Run 36687095663](https://github.com/NickGuAI/HappyHerd/actions/runs/36687095663)
and [sanitized artifact 11085075383](https://github.com/NickGuAI/HappyHerd/actions/runs/36687095663/artifacts/11085075383)
retain that failure. The public receipt cannot yet distinguish launch rejection
from an immediate crash.

The next diagnostic classifies private XCTest failures and a bounded unified-log
query on only the newly owned simulator. The query selects the HappyHerd process
or launcher/crash processes mentioning the exact isolated bundle identifier.
Only fixed launch/crash categories, allowlisted Apple error domains, bounded
numeric codes and fixed signal/exception enums enter public proof. Raw error
messages, URLs and UI hierarchy remain private. An unmatched or unavailable log
is inconclusive. Activation, signing, auth, all eight screenshots, assertions
and timeouts are unchanged. This run diagnoses launch; even a six-checkpoint
native pass still needs native account-scope, arrival-during-Done and durable
server-restart proof beyond the existing Web coverage.

The eighth journey at `8b9638b0` again failed only at activation. Both private
XCTest sources classify it as `launch-rejected` / `launch-denied`; neither
exposed an allowlisted error domain/code or a crash signal. The owned-simulator
log query exceeded its unchanged 256 KiB bound and is inconclusive. The auth
query completed with zero matching failures, and cleanup succeeded. All 13
Web stages passed again. [Run 36727434094](https://github.com/NickGuAI/HappyHerd/actions/runs/36727434094)
and [artifact 11102654323](https://github.com/NickGuAI/HappyHerd/actions/runs/36727434094/artifacts/11102654323)
retain that attempt. The [durable failure summaries](failed-attempts.json)
preserve all eight hosted failures and original receipt hashes.

The follow-up query retains the same app/device scope, 20-second deadline and
256 KiB ceiling, selecting only error/fault records or fixed launch-failure
terms and omitting debug-level records. Fixed service-reason enums and expanded
Apple error-code syntax distinguish a security, busy or missing-app rejection
without publishing its description. This is a diagnostic correction; activation
and simulator signing remain unchanged and no launch repair is claimed.

## Full native acceptance continuation

The original six native checkpoints and eight captures remain required. Ten
additional checkpoints require native A→B→A account isolation using ordinary
Logout and visible QR linking; arrival while native Done is pending; durable
isolated-server restart; native socket reconnect; and a final authenticated
relaunch. Account seeds, tokens and QR payloads remain only in memory.

The acceptance-only loopback relay forwards real HTTP and Socket.IO traffic to
the unchanged production server on a second owned port. It can delay exactly one
real native read request: native must visibly observe Done disabled and both old
and newly arrived unread dots before releasing the original request unchanged.
No synthetic response, authentication or read state is injected. Native then
must show the newer update unread while the acknowledged snapshot clears.

Before the second server restart, both remaining browser contexts go offline.
The relay must observe exactly one live socket (native), its closure and a new
native connection while browsers remain offline. The running native app must
receive a newly published real update before browser transport is restored.
The server retains its disk database and parent-held secret across the restart;
account snapshots, existing read timestamps and subsequent native relaunch are
verified. The final controller requires all 16 checkpoints and 18 captures.
