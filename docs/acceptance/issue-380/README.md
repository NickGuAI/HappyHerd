# Issue #380 — First-machine Connections

[Owning issue](https://github.com/NickGuAI/HappyHerd/issues/380) ·
[PR #391](https://github.com/NickGuAI/HappyHerd/pull/391) ·
current rebase base `acd7317346e54ce2813af1db4dc24c9a1d5a118d`.

## Contract and dependency boundary

Web Desktop 1440×900 and Web Mobile 390×844: open the visible machine menu,
choose **Add a machine**, follow the shared first-run setup, authorize the
terminal on the same server/account, start its daemon, observe the actual
account machine and choose **New Chat** on it. Cancellation/reopening retains
account state; failed authorization permits a fresh URL; unreachable machines
explain daemon startup and refresh, including when their cached presence still
says active. Existing device codes retain check/identity/confirmation and
persisted selection behavior without changing account ownership.

This patch routes to `EmptyMainScreen`, the existing first-run owner. Supported
installation and first-run copy belong to #379 / PR #389, reviewed head
`51e0d3b96df758586b374605a82ebeef62338562`. Public stable installer compatibility
belongs to #371 / PR #376, reviewed head
`54c25ddd97d709948f3f3ba7d6981cc38209e9e6`. Both dependencies are now in the
rebase base. This PR retains their three-step first-run flow and stable installer
compatibility while adding its Connections entry and recovery guidance.

The original prepared integration used a disposable detached #389 worktree plus
this patch's production changes. The final rebase applies the optional
`EmptyMainScreen` footer after the now-merged three-step flow and its Get Help
action, preserving both additions. No dependency code is duplicated by this patch.

## Production and authenticated evidence

On October 2, 2026, Chromium operated the actual composed production Web export
against a fresh current-source loopback server and disposable PGlite database.
Each browser account was created through the production Create account and
backup flow. No auth adapter, injected credentials, mock API or synthetic
machine state was used. CLI homes and environments were isolated from shared
account/provider state.

| Journey | Desktop 1440×900 | Mobile 390×844 |
| --- | --- | --- |
| No machine → Add a machine → setup | Pass, fresh account | Pass, separate fresh account |
| Current-server instructions and manual terminal authorization | Pass, current built CLI in separate home | Pass, installed stable CLI |
| Normal daemon startup → actual online machine | Pass | Pass |
| New Chat → `/new`, actual machine selected | Pass | Pass; action visible without scrolling |
| Existing authenticated device code → compare identity → Connect | Pass, current CLI | Pass, fresh code from current CLI |
| Cancel/reopen and reload | Component coverage | Live pass and component coverage |
| Invalid URL and valid URL with absent request | Unit/component coverage | Live failure feedback; usable retry |
| Daemon stop → offline → startup guidance → restart/refresh | Component coverage | Live pass, including stale active presence |

The feature delta still changes no server or CLI production source; the rebased
base contains their separately accepted changes. The reviewed installer script SHA-256 is
`5f0b83f08e3eb7c39d878de4f6031f034b86de253b512de95ace7243e6ca9a63`.
The public Darwin arm64 asset SHA-256 is
`18f623f2bd913574026685eca8eac62f2e25929ee341c3c5a59ee45982cfa5c5`
(release 1.2.4, payload reports 1.2.3). The unchanged installer auth harness
separately passed normal PTY v2 authorization, machine discovery and encrypted
read-only RPC before its unrelated reinstall probe failed as recorded below.

The final composed export aggregate SHA-256 is
`39ea497a1942c78ce2a720d0f1b031dc5fe2e4483c5f3da6511bdf6531020808`
(SHA-256 over sorted relative paths, NUL, and each file's raw SHA-256 digest).
The [source manifest](source-manifest.json) pins the branch-owned production
bytes; those bytes are identical between this branch and the tested composed
tree. `EmptyMainScreen` and installation copy remain owned by the merged #389.
Raw live screenshots, runtime logs and account state remain private; no runtime
identities or credentials are published here.

The live mobile run used responsive Chromium, not a physical phone. The
component suite separately uses a touch-enabled context and real tap gestures.
No native OS/camera or provider response is claimed. No provider prompt or turn
was sent; normal daemon startup created its default pinned session and an
isolated provider process, which was included in task-owned cleanup.

## Component, source and build evidence

- Original failure reproduced from the base production Connections component
  after the visible Add a machine action at both required sizes:
  [desktop](fixtures/before-desktop.png), [mobile](fixtures/before-mobile.png).
- `ConnectionsSettingsView.browser.test.ts`: 14 cases pass at committed source
  `69068fba` / metadata-only successor `cdef7b6d`, and after the final offline
  recovery correction. The real machine menu, Connections route/SettingsFrame,
  shared first-run screen and code-selection component render with fixture
  storage/transport. en/cn/de, keyboard/touch, long names, cancellation/reopen,
  server recovery, capability-independent discovery, duplicate checks, offline
  retry and persisted machine selection are covered.
- The composed #389 Connections plus EmptyMainScreen suites pass 75/75 cases;
  after rebase, the retained EmptyMainScreen suite also passes 61/61 cases.
  [Desktop setup](fixtures/composed-setup-desktop.png),
  [mobile setup](fixtures/composed-setup-mobile.png), and
  [mobile discovered machine](fixtures/composed-discovered-mobile.png) are
  explicitly component fixtures, including platform/style/asset adapters.
- Final focused Settings/Connections suites pass 31/31, including failed daemon
  identity while the server active flag is still true. Six auth/hook tests
  cover absent requests, preserved v1/v2/authorized behavior and duplicate
  manual submissions with retry.
- App typecheck, catalog/copy/inventory checks, lint, production Web export and
  Web smoke pass. Control-agent, CLI and server builds pass. Node 20.19.0,
  pnpm 10.11.0 and Bun 1.3.11 are used for final local checks. Changelog parser:
  183 entries, latest October 2 — Set up your first machine from Connections.
- Independent source review at `69068fba`, reaffirmed for identical-tree
  `cdef7b6d`, found no actionable introduced defect. The final exact-head review
  and hosted CI receipts are maintained in PR #391.

## Refresh after upstream integration

After PR #374 merged, this topic was replayed on `acd7317346e54ce2813af1db4dc24c9a1d5a118d`.
The only handwritten production conflict was the optional Connections footer
next to the new Get Help action; both are retained. The original auth,
Connections, and manual-submission production files remain byte-identical to
the source manifest. Main's complete patch ledger and locale entries remain.

The first focused run exposed missing `storage` and `useLocalSetting` exports
in the existing Settings and Connections browser adapters. Their fixture state
now supplies the upstream checklist contract; no assertion, timeout, or skip
changed. The other six focused suites passed 95 tests, and the repaired two
browser suites passed all 31 tests. This includes production-host Desktop and
Mobile Connections journeys plus the retained Help/checklist suites.

Node 20.20.1 and pnpm 10.11.0 app typecheck and i18n checks pass. The maintained
generators validate 1,708 locale keys, 45 routes, 341 UI surfaces, 84 smoke
cases, and 184 changelog entries. The latest title is October 2 — Set up your
first machine from Connections. Exact-head hosted checks and strict visual
comparison are reported in PR #391. The earlier authenticated evidence and
its explicit limits above remain historical; no new live-auth proof is claimed
by this mechanical refresh.

## Preserved first failures and limits

- Auth regressions failed before the fix: absent request resolved successfully;
  concurrent submissions approved twice. Assertions pass unchanged afterward.
- Initial typecheck caught an invalid catalog key; the correct existing key is
  `settingsAccount.server`. Concurrent source changes made the inventory stale;
  the maintained generator regenerated it.
- Browser harness bring-up needed Web module resolution, real phone-layout
  context and visible route stand-ins. Server configuration is observed after
  reopening. No assertion, timeout, mask or skip was relaxed.
- Full local Contract first stopped on the inherited noncanonical Git identity.
  Commit metadata was amended to the repository's canonical identity without
  changing shared Git settings. The initial hosted Lint failure is retained.
- The October 3 rebase initially retained the canonical author but inherited a
  local committer identity. Exact-head hosted Lint rejected it; the commit was
  amended with the canonical author and committer without changing shared Git
  settings or source behavior.
- The next local app run had 3,990 passes, four failed tests and two failed suite
  hooks (five files). Settings' harness lacked the newly imported first-run
  WebP loader and adapters, leaving 17 cases unexecuted in addition to ten
  pre-existing skips. Its minimal harness fix passes all 31 affected cases.
  Connections' teardown timeout did not recur in focused runs; its timeout is
  unchanged. No full local Contract pass is claimed.
- Independent pristine-base checks reproduced the focus countdown's extra
  second and the macOS shortcut timeout. The canvas case passed in isolation on
  base and current source. The animation sweep passed on isolated base but
  failed again locally on current source; its cause remains unproved. All
  implicated test/fixture/config/lockfile sources are unchanged. These results
  do not replace final hosted verification.
- Hosted Contract at `cdef7b6d` passed 3,994 app tests and failed only the Settings
  harness build above (27 unexecuted/skipped including its 17 cases). Initial
  production comparisons changed exactly the four changelog captures; the
  other 24 variants matched. The maintained `scripts/kilv-golden-update.mjs`
  regenerated captures from completed run `37003604225` on `cdef7b6d`;
  exactly four changed images were visually inspected. That head's Unit job
  also timed out on the unchanged Commander-context populated:false desktop
  case at 5,000 ms; its Contract job passed that same case. The failure remains
  recorded; its assertion and timeout are unchanged. Superseded `69068fba` quality execution was
  cancelled after its Lint/production failures were retained, to allow the
  corrected head to run; no successful full-suite claim is made for that run.
- The rebased local app suite completed 4,114 passes and ten skips with four
  failures outside this patch's changed source: one Connections load timeout
  passed 14/14 in isolation, and the dark mobile row case passed in isolation;
  the existing Focus timing and desktop-width mobile-sheet assertions still
  fail locally. Their assertions and timeouts remain unchanged. Hosted
  exact-head Unit and Contract results own the final merge status.
- First local CLI build lacked the control-agent artifact. Building the
  workspace dependency first resolved it.
- The published older backend returned HTTP 500 for account profile and several
  other endpoints, causing blank account display and failed terminal approval.
  A fresh current-source backend resolved the live proof. No server repair or
  old-backend full-UI compatibility claim is included in #380.
- A separate installer reinstall probe used `--no-start`, stopped its daemon,
  and failed post-rerun RPC despite stale presence. A later attempt stalled
  because logout required explicit confirmation. These probes do not establish
  continuity; initial authorization/discovery/RPC evidence remains distinct.
- Live testing exposed the stale-presence recovery gap; its retained first
  screenshot had no startup guidance. The final source and regression now
  show guidance immediately after failed daemon identity.

## Activation boundary

Changed runtime lane: app/frontend. The installation prerequisite remains
owned by #376. No server or daemon production code changed. No shared service
restart, deployment, release, merge or issue closure was performed. Only the
created disposable runtime processes are cleaned up; no native success claim
or provider chat-response claim is made.
