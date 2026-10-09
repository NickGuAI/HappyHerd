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
