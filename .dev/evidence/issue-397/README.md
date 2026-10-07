# Issue #397: real-process fixture lifecycle

Baseline: `b07948f988e1c08cc3eabba1b776d6c843e0f07e` (fetched main).
Historical failure: [Contracts run 37132058568, job 111232844005](https://github.com/NickGuAI/HappyHerd/actions/runs/37132058568/job/111232844005)
on `21b09e5428b6764e6840b4cdeb1e640ba3b7f261`.
The historical log establishes a 5000ms timeout, but contains no phase trace.
`original-ci-excerpt.txt` retains its relevant lines.

## First reproduction (before repair)

Node 20.20.2 on macOS arm64; eight concurrent real owner/backend pairs.
The first diagnostic run used the unmodified baseline fixture, stopping new
iterations once a 5000ms timeout was observed. It attempted 301 cycles and
reported eight failures (see `baseline-repro-first.txt`). First failure:

- ready/backend PID received at 26ms;
- SIGTERM sent at 26ms;
- owner exited from SIGTERM at 28ms;
- no stopping acknowledgement; acknowledgement wait timed out at 5000ms.

This proves the readiness-before-handler race under concurrent process load.
It does not retroactively identify the phase of the historical CI failure.
The reproduction harness uses a separate detached process group per fixture
and kills only that group on failure. No daemon, account or provider is used.

Reproduce the baseline with `reproduce.cjs` and a copy of the baseline owner:

```sh
git show b07948f988e1c08cc3eabba1b776d6c843e0f07e:server/packages/happyherd-cli/src/daemon/fixtures/resume-owner.cjs > /private/tmp/issue-397-baseline-owner.cjs
node .dev/evidence/issue-397/reproduce.cjs /private/tmp/issue-397-baseline-owner.cjs 1000 8
```

The retained harness additionally asserts both processes live after the stopping
acknowledgement and dead after owner exit; it understands the repaired fixture's
intermediate backend-started/backend-exited messages. The original first run
only traced events and normal exit, matching the original stalled await.

## Repair boundary

Only test code changes. Production `sessionLiveness.ts` remains unchanged.
Owner signal/message/disconnect handlers precede readiness; readiness follows
backend IPC readiness. Parent waits retain messages and exit state, distinguish
ready/stopping/finish/exit, reject early termination, and report phase traces.
The backend exits on owner IPC loss, including abnormal owner death. Normal
owner shutdown reaps the backend before exiting. Cleanup begins at fork, has
bounded termination confirmation, and preserves a first failure alongside any
cleanup failure. No timeout increase, retries, skipped tests or relaxed live/dead
assertions. No user-facing change, so no product changelog entry applies.

## Initial repaired-source validation

Tools selected through task-owned PATH: Node 20.20.2, pnpm 10.11.0, Bun 1.3.11.
Frozen task-local install passed; lockfile unchanged. No shared installation
was changed. Commands below run from `server/` except the load harness.

- `pnpm --filter @happyherd/cli exec vitest run --project unit src/daemon/sessionLiveness.test.ts`:
  14/14 passed; see `focused-first.txt`.
- `node .dev/evidence/issue-397/reproduce.cjs "$PWD/server/packages/happyherd-cli/src/daemon/fixtures/resume-owner.cjs" 1000 8`:
  1000/1000 passed, no retries; see `repetition-first.txt`.
- Deliberate local mutation of owner SIGTERM handler to `process.exit(23)`:
  original live-after-SIGTERM test failed at `stopping`, with ready at 54ms and
  disconnect at 56ms; other 13 tests passed. Cleanup completed; the original
  failure remained visible (`fault-owner-exit.txt`). Mutation restored immediately.
- `pnpm --filter @happyherd/cli typecheck` initially reported missing
  `happyherd-control-agent/control` and `/auth` declaration outputs. After
  `pnpm --filter happyherd-control-agent build` (the CI prerequisite), the
  same typecheck passed. No source workaround.

Final committed-head review, complete Contracts and CI receipts are recorded in
the PR, with exact head SHA. These initial results do not claim full acceptance,
a production-provider journey, Linux proof, or deployment.
