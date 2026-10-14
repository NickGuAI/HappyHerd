# Issue 411: browser setup investigation

PR 415 remains a diagnostic draft. No owning cause or corrective mechanism has
been established. This test-only change needs no runtime activation or product
changelog. It is not issue acceptance.

## Retained failures and historical evidence

- Main `3a3773303a5539f6c9deddbd04197b92cbab9a76`, Contracts
  `37787422020`: both owned 30-second setup hooks failed; 210 journeys skipped.
- Instrumented `4a1126dc96969d7b76de92f9e0498ad6fbc2cc9e`, Quality
  `37830689266`: builds/listen completed, browser launch exceeded the hook
  budget. Side-chat setup continued after timeout. Contracts `37830689164`
  also failed; desktop launch completed before a journey timeout, while the
  side-chat warmup failed after the hook deadline. These boundaries are
  separate; elapsed time alone does not establish resource contention.
- Local full app on that instrumented head failed seven other teardown hooks;
  the 210 owned journeys passed. This was not a full-suite pass.
- `be138fb181165395ab92b380f10248e2dbd505e6`, Quality `37833088499` and
  Contracts `37833088502` passed with process-only launch traces. This is
  historical passing evidence, not reproduction or proof of repair.

## Bounded initialization metadata diagnostic

The two owned fixtures each create one trace immediately before their sole
`chromium.launch` call. Launch options, assertions, 30-second hook budgets,
warmup, and worker configuration are unchanged. No shared configuration,
workflow, or Reanimated stub changes are included.

The adapter intercepts the package-exported **internal** debug singleton of the
owning app's installed Playwright **1.62.1**. Root package 1.61.1 is not this
consumer. This diagnostic depends on internal namespace and message formatting;
it is not a supported stable public launch API and must be re-audited if the
installed Playwright implementation changes. The fixture's existing top-level
Playwright import initializes the core logger before interception.

Output contains only fixed fixture/event labels, timestamps, elapsed time,
numeric process/command IDs and two allowed root methods: `Browser.getVersion`
and `Target.setAutoAttach`. Responses are paired by ID. Raw protocol values
exist transiently during parsing but are not retained or forwarded by this
sink. Arguments, URLs, profiles, stderr, bodies, unknown methods and malformed
messages are discarded. Existing fixture error reporting is unchanged; this
privacy claim covers the new metadata sink only.

Each trace emits at most 14 ordinary records, one saturation marker, and one
reserved terminal receipt. Launch settlement stops the trace in `finally` and
restores prior diagnostics. Hook teardown stops it before asynchronous browser
cleanup. A hook that expires while launch is pending retains a dropping sink
for the remaining isolated worker lifetime, so late launch/warmup cannot revive
raw logging. That intentional diagnostic limitation is worker-scoped. No
additional deadline, retry, guard framework or error replacement is introduced.

## Lightweight checks, 2026-10-09

- Focused `browserStartupTrace.test.ts`: 5 tests passed using pinned Node
  20.20.2, pnpm 10.11.0 and the existing app Vitest configuration, one worker.
  Covers root-command pairing, ANSI formatting, metadata-only output,
  rejection identity, late completion after hook teardown, saturated terminal
  output, and throwing diagnostic emission/restoration.
- Standalone synthetic proof against the actual repository helper and installed
  Playwright 1.62.1 passed. It initializes the actual `DEBUG_FILE` stream before
  interception, awaits its open/flush lifecycle, and verifies zero trace bytes
  reach that raw sink. No browser is launched.
- Earlier harness attempts are retained separately: the first lacked ESM
  package context; revision 2 failed `ENOENT` because it read the debug file
  before the asynchronous stream opened. Revision 3 uses a deterministic stream
  lifecycle barrier. The integrated proof changes only the helper import path
  from that passing revision. These failures are not browser failures or passes.
- Initial patch application failed because its unprefixed paths required
  `git apply -p0`; that path-strip correction applied the exact reviewed diff.
- Owning app `tsc --noEmit` passed.
- `git diff --check` and `node scripts/lint-source.mjs` passed.

First diagnostic CI on the forthcoming head must be retained without rerun.
A passing trace does not establish a cause. A failing startup method boundary is
still required before selecting the smallest causal repair and its regression.

## First initialization sample on 7df8344f

All first push-generated workflows finished without reruns:

- Quality `37939233229` passed all jobs, including all 210 owned journeys;
  app total 380 files / 4440 tests passed, ten existing skips.
- Contracts `37939233209` failed the side-chat 30-second setup hook. Desktop
  passed all 48 journeys; side-chat skipped 162. App total 379 files passed,
  one failed, 4278 tests passed and 172 skipped.
- Server image `37939233237` passed.
- Native installer `37939233239` separately failed macOS x64's installer-rerun
  child with exit 1 at 14:16:36.594Z, after initial pairing and registered-machine
  RPC passed. Other applicable jobs passed. No installer edits or reruns belong
  to this investigation.

The complete first logs remain retained separately. The failing Contracts
trace contains eight startup records per fixture (2445 bytes of normalized
metadata total). Use the internal `at` timestamps, not buffered GitHub output
timestamps. Desktop/side-chat process spawning took 35/11 ms. Their
`Browser.getVersion` send-to-receive intervals were 25717/25617 ms; both
responses were observed at 13:51:19.749Z. `Target.setAutoAttach` then took
101/99 ms. Launch finished at total setup 29698/29647 ms. Side-chat warmup
crossed the deadline and failed after browser closure at 32940 ms. Warmup is
therefore a consequence of the depleted setup budget, not the initiating delay.

Installed app Playwright 1.62.1 logs SEND before transport writes. Its pipe
transport assembles NUL-framed data and dispatches through `setImmediate` on
Node 20 before CRConnection logs RECV. The interval includes browser readiness,
transport and worker scheduling; synchronized receipt timestamps prove none of
those owners. The owning app runner is Vitest 3.2.4. Root Playwright 1.61.1 and
root runner 4.1.5 are not the consumers of these fixtures.

## Approved responsiveness discrimination

The diagnostic adds one unref'd native 250 ms heartbeat only while the first
root `Browser.getVersion` exchange is pending. It retains aggregate tick count,
elapsed time, maximum gap and its elapsed bounds, last tick, and CPU deltas.
There is no per-tick output or protocol payload. The final gap is included on
response or terminal teardown, and the interval is cleared before final counter
reads. Existing trace record caps, error identity, fixture options, journey
assertions and hook budgets are unchanged.

Continuing heartbeats falsify a continuous worker pause over the sampled
interval. A gap proves loss of callback responsiveness only, not its cause.
`process.cpuUsage()` measures whole Node-process CPU activity across its
threads, not specifically synchronous JavaScript, Chromium CPU, or host CPU.
Low CPU does not prove a scheduling cause. This is a causally justified
observation, not a repair or a synthetic reproduction of the actual failure.

The deterministic no-browser observer proof covers a 250 ms unref'd interval,
final-gap and elapsed-bound arithmetic, CPU deltas, starting only at getVersion
SEND, response/teardown cleanup, late response suppression, and original error
identity when final counter collection throws. Its simulated 25-second gap is
an observer-integrity input only. The existing metadata allowlist regression
explicitly accepts only the eight new numeric fields and checks their values.

Pre-publication checks for the responsiveness diagnostic: all five focused
helper tests passed, the integrated deterministic observer proof passed, app
TypeScript (`tsc --noEmit`) passed, and source lint / whitespace checks passed.
No local browser, full-app suite or build was run. Exact-head review and the
first push-generated CI results remain distinct from these lightweight checks.

## Owned pipe observation, October 12

Continued from the current PR revision
`e239d35dd7554d1a1592212e69167b51158f9c64`, retaining the original failing
25.6-second exchange. No cause or repair has been established. The new observer
separates the selected root getVersion send's write-call start, delimiter
write-call return, and complete matching frame at the existing transport
callback from the existing protocol RECV. Write return is not OS completion;
frame observation is not kernel arrival. Heartbeat interpretation remains as
above. Passing samples cannot explain the historical failing sample.

This diagnostic depends on app-resolved Playwright 1.62.1 internals. The local
client connection resolves its own server Chromium instance. Its one
`_launchProcess` invocation returns the original Promise unchanged; an observer
registered before the caller's continuation taps the returned transport before
first send. Only that transport's send/dispatch and write-stream instance are
wrapped. No global spawn hook, prototype patch, extra data listener, stream read,
package modification, launch option or fixture scheduling change is introduced.
Unsupported shape/version disables observation, never launch. Transient frame
inspection is limited to 8 KiB and 16 complete frames per callback; only allowed
numeric IDs and categorical events are retained through the existing 16-record
cap. Unavailability is terminal and restores installed taps. Receive, settlement
and hook teardown restore observation; late fulfillment cannot install taps.

Twenty no-browser tests passed on their first run (14 pipe tests, six integrated
startup-trace tests). They cover Promise/argument/receiver/error identity,
installation order, return values, callbacks, split multibyte and coalesced
framing, privacy, bounds, teardown and restoration. Negative cases prove that
unrelated sends and delimiters cannot be labeled with the selected root ID,
and that partial bind failure or frame-bound unavailability restores taps and
silences later observation. These are observer-integrity tests, not a historical
stall reproduction. All existing fixture journey assertions remain unchanged.

The first frozen dependency install passed with Node 20.20.2, pnpm 10.11.0 and a
task-owned store. App resolution confirmed Playwright 1.62.1 and Vitest 3.2.4.
The lock SHA-256 remained
`e9f838a9aa9f3f35a6d33c56435401ed34a67e93e67ec368af95ac260aba2c75`.
The first app typecheck failed because the install omitted lifecycle scripts and
wire declarations were absent. That setup failure is retained separately.
The subsequently authorized maintained server postinstall passed once, including
wire declarations; the app's declared typecheck then passed once. No source
change was needed to clear the derivative errors. Original source hashes and
lock remained unchanged across prerequisite execution. First install, unit,
typecheck failure, prerequisite and final typecheck receipts remain retained
privately. No browser or full-suite run was performed in this phase. Publication,
exact-head review and default-path CI evidence remain separate gates.

## Independent setup scheduling, October 13

The fixtures previously awaited preparation and HTTP listen before starting
Chromium, although initialization and side-chat's blank-page warmup do not use
the fixture origin or generated assets. The historical 3,871 ms preparation
plus 25,776 ms launch left 353 ms in the unchanged 30-second setup hook. This
establishes an avoidable serial budget contribution, not the cause of Chromium's
latency. The failed 3,293 ms warmup includes closure and is not a measurement of
successful warmup time.

A private helper, consumed only by these two fixtures, starts initialization
immediately before preparation and joins both branches before readiness. It
adopts the browser before warmup and the server on successful listen. Stop marks
setup expired and stops tracing before awaits, blocks later warmup/listen/ready,
and closes late acquisitions. Disposal identity and branch completion slots are
reserved before callbacks, including reentrant stop and synchronous launch-stop.
Browser/server close promises are cached. Side-chat reports the first build
rejection immediately but joins both compilers to settlement during disposal.
Secondary cleanup failures retain their actual error internally and emit at
most three fixed categories (browser/server/trace); the reporter cannot replace
an initiating failure or successful teardown's original cleanup error. Raw
cleanup errors are not passed to the reporter.

The two generic Chrome discovery Error wrappers are removed to preserve original
rejection identity. Existing stage failure receipts remain. HTTP listen now
rejects through an instance error listener, removed on success. Warmup reports
its initiating error before page-close cleanup. No cancellation or extra timer
is invented: a permanently unresolved operation can still outlive the runner's
existing hook budgets, while retained handlers close any late acquisition.

The first lifecycle suite passed 19 tests. The exact serial mutant of the actual
helper failed the earliest launch-called assertion (zero calls while preparation
was unresolved), without a timeout. Restoring the approved helper bytes returned
19 passing tests. The virtual model uses historical preparation/launch numbers
and an explicitly artificial 400 ms successful warmup: serial 30,047 ms versus
26,176 ms overlapped. This proves scheduling only, not historical reproduction
or real contention/warmup performance.

After categorical cleanup reporting, the first 22-test helper run passed. The
first app typecheck failed TS2322 because the test closeBrowser mock inferred
Promise<undefined> while its deferred cleanup returned Promise<void>. That first
failure is retained. The only correction explicitly annotated the mock's
Promise<void> return; the next 22-test run and declared app typecheck both passed.
No production behavior or assertions changed for that correction. First logs,
source hashes, mutant/restoration and process-group exit receipts are retained
privately. Tests cover first-error identity including undefined/null, sibling
rejection consumption, both compiler settlements, late acquisition, reentrant
teardown, exactly-once cleanup, fixed categorical reporting and throwing reporters.

Source comparisons confirm both journey bodies, launch options, build arguments,
30-second hooks, existing tracing helpers and lock are unchanged. No default
worker/configuration changes, local browser run, full-suite execution, new CI or
publication was performed for this phase. This is a scheduling-contract repair;
actual browser acceptance and historical Chromium-delay ownership remain unproved.
