# Issue 410: signed-out journey timeout investigation

Status: **diagnostic only; cause and repair unproved**. The issue remains open.
No production route, assertion, timeout, retry, skip, browser configuration,
or shared fixture helper changed. No product changelog is appropriate.

## Preserved first failure

Baseline: `3a3773303a5539f6c9deddbd04197b92cbab9a76`. The signed-out test is
byte-identical to failing revision `d89ec60562457a72c21acdb86c61a8c976b59797`.
[Quality attempt 1, job 113326353857](https://github.com/NickGuAI/HappyHerd/actions/runs/37781725396/job/113326353857)
reported:

```text
SignedOutLanding.browser.test.ts:152:19
preserves account entries, input state and readable geometry: 'dark'/'de'/1440
Test timed out in 20000ms. (observed duration 20003ms)
Test Files 1 failed | 378 passed (379)
Tests 1 failed | 4434 passed | 10 skipped (4445)
```

The log identifies no awaited operation. The independent
[Contracts job on the same revision](https://github.com/NickGuAI/HappyHerd/actions/runs/37781725413/job/113326345738)
passed the exact case in 1,976 ms. Neither that control nor a later passing retry
establishes the historical cause.

## First local observations, before instrumentation

2026-10-08; macOS arm64, pinned Node 20.20.2, pnpm 10.11.0, existing Chrome,
UTC, canonical temporary path, GNU sed. Task-local frozen installation passed
in 20 seconds; tracked files remained unchanged. No provider was invoked.

From `server/`, with the pinned tools selected in the child process PATH:

```sh
DEBUG=pw:api TZ=UTC NODE_ENV=test pnpm --filter happyherd-app exec vitest run \
  sources/components/SignedOutLanding.browser.test.ts \
  -t 'preserves account entries.*dark.*de.*1440' \
  --maxWorkers=1 --minWorkers=1 --reporter=verbose
DEBUG=pw:api TZ=UTC NODE_ENV=test pnpm --filter happyherd-app test --run \
  --maxWorkers=3 --minWorkers=1 --reporter=verbose
```

The first focused run passed the one selected case in 1,393 ms; 23 cases were
unselected by the filter. API tracing recorded every operation completing.
The longest in-case operation was page creation at 505 ms. Browser launch
took 4,985 ms in `beforeAll`, outside the case's 20-second budget.

The first complete app run started at 19:27:12 UTC and terminated with exit 1
after 610.67 seconds. All 24 SignedOutLanding cases passed, including the
original dark/de/1440 case in 1,041 ms. Aggregate result: 370 files passed,
nine failed; 4,432 tests passed, three failed, ten existing skips. Eight other
fixture `afterAll` hooks timed out. The three test failures were the desktop
Workspace canvas edge wait and both themes of the panel overlay scrim dismissal.
These are distinct out-of-scope observations, not an aggregate pass or evidence
of this issue's cause. No local rerun was performed.

Original raw logs are retained task-locally as `quality-attempt1-job113326353857.log`,
`contracts-original-job113326345738.log`, `focused-original-first.log`, and
`full-app-original-first.log`; private machine paths and raw transcripts are
not published here.

## Diagnostic change and remaining proof

The test now emits fixed phase names with elapsed milliseconds and a matrix
case identifier before each awaited operation. Setup and teardown have separate
identifiers. This makes a future whole-case timeout attributable to its last
entered operation without relying on Playwright's longer operation timeout.
Diagnostics log no account input or HTTP response. All existing awaits and
assertions retain their order and the original 20-second deadline.

Source audit and an independent Codex audit found no established production
route defect. Candidate boundaries remain context creation, navigation,
font readiness, geometry/actionability, input/resize, fixture history Back,
account response/completion, and page closure. None is declared the cause.
The QR-auth fixture deliberately remains pending, but its visible instructions
and manual-key button do not wait for it.

Required next evidence: default-CI execution of the diagnostic head; an observed
failing phase or evidenced deterministic reproduction at the owning boundary;
then the smallest repair, regression proof, exact-head review and applicable
full checks. A diagnostic PR must remain draft while that evidence is absent.

The retained rendered contract covers Web Desktop 1440×900 and Web Mobile
390×844/360×800, en/cn/de, light/dark: visible account entries, readable geometry,
editable key input at 16 px or greater, draft retention on resize, Back and
linked-device/manual navigation, plus isolated create-account handoff and
failure/cancel/retry coverage. Native devices and live existing-account grants
are not proved by this fixture. No deployment or runtime activation is needed
for test diagnostics.
