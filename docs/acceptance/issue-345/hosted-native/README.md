# Isolated hosted Inbox acceptance

This temporary acceptance tooling runs the unchanged production app and actual
standalone server. It does not run fixtures or inject authenticated/read state.
The native app is selected from the normal Xcode simulator-signing build
`4933c0c727b08f2dbe7f90ae5e261d89a917e0de`
([run 36733047107](https://github.com/NickGuAI/HappyHerd/actions/runs/36733047107)).
The workflow requires its checkout's complete `server/` tree to match that build.

The workflow installs the pinned package toolchain, verifies all native app
files, exports production Web, and copies the four JavaScript helpers plus the
retained Web runner into the task's ignored artifact directory. `controller.mjs`
starts a new disk-backed PGlite database, applies all 41 production migrations,
and runs the 13 real Web stages using normal account-restore UI. It then leaves
two real unread updates for the installed iOS app and approves only that app's
visible public QR through the ordinary authenticated companion API.

`native-driver.py` builds the small XCTest target, creates one new private iOS
26.2 simulator matching the selected Xcode SDK, verifies its exact destination before boot, installs and verifies the selected app, and performs the actual
Inbox journey. Five static markers coordinate real arrivals, Desktop Done, normal
account switching, a pending native Done race and isolated-server restart.
Success requires one passing, non-skipped XCTest, all 16 ordered persisted
checkpoints, native/desktop state agreement and all 18 deliberate captures. The driver cleans up only its newly
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
preserve all nineteen hosted failures and original receipt hashes.

The follow-up query retains the same app/device scope, 20-second deadline and
256 KiB ceiling, selecting only error/fault records or fixed launch-failure
terms and omitting debug-level records. Fixed service-reason enums and expanded
Apple error-code syntax distinguish a security, busy or missing-app rejection
without publishing its description. This is a diagnostic correction; activation
and simulator signing remain unchanged and no launch repair is claimed.

The ninth journey at `7bb61275` completed that narrowed query without timeout or
truncation, then retained safe domain/code pairs including `NSPOSIXErrorDomain/162`.
It again failed at activation before any startup/authentication/Inbox phase.
[Run 36729388901](https://github.com/NickGuAI/HappyHerd/actions/runs/36729388901)
and [artifact 11104637921](https://github.com/NickGuAI/HappyHerd/actions/runs/36729388901/artifacts/11104637921)
remain failures. Apple's local domain-aware launchctl decoder maps 162 to a
codesigning issue; this does not identify a particular entitlement defect. The
next build uses normal Xcode simulator signing with only the prior explicit
signing-disable override removed. Its own source, archive, signing receipt and
all-file manifest must verify before the original app is installed directly.
No post-build re-signing or claim of identical rebuilt executable bytes remains
in the selected path. The prior custom derivative and its recipe stay preserved
at [revision 7bb61275](https://github.com/NickGuAI/HappyHerd/tree/7bb61275bd10f00543be6eaf424b2401398a9b80/docs/acceptance/issue-345/hosted-native);
reproducing that historical variant requires its matching verifier revision.

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


The tenth attempt at `5d6d468a` verified the selected normal archive and extracted
app, but [run 36741430930](https://github.com/NickGuAI/HappyHerd/actions/runs/36741430930)
failed immediately in controller preflight. One controller assertion still
pinned native source `67a22ead` while the selected artifact and other consumers
correctly pinned `4933c0c7`. The controller completed no stage and started no
server, Web journey or native driver. [Artifact 11111035654](https://github.com/NickGuAI/HappyHerd/actions/runs/36741430930/artifacts/11111035654)
and its controller receipt hash remain preserved in the failure ledger. The
correction updates that single selected-source assertion and adds a cross-file
provenance regression check. It changes no artifact, authentication path,
acceptance assertion, timeout, capture requirement or skip.

The eleventh attempt at `c2dbdf04` passed all 13 Web stages, verified the selected
archive and extracted app, and installed both app and test runner on the exact
private simulator. [Run 36742616651](https://github.com/NickGuAI/HappyHerd/actions/runs/36742616651)
then failed with an unclassified `ValueError` after container discovery, before
installed-app verification completed or XCTest started. No native UI phase,
authentication or Inbox checkpoint ran; simulator cleanup succeeded and resource
floors were not crossed. [Artifact 11111677207](https://github.com/NickGuAI/HappyHerd/actions/runs/36742616651/artifacts/11111677207)
and both original receipt hashes remain in the failure ledger. The selected app's
launch behavior is still unproved. The next diagnostic records only fixed
verification categories and bounded counts/modes to identify this failure;
all artifact hash, file-set, type, symlink, mode and signature checks remain.

The twelfth attempt at `bba99d30` reproduced the installed-verification failure
with a precise sanitized classification. [Run 36745820581](https://github.com/NickGuAI/HappyHerd/actions/runs/36745820581)
found all 736 installed file hashes identical, with no missing/extra files,
member-type changes or link-target changes. Six POSIX modes differed; the first
was archive `0755` versus installed `0644`. No XCTest or native UI phase started.
All 13 Web stages passed; resources remained above the existing floors and the
owned simulator was cleaned up. [Artifact 11113575520](https://github.com/NickGuAI/HappyHerd/actions/runs/36745820581/artifacts/11113575520)
and original receipt hashes remain preserved. Archive inspection finds exactly
seven executable files: the main app and six embedded framework Mach-O binaries.
The diagnostic count alone does not prove which six installed paths changed.

The following preparation may restore only those six installed framework
executables to their selected archive permissions. Before any permission write,
it must prove every file hash, member type and link target, then identify the
complete mode-delta set as exactly those six declared framework executables,
each archive `0755` and installed `0644`. Framework Info.plist bindings and
Mach-O identities must match; every other mode, including the main executable,
must already match. No subset, extra delta or different mode is accepted.

Only the owned installed files receive individual permission changes. The
archive, extracted build, all app bytes and signatures are untouched; there is
no re-signing. The complete original verifier, strict codesign and critical
installed hashes run again afterward. The receipt records fixed counts/modes,
whether restoration was applied and the post-restoration verification result.
This is installed-permission restoration, not an untouched default installation
or a product fix. Unknown differences still fail, and normal authentication and
every native criterion remain required. No native launch or acceptance pass is
claimed from either preceding mode-verification failure.

The thirteenth attempt at `a6f1b8b3` verified the exact six installed framework
mode differences, restored their original permissions and passed all 736 file
hashes and strict signature checks. [Run 36748692792](https://github.com/NickGuAI/HappyHerd/actions/runs/36748692792)
then launched the app, completed normal QR linking and passed native checkpoints
01–08: initial unread dots/bell, per-item read with navigation, Done, persisted
relaunch, real arrival, remote Done, and account A's own unread/Done state.
Ten intended captures match their receipt hashes and were visually reviewed.
It subsequently failed in the coarse `account-logout` phase before linking B;
XCTest remains one failure, zero passes and zero skips. Account B/A restoration,
the native Done race and native durable restart/reconnect remain unproved.
All 13 Web stages passed, resource floors held, and simulator cleanup succeeded.
[Artifact 11113829464](https://github.com/NickGuAI/HappyHerd/actions/runs/36748692792/artifacts/11113829464)
and the native/controller/transport receipt hashes preserve this failed attempt.

The last Inbox screenshot has its navigation drawer closed. Source review
confirms Settings is in that drawer, while the old helper unnecessarily opened
the root route before searching for Settings. The correction stays on the
already asserted Inbox page, opens its existing navigation-sidebar toggle and
uses the existing drawer Settings button, then normal Account/Logout/confirmation
and QR authentication. On the root page that toggle instead folds the home
panel, so it must not be blindly added after the old deep link. Fixed logout
subphases distinguish subsequent failures without capturing settings or account
content. Existing assertions, 20/10/60-second bounds, twelve-scroll limit and
all 18 required captures remain. The original receipt cannot establish which
old logout assertion failed, so the correction is supported by the live layout
and source contract, not a recovered private XCTest message.


The fourteenth attempt at `7487650d` passed all 13 Web stages and built the
XCTest runner, then [run 36752956252](https://github.com/NickGuAI/HappyHerd/actions/runs/36752956252)
stopped before app installation or any native UI. Its receipt reports
`TimeoutExpired` during `wait-for-boot`, after only 82.713 seconds of the unchanged
600-second boot budget; the monitored command was terminated with exit -15.
The boot deadline itself raises a different, fixed requirement error. Source
review identifies the uncaught ten-second `memory_pressure` or `sysctl` resource
probe as the timeout boundary; the old receipt cannot distinguish those probes.
This is not evidence that simulator boot exceeded its bound or that the drawer
correction ran. The last completed samples had at least 46% available memory,
about 88 GiB free disk and no swap use; no observed floor was crossed, but the
failed probe supplied no fresh sample. Owned simulator cleanup succeeded.
[Artifact 11115467604](https://github.com/NickGuAI/HappyHerd/actions/runs/36752956252/artifacts/11115467604)
and all three original receipt hashes remain preserved.

The next diagnostic attributes a resource-probe failure using only a fixed probe
name, fixed category and numeric timeout/exit code. It retains both original
commands, ten-second probe bounds, sampling, resource floors, 600-second boot
bound, failure propagation and cleanup. It exposes no exception text, command
output, path or account material. The same simulator/runtime and monitor had
completed boot and native checkpoints 01–08 in attempt 13. This supports one
independently reviewed diagnostic journey; it does not establish a root cause
for the delayed host probe or justify a timeout increase, skipped sample or
boot workaround.


The fifteenth attempt at `7d570f36` passed simulator boot and resource monitoring,
all installed integrity checks, normal QR authentication and native checkpoints
01–08. [Run 36755579409](https://github.com/NickGuAI/HappyHerd/actions/runs/36755579409)
then passed the new drawer, Settings and Account phases but failed in
`account-logout-scroll`: the Logout row was not found and hittable after the
existing twelve-swipe bound. It did not tap Logout or link account B. XCTest
records one failure, zero passes and zero skips. All 13 Web stages passed;
resource floors held, no resource-probe failure was recorded, and simulator
cleanup succeeded. [Artifact 11117642217](https://github.com/NickGuAI/HappyHerd/actions/runs/36755579409/artifacts/11117642217)
and all original hashes remain preserved. All ten intended screenshots passed
independent hash and visual/privacy review. The full native criteria remain
unproved beyond checkpoint 08; the Account action tap does not separately prove
that page's readiness.

Source review finds the test's `label BEGINSWITH Logout` assumption does not
match the existing native row composition. The Logout Item has an icon before
its title and subtitle, no explicit accessibility label, and an accessible
Pressable wrapper. Locked React Native 0.83.1 recursively combines child labels
in order; the icon renders as Text. The correction identifies the ordinary
row by its catalog title and subtitle instead of assuming the title starts its
combined label. It keeps normal gestures, the twelve-swipe bound, hittability,
confirmation and login assertions, and all timeouts and captures. Fixed
counts/booleans attribute the row query without publishing labels, account
content, hierarchy or additional screenshots. The prior receipt establishes the
failed assertion boundary; it does not preserve the actual runtime label.


The sixteenth attempt at `ec7567a7` confirmed the Logout selector correction.
[Run 36759522116](https://github.com/NickGuAI/HappyHerd/actions/runs/36759522116)
recorded zero matches for the old prefix, exactly one compound row match and
hittability after two swipes. The ordinary Logout tap, native confirmation
assertion and confirmation tap completed. It then failed at `account-logout-login`:
the app was `not-running`, and no UI query ran for the failure-state diagnostic.
No B authentication occurred. The preceding native checkpoints 01–08 and all 13
Web stages passed; XCTest still records one failure, zero passes and zero skips.
Resources remained above their floors, no resource probe failed, and simulator
cleanup succeeded. [Artifact 11118948370](https://github.com/NickGuAI/HappyHerd/actions/runs/36759522116/artifacts/11118948370)
and the original native/controller/transport hashes preserve this failed run.
All ten intended screenshots passed independent hash and visual/privacy review.
The failure-state capture precedes the harness's protective app termination, so
that termination does not explain the recorded not-running state.

Normal logout clears stored credentials/auth state and calls
`Updates.reloadAsync()`. With this app's disabled OTA configuration, the locked
Expo implementation triggers a React-context reload; the inspected path does
not intentionally exit the app process. Existing scoped XCTest/unified-log
classifications are available and untruncated but report only `unknown`, which
cannot distinguish a crash from another process/lifecycle failure. The next
bounded diagnostic inspects only reports matched to this app and private
simulator, publishing fixed classifications and safe metadata. It does not
reopen the app to hide the failure or change logout, authentication, assertions,
timeouts, screenshots or other acceptance criteria. The exact cause remains
unproved until the new evidence is available.

The seventeenth attempt at `48252d2b` reproduced that post-Logout failure.
[Run 36764889053](https://github.com/NickGuAI/HappyHerd/actions/runs/36764889053)
again completed the ordinary Logout and confirmation taps, then recorded
`account-logout-login` with the app not-running before protective termination.
Native checkpoints 01–08 and all 13 Web stages passed; no B authentication
occurred. All ten captures passed independent hash and visual/privacy review.
XCTest recorded one failure, zero passes and zero skips; resources remained
above their floors and simulator cleanup succeeded.
[Artifact 11122715455](https://github.com/NickGuAI/HappyHerd/actions/runs/36764889053/artifacts/11122715455)
and the durable failure entry retain the original receipt hashes.

The bounded collector found one recent app-named host report, read 46,775 bytes,
and rejected it for an identity mismatch. Both source directories were available,
with no listing, candidate or byte limit reached. The report parsed as a supported
format, but the receipt cannot distinguish a bundle/process mismatch from an
installed-path or simulator-coalition mismatch; its capture-time check did not
run. No report was classified. This does not establish that the candidate belongs
to the owned app or that a crash caused the observed Logout failure.

The next diagnostic reports only fixed rejection gates and structural/exact-match
flags for those same ownership predicates. It preserves their acceptance policy,
the original collection bounds and the full journey. Rejected report contents
remain unclassified and private. The cause remains unknown until evidence
establishes ownership and the failure mechanism.

The eighteenth attempt at `0534e716` again failed after normal Logout confirmation,
before the login screen returned. [Run 36768957795](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957795)
passed native checkpoints 01–08 and all 13 Web stages, with no B authentication.
The app was already not-running before protective harness termination; XCTest
recorded one failure, zero passes and zero skips. Resources held and cleanup
succeeded. All ten intended captures passed independent hash and visual/privacy
review. [Artifact 11123562255](https://github.com/NickGuAI/HappyHerd/actions/runs/36768957795/artifacts/11123562255)
and the durable failure entry preserve the original receipts.

The new diagnostics identify the rejected candidate's `installed-path-scope`
boundary. Both bundle identifiers, process name, app/executable leaves and exact
owned-simulator coalition matched. The path had a wildcard component, no parent
traversal and no visible owned simulator UUID; neither exact nor case-insensitive
installed suffix comparison matched. The single recent 46,542-byte report was
not classified, and no collection bound was reached. These flags establish the
redacted-path diagnostic gap, not the application's failure mechanism.

The correction for this observed case keeps exact simulator-coalition and app
identity matching, rejects visible path conflicts, and adds corroboration from
the verified installed executable's build UUID and a unique matching main-image
entry. UUID values and raw image/path/report content remain private. A build UUID
alone proves neither simulator ownership nor exact file bytes; the existing
archive hashes, complete installed-file verification and signature checks remain
the exact-artifact evidence. The full native journey and its assertions remain
unchanged. A matched report carries only a bounded integer capture offset from
journey start, allowing correlation with the existing checkpoint timings without
publishing a raw report timestamp. The Logout cause remains unproved pending the
resulting evidence.

The nineteenth attempt at `30ad7634` established an owned crash after normal
Logout. [Run 36774236151](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236151)
again passed all 13 Web stages and native checkpoints 01–08, then failed at
`account-logout-login` with the app already not-running before protective
termination. No B authentication occurred. XCTest recorded one failure, zero
passes and zero skips. All ten original captures passed independent hash and
direct visual/privacy review. Minimum available memory was 24%, minimum disk
space was 87,466,520,576 bytes, and simulator shutdown/deletion both succeeded.
[Artifact 11125849819](https://github.com/NickGuAI/HappyHerd/actions/runs/36774236151/artifacts/11125849819)
and the durable failure entry preserve all original receipt hashes.

One 48,745-byte host report matched the exact simulator coalition and compatible
redacted process path, with one matching main arm64 image/build UUID bound to the
hash-verified installed executable. No collection bound was reached. It reports
`EXC_BAD_ACCESS`, `SIGSEGV` and `SIGNAL/11`. Its bounded capture offset places it
11.406 seconds after checkpoint 08, 19.395 seconds after the earlier persistence
relaunch checkpoint and 85.806 seconds before XCTest exited. This identifies a
crash in the later Logout sequence; the earlier intentional persistence
termination and subsequent protective termination do not explain it. The
`isSimulated` metadata is absent. Sixteen inspected symbolized frames matched no
current fixed tags, so the faulty function/component and invalid-access subtype
remain unknown. Earlier rejected reports are not retroactively classified.

The next diagnostic adds bounded code attribution tied to the exact verified
app/framework binaries. Numeric image-relative code offsets can be resolved
against the retained build locally; raw symbols, absolute addresses, image paths,
UUID values, report text and account material remain private. This is diagnostic
work, not a product correction or a native acceptance pass. The original journey,
authentication, assertions, timeouts, captures and resource floors remain required.

Code attribution reads only the selected main executable and the six existing
framework executables, under a shared 512 MiB hashing budget. Each file must match
the verified manifest SHA-256 and a stable regular-file read, with one supported
arm64 Mach-O slice and build UUID. Offsets are accepted only inside validated
instruction sections of executable segments, relative to the preferred image
base. A complete bounded report image array must uniquely match the private
name/path/build identity; conflicting or ambiguous frames receive only a fixed
unattributed status. Exception and faulting-thread frame order is retained with
64-frame bounds, and conflicting faulting-thread selectors suppress attribution.
Only the fixed `KERN_INVALID_ADDRESS` or `KERN_PROTECTION_FAILURE` subtype may be
copied from an address-bearing exception subtype. The local retained archive
passed all seven image checks and main-executable offline symbol resolution;
that feasibility check is not evidence of which function crashed.

For offline resolution, first reverify the retained binary against its selected
manifest. Privately read its preferred image base from the Mach-O header-bearing
segment, add a verified receipt offset, and pass that result to
`atos -arch arm64 -o <verified-binary> <preferred-base-plus-offset>`. Keep the
resolved symbols and absolute addresses private and publish only reviewed
source-grounded classifications. A hexadecimal fallback is not symbolization:
the attempted `atos -l 0` recipe produced that fallback on the selected app and
must not be used as resolution proof. Direct preferred-address resolution was
verified independently against the retained executable.
