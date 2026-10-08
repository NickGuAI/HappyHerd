# Focus pixel-swap browser timing (#396)

## Scope and source identity

Test measurement only. No production component, animation, delay, duration,
countdown, reduced-motion behavior, or product copy changes. No product changelog
entry is appropriate. The app continues using its real Web Animations API effects.

Baseline: `b07948f988e1c08cc3eabba1b776d6c843e0f07e`.
Original failing CI revision: `21b09e5428b6764e6840b4cdeb1e640ba3b7f261`.
The issue's first failure remains preserved in
[Contracts attempt 1, job 111229013767](https://github.com/NickGuAI/HappyHerd/actions/runs/37132058568/job/111229013767):

```text
onset 1296,0: expected 150.05882352941177 to be less than 150
Test Files  1 failed | 378 passed (379)
Tests       1 failed | 4431 passed | 10 skipped (4442)
```

## Reproduction and causal evidence

Local date: 2026-10-06 (America/New_York). Node 20.20.2, pnpm 10.11.0,
macOS arm64, Google Chrome 154.0.8037.98, repository Playwright/Vitest versions.
Dependencies installed only inside the task worktree with `pnpm install
--frozen-lockfile`; tracked lockfile unchanged. No shared services were restarted.

[Baseline instrumentation](issue-396-baseline-instrumentation.patch) applies to
the baseline test and preserves all its assertions. It records callback wall time,
document timeline time, and the browser's resolved animation start/delay/duration.
With `FOCUS_SAMPLING_GAP=1`, only the sampler misses observations in two windows;
the real animations keep playing without pausing, seeking, or altered timing.

From `server/`, using the pinned toolchain in the child PATH:

```sh
NODE_ENV=test pnpm --filter happyherd-app exec vitest run \
  sources/components/herd/shell/herdShell.browser.test.ts -t 'sweeps the amber pixel'
FOCUS_SAMPLING_GAP=1 NODE_ENV=test pnpm --filter happyherd-app exec vitest run \
  sources/components/herd/shell/herdShell.browser.test.ts -t 'sweeps the amber pixel'
```

The **first local run failed naturally**, before introducing sampling gaps:

```text
clear 1296,405: expected 151.89999997615814 to be less than 150
```

That tile's grow/clear animation start time was `1633.8240000186488` ms;
delays were `662.9679144385027` and `2062.9679144385027` ms; both durations
were exactly 450 ms. Observed onset/full/clear were `789.3000000119209`,
`884.3000000119209`, and `2341.199999988079` ms relative to the sampler's
first layer observation. Maximum callback sampling gap: 126.6 ms. Maximum
`performance.now()` minus document timeline: 12.8 ms. Coverage passed.

| Diagnostic run | Maximum sampled onset error | Maximum sampled clear error | Maximum sample gap | Maximum browser-scheduled clear interval error |
|---|---:|---:|---:|---:|
| First natural run | 121.614 ms | 151.900 ms | 126.600 ms | < 0.000001 ms |
| Controlled sampling gaps | 385.736 ms | 418.100 ms | 484.800 ms | < 0.000001 ms |

This establishes that the old first-observed-frame subtraction can reject the
correct browser animation schedule. Clear opacity also has a different eased
threshold offset from grow opacity. The precise historical CI runner's scheduling
cause cannot be recovered from its log; no product animation regression is claimed.
The [Web Animations specification](https://www.w3.org/TR/web-animations-1/)
defines rAF timestamps and the document timeline on the same animation clock;
`performance.now()` can advance between animation updates.

## Repair and retained proof

- Read resolved real animation start times and effect timings for every tile.
  Verify the diagonal onset and 1,400 ms clear offset within **1 ms**, replacing
  the old 150 ms sampled-time bounds. Verify both 450 ms durations and 2,800 ms
  total schedule independently.
- Pin actual browser opacity/transform keyframes, easing, fill, and playback rate,
  so a late opacity curve cannot hide behind a correct delay.
- Retain natural rendered opacity crossings as observation brackets in the
  document timeline. Each bracket must intersect its effect's active interval;
  missing onset/full/clear observations fail. These brackets alone are not the
  timing proof: the independently checked schedule and curve establish timing.
- Preserve all-tile simultaneous opacity coverage, pointer pass-through, inert /
  aria-hidden layer, natural layer removal within the original 400 ms bound, and
  the visible countdown underneath. Additionally verify amber color, tile sizes,
  and that each tile reaches full scale.
- Run both themes with normal and deliberately sparse sampling; the sparse case
  requires a measured gap greater than 350 ms. No retry, skip, timeout increase,
  or production animation control is introduced.

## Initial verification and review

Focused normal/sparse tests passed in both themes. Temporary, uncommitted product
faults were restored byte-for-byte after testing:

- Add 200 ms to tile 1's grow delay: rejected with `onset 81,0: expected
  200.00000000000006 to be less than 1`.
- Keep clear opacity at 1: rejected because the real clear observation is absent.
- Hold grow opacity at 0 through its middle keyframe while keeping its timing:
  rejected by the actual browser keyframe assertion.

Independent provider-native review identified the need to pin actual opacity
curves in addition to schedule/observations; the implementation includes that fix.
Final committed-head review, loaded repetition, full Contracts, and exact-head CI
receipts belong in the PR handoff; initial focused passes are not full acceptance.
