# Issue 365: HappyHerd native recorded context

Owner: [#365](https://github.com/NickGuAI/HappyHerd/issues/365).

This record separates source/fixture evidence from authenticated runtime acceptance.
The current user instruction requires all runtime components to be maintained
and built inside HappyHerd, with one disposable isolated account/machine/browser
for acceptance. It authorizes no merge, release, deployment, shared-service
restart or unrelated account access.

Delivery: [HappyHerd #393](https://github.com/NickGuAI/HappyHerd/pull/393).
The earlier external proposal is withdrawn and is not a dependency. Its local
investigation remains historical evidence, not the delivered runtime.

## Sources and identity

The maintained [native runtime](../../native/README.md) contains the required
native source packages and the context implementation. Its source baseline is
`b2baf1586b9b4e7ed03bad91541ccad0a969c3ef`; initial investigation used
`115be1c248985b823491f852dbde47ea7e6a76fd`. Both native producer and app consumer
are built from this repository. Existing account-owned encrypted machine RPC
remains the only transport. A CLI-daemon reader on another machine cannot
supply native Rig state.

<!-- Native database identifiers and path variable are upstream provenance. -->
<!-- rename:preserve -->
The [provider reference](../../.dev/skills/happyherd-update-provider/references/happyherd.md)
records the source owners and recording limits. Resolve the app's remote session
ID through `happy_agent_happy_sessions` to its native `session_id` and `agent_id`.
Read the configured native database at `<resolved happyHome>/agent/agent.sqlite`,
using the native context owner's ordering and replacement semantics. Keep the
original machine and native session cwd. Bridge `happyHomeDir`, model flavor,
project labels, and another CLI's home are not native database or agent identity.
A fork's inherited `compaction` record alone does not prove model compaction.
Deleted main-context history and stripped opaque replay state cannot be
reconstructed from the context records. The separate presentation archive is
not a complete current-input oracle. The existing native 700,000-byte JSON RPC
budget remains: oversized snapshots return unavailable rather than truncation.

<!-- /rename:preserve -->

## Separate proof planes

| Plane | What it can establish | What it cannot establish |
| --- | --- | --- |
| Sanitized native-format SQLite fixtures and encrypted native handler tests | Remote-session/native-agent resolution, native order, retained replacement boundaries, hidden/injected full payloads, fork behavior and unavailable results over the existing handler | Installed runtime compatibility, real model compaction, browser authentication or live account ownership |
| Production-component rendered fixtures | Actual Settings switch → session entry → Context window gestures, full-content rendering and Retry at 1440×900 and 390×844; off-by-default and localized notices | Real authenticated machine RPC, provider state, deployment or physical mobile-device behavior |
| Real authenticated isolated journey | Exact account, machine, remote/native session mapping and configured state home; Web Desktop and Web Mobile read the actual native recorded context through encrypted RPC | A complete model request where the native runtime never recorded one |

Local test command results and independent review receipts belong in the final
local handoff. This document does not declare either local test plane passed
without those receipts. **Authenticated reads now have separate live receipts below; successful live
compaction remains unproved.**
Earlier #354 Codex native-oracle results and its authenticated default-off
Settings captures are historical evidence for another provider/revision, not
HappyHerd #365 acceptance. See [the retained #354 record](issue-354.md).

## Historical first failures

The initial #365 investigation could not start focused tests because Vitest was
absent. This is a dependency/tooling failure, not a passing test or an assertion
waiver. Later successful installation and tests, if any, must retain that first
failure and state the actual remedy. Do not weaken assertions, timeouts, masks
or skips to erase it.

Earlier automated approval review rejected inspection of a running Chrome
instance because unrelated private tab/account state could be exposed. No such
inspection is required here. Separately, #354's isolated terminal pairing was
blocked because opening its link could grant machine access. That earlier
terminal-account grant is neither completed nor authorization to pair #365.

## Disposable authenticated runtime

A new task-owned loopback relay and production app at `127.0.0.1:4365`
use a fresh database. A fresh browser context created one disposable account
through Create account and accepted the isolated native terminal connection
through the normal Connect terminal screen. The app confirmed success and the
native integration reports configured. No existing account or credential was
imported. The authenticated Context read now matches the native database at both viewports.
Successful compaction remains unproved. The authorized installed Codex login
cannot be used under a no-refresh/no-modification constraint by the unchanged
native resolver, which automatically refreshes and rewrites its selected login. The old #354
endpoint and account state were not reused.

The user now authorizes a disposable task-owned runtime built from the maintained
HappyHerd source and the normal supported pairing flow for its one isolated account and
native machine. Activation of shared resources remains forbidden. The receipt
below will record only verified task-owned identities; account keys remain
private to the isolated runtime. This authority supersedes the earlier local-only
prerequisite, without converting fixtures into authenticated proof.

Prepare the following receipt from operator-provided or already authorized
isolated surface metadata before requesting any grant. Unknown values remain
`unverified`; never invent them. Keep secrets and private transcripts out of the
receipt and repository.

<!-- Exact native machine display name is upstream runtime provenance. -->
<!-- rename:preserve -->
| Required field | Current verified value / purpose |
| --- | --- |
| HappyHerd commit and local Rig patch/base revision | Native base above; final patch identities are recorded in the local handoff |
| Task-owned runtime owner and explicit activation authority | Current user instruction; disposable runtime under `/private/tmp/issue365-live-runtime` |
| Exact app origin and browser task surface | `http://127.0.0.1:4365`; fresh Playwright browser context, no existing browser profile |
| Isolated account's nonsecret identity | `cmurhisqo0000t0csizn78aqs`; created on task relay only |
| Target machine ID and nonsecret display name | `adadf41e-d556-49be-a626-4676cfeba627`, `mini.local — Happy Agent`; task native process |
| Remote HappyHerd session ID | `cmurhp79q001dt0cs9ixau5p0` |
| Native session ID and native agent ID | `d78pc3pjyu2mzl012ephsxzy`; resolved in task native bridge mapping |
| Original native cwd and configured native state home | `/private/tmp/issue365-live-runtime/workspace`; task home `/private/tmp/issue365-live-runtime/native-home/.happy` |
| Existing machine-account authorization status | Normal disposable pairing accepted; app success and native configured state observed |
| Exact grant screen | Task-origin Connect terminal → Accept Connection; newly issued task-native QR public key, no unrelated identity |
| Native retained recording available for the read | Harmless composer-submitted text and genuine native system injection after absent-provider-auth failure; no compaction claimed |

<!-- /rename:preserve -->

## Authorized acceptance plan after the prerequisite is satisfied

The following procedure owns the live rows recorded below. Execution uses the isolated
runtime/surface authority above; no new provider turn is needed merely to read
existing retained state.

1. Record the exact HappyHerd revision and native build identity and the nonsecret identity receipt. Verify
   that the app session's machine and cwd match the native mapped session and
   configured state home. An unavailable mapping stays unavailable with Retry;
   do not substitute another session, database or machine.
2. Use the dedicated authenticated app surface at 1440×900 and 390×844. In
   Settings → Features → Experimental, prove Context window initially off and
   absent from the real session menu; switch it on through the actual control.
3. Open that same session's menu, choose Context window, and read through the
   final recorded entry. Compare native kinds, sequence, full content lengths
   and hashes against an independently derived read-only native oracle. Include
   retained compaction replacement and recorded hidden/injected items. A fixture
   boundary does not prove a real runtime compaction event.
4. Check the displayed recording limitations. Runtime-built system instructions,
   tool definitions, opaque state and any missing model-input components must be
   displayed only if actually recorded and recoverable; never substitute current
   defaults, visible chat text or fabricated content. Scroll to long-content
   markers and the last entry to prove the full payload is accessible.
5. Refresh and reopen; prove the same native identity and ordering. Compare
   relevant native records before/after to establish a read-only operation;
   account for unrelated concurrent native writes without claiming byte-for-byte
   database stability on a running runtime.
6. Exercise missing, offline, unreadable and unsupported states and actual Retry
   using only disposable, operator-approved isolated resources. Do not stop a
   shared service, corrupt native records, or modify a real session to force an
   error. Where a live failure cannot safely be induced, retain the fixture
   result and label that live row outstanding.
7. Keep viewport-specific captures sanitized. Public evidence contains counts,
   lengths, hashes, kinds and outcomes rather than credentials, raw database
   dumps or private transcript content. Label Web Mobile separately from a
   physical-device or native-app journey.

| Live acceptance row | 1440×900 | 390×844 |
| --- | --- | --- |
| Authenticated off switch and real session entry absence | Pass; initial account default off | Pass; same account switched off explicitly |
| Switch on → same session entry → open via existing encrypted RPC | Pass | Pass |
| Native-ordered full retained content, injected system record and honest limits | Pass; two native records | Pass; identical full bytes |
| Refresh preserves identity and read-only records | Pass; native record hash unchanged | Pass; native record hash unchanged |
| Unavailable and Retry | Live missing and offline pass; unreadable/unsupported fixtures only | Live missing/recovery and offline pass; unreadable/unsupported fixtures only |

Local source tests, browser fixtures, builds and independent patch review can be
completed without granting account access. They do not complete these live rows.
The earlier independent-source live receipts below are historical. Final
HappyHerd-only build, authenticated journeys and CI are recorded separately in
the final handoff; historical passes do not establish the new runtime artifact.

## Local verification receipts

The following checks were executed on the local implementation during this
continuation. Final local commit identities and review are supplied with the
patch handoff. Full retained logs live in the task-local artifacts; no private
transcript or credentials are part of these fixtures.

| Check | Result |
| --- | --- |
| Frozen dependency install, Node 20.19.0 / pnpm 10.11.0 | Pass; lockfile unchanged |
| Native Rig local patch | 32 native bridge/teams test files, 363 tests; package typecheck/build, root build/lint and changed-file format checks passed; independent exact-head review recorded in the local handoff |
| Wire package build/tests | 15 files, 84 tests passed |
| CLI Context window parser + encrypted RPC focused tests | 27 passed; includes native requests staying unsupported on a CLI owner instead of guessing another provider |
| App Context client + rendered matrix | 54 passed after correcting the fixture identity stub; final exact native response and long-content scroll subset 12 passed |
| App typecheck, i18n, UI inventory | Pass; 1,672 catalog keys, 45 routes, 338 surfaces, 84 smoke cases |
| Changelog parser | 176 entries; latest “October 2 — Native HappyHerd context window” |
| CLI typecheck/build and full unit suite | Pass after building the control-agent dependency and using canonical macOS TMPDIR; 190 files, 2,023 tests |
| Production Web export and smoke | Pass; production React mounted through the normal exported app |
| Server production build | Pass |

Additional first failures retained without assertion/time-budget changes:

- Initial package test commands launched from repository root could not resolve
  the hoisted Vitest binary. Running from the documented `server/` directory
  fixed resolution; both original logs were retained.
- An early app typecheck ran while catalog generation and browser fixture work
  were incomplete. It reported the new translation/fixture type gaps; generation
  and completed fixture implementation resolved them.
- CLI typecheck initially lacked built `happyherd-control-agent` exports. Building
  that existing dependency as prescribed by CI resolved the errors.
- First browser fixture run misclassified native `client.id = rig`: its older
  Rig stub recognized bots only. Reusing the production identity predicate for
  Context cases corrected the fixture. All original assertions stayed intact;
  the final native tests add a stronger bottom-of-long-record scroll assertion.
- First full CLI run had four Commander-context path/mock failures because
  macOS temp paths used `/var` while canonical paths used `/private/var`.
  With `TMPDIR=/private/tmp`, the unchanged focused 19 tests and full 2,023-test
  suite passed. No source assertions or filesystem-permission tests were removed.
- The first broad app suite began before the Context fixture correction and
  retained those ten failures; it also reported four unrelated browser failures
  and four browser teardown timeouts. Follow-up isolated/final results are
  recorded in the final handoff rather than erasing that run.

The native suite uses the real `AgentSystemLocal.config` within the read
transaction, actual native compaction twice with scripted inference, a separate
native child and remote binding, both existing encryption variants, and
unreadable-table recovery. A rolled-back SQL write is tested as a storage
snapshot property; it is not presented as a native conversation-rollback API.
The fixtures preserve hidden accepted system/inter-agent content, tool identity,
opaque recorded bytes and long raw content, without manufacturing a model request.

The broader app run is not green. Two untouched shell failures (animation timing
and the Linux shortcut assumption) also reproduce from an isolated checkout of
base `2ad0a066559c18de86383cbc2d70201486b1d485` using the same installed browser.
The focused workspace canvas case passes unchanged in isolation. Remaining
focus/teardown evidence and the exact-head contract result are retained in the
local handoff. These failures are not waived and no tests are weakened.

The earlier external-repository attempt is withdrawn under the current scope.
No external PR, publication or workflow approval remains a delivery prerequisite.

First hosted CI preserved two failures: stale UI inventory (regenerated from
final source) and the four changed changelog captures. Linux regeneration run
`37067735429` supplied only those four reviewed images; the remaining 24
were byte-identical and unchanged. No assertion, timeout, mask or skip changed.

Native rebased-head local checks pass: 364 tests across 32 files, module
typecheck, root build/lint and changed-file format. Independent exact-head
source review reports no actionable implementation findings.

Successful model compaction requires native model inference. The selected normal
Codex login is authorized only without refresh or modification; the current
native resolver performs those effects automatically. Preserve retained-state
read acceptance without touching that login; scripted inference remains fixture
proof only. No credential transfer or additional secret is requested.

## Historical authenticated live read receipt (before owned runtime import)

The production app originally exported at `65afe794` has identical executable
sources to the publication head `db6940af`; the latter changes documentation,
golden images and generated inventory fingerprints only. The running native
artifact was rebuilt at `37886c58`. No fixture response interception, database
seeding, credential copying or scripted inference was used in this live journey.
The browser context allowed only the task loopback origin.

At 1440×900 and 390×844, Settings → Features → Context window controls the
real session menu entry. Opening the shared view reads two native records in
order; actual wheel scrolling reaches the final long-content marker and system
record. Refresh returns identical full content:

| Native kind | UTF-8 bytes | SHA256 |
| --- | ---: | --- |
| `context.user` | 9018 | `279a9bb7d92384b9b44a7f943aacd217cfef1dd9631575fe4336d540e1f8f2c5` |
| `context.system` | 164 | `e6b8e98b36e6927aea569be55a34c28c150b5dba7582fb2868f3d6b4141aee07` |

The user record was accepted by the actual native run (pending queue zero),
then inference failed because the isolated Codex credential is absent. Native
code injected the system failure record; ordinary history represents an error,
while Context preserves the recorded system kind. Before sending, the genuinely
empty native context showed missing with working Retry on desktop. Browser
captures and read-only oracle hashes are retained in task-local artifacts.

First live harness failures are retained: the empty model catalog prevented
native registration until a supported credential-isolated provider was enabled;
one selector incorrectly counted a hidden retained Settings route as a visible
menu entry; other initial selectors hit hidden route duplicates or the composer
menu. Scope-specific visible/header selectors exercised the unchanged product.
No product assertion, timeout, mask or skip was relaxed.

The current scope supersedes the earlier coordinated-publication attempt. Only
HappyHerd PR #393 owns this delivery; no external repository action is required.

The two ordered native records were byte-identical before and after both viewport
journeys and Refresh: snapshot SHA256
`73e6a0d2be7a0ddc74bb83dd7c3766770e3b1aba9780ca85bc14029cdb213963`.
Only the disposable native foreground process was then stopped gracefully.
Both viewport Context views displayed the real offline notice and Retry retained
that honest state. Shared services were untouched. This does not claim live
unreadable/unsupported induction or successful model compaction.

A later hosted contract/lint failure identified noncanonical committer metadata
on `db6940af`; it was corrected to the repository's canonical maintainer identity.
The verifier passes unchanged after correction. Original failure logs remain
retained with the stale-inventory and changelog-baseline failures.

## HappyHerd-owned runtime continuation

The current delivery vendors the seven runtime source packages under `native/`,
with a separate frozen workspace and source-built native supervisor. Internal
runtime dependencies resolve locally. The native README and source provenance
record licenses, the imported revision, scoped example sanitization and omitted
unrelated live-provider recordings/terminal surfaces. The normal source build
fetches only declared registry/toolchain dependencies, not another repository.
The dedicated **Native runtime** Quality job runs the build, typechecks and
retained tests. The repository contract hook checks source ownership separately;
it does not claim that a source check proves execution.

The original paired disposable runtime was switched to this repository's built
native artifact. Account, machine, remote/native session, cwd and configured
state home were retained. The two original native records had the same ordered
snapshot hash before and after that switch. Both viewport switch/menu/full-read
journeys succeeded again. A new ordinary empty native session supplies real
missing-state/Retry evidence without a model call or database seeding. Final
exact-head screenshots and receipts are retained in the task handoff.

The installed Codex account was not accessed: its supported native resolver
performs an immediate background OAuth refresh, periodic refresh and possible
unauthorized-response refresh. Those actions can rewrite the selected login
and conflict with the user's explicit no-refresh/no-modification boundary.
The user-authorized no-turn retained-state alternative is used; no new credential
policy or secret transfer is introduced. Successful live model compaction is
still unproved. Real native compaction with scripted inference, inherited fork
boundaries and unreadable/unsupported source recovery remain fixture proof.

The import's first broad tests exposed macOS temporary-path aliases in five
existing cases. Re-running unchanged assertions with `TMPDIR=/private/tmp`
resolved those failures. A separate test kept an API-error constructor across
`vi.resetModules`; local workspace linking exposed the two class identities.
The test now imports that constructor after reset, preserving the same expected
404 compatibility behavior and all assertions. All first logs are retained.

Public-source scanning remains enabled. Synthetic examples were changed to
reserved example identities. Exact-byte exceptions cover only fixed native
service-home/Windows patch-context literals and protocol URLs misclassified as
personal email addresses; changed or moved copies and secret patterns remain
rejected by regression tests. No blanket public-data exception applies to the
native subtree. Compatibility names are preserved by the source rename tool,
as documented in the non-CLI naming policy.

Owned-runtime local verification completed: all seven package typechecks,
JavaScript builds, source-built Rust supervisor, frozen install and native lint
passed. The retained suite passed 4,443 tests across 481 test files; its existing
22 test skips and six skipped files were unchanged. Provider Bun checks passed.
The Context/bridge subset separately passed 364 tests. The exact-head Linux job
and independent final review own the final merge-readiness receipt.

The first Linux native CI run built and typechecked the source successfully but
failed 18 subprocess tests when Ubuntu AppArmor denied user-namespace setup.
The hosted-runner setup now installs only the just-built supervisor into a
root-owned immutable location and applies its exact-executable `userns` profile,
following the native sandbox prerequisite. Global AppArmor restrictions remain
enabled; no test, sandbox assertion or permission mode is relaxed. This setup
runs only on the disposable GitHub-hosted Linux runner, never on a customer host
or shared daemon. A later run proved the exact source-built sandbox probe succeeds,
but the protected-path checks correctly rejected the CI build-target symlink.
The local-build resolver now returns its canonical binary path, so both execution
and write protection refer to the actual executable; arbitrary protected symlink
paths remain rejected. Optional registry supervisor binaries were removed from
the owned workspace. CI asserts the resolved source-build identity and exercises
its real sandbox before the unchanged suite. The final exact-head check owns
proof of the complete remedy; earlier failures remain in the local handoff.
