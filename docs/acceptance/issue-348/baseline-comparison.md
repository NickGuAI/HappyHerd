# Local full-suite baseline comparison

The local contract run reached the complete app suite with 349 test files
passing and three failing: 3,816 tests passed, four failed and ten were skipped.
It ran from source `337aba33843196202edbf006c00b9ad5696ff80d`; the subsequent
`98f9474b1f702f81bf9a0885ea0ef4509ff335e7` commit only refreshed four changelog
goldens, their provenance and the patch ledger.

One failure was an obsolete assertion in `desktopWorkspace.browser.test.ts`
that placed the feedback textarea beside Send. The redesign places the action
row below the textarea. The updated assertion checks containment within the
narrow Workspace and composer card, vertical separation, and the 44 px Send
target. The existing exact feedback-payload and draft-clearing checks remain.

The other three failures were compared serially against an archive of base
`7cc9e62f27a22d36578051e84c1c51dacace665b` and head `98f9474b…`, sharing the
same dependency installation. The test files, fixtures and relevant production
owners have identical Git blobs at both revisions. All four focused invocations
reached the requested tests; none failed during setup.

| Unchanged test | Base result | Head result |
| --- | --- | --- |
| `herdShell.browser.test.ts`: collapses with the shortcut or top-bar toggle | Failed: 1,000 ms timeout waiting for the exiting-width state at line 753 | Same failure and location |
| `projectsSuperSession.browser.test.ts`: starts all four focus durations | Failed: `15:01` instead of `15:00` at line 785 | Passed |
| `projectsSuperSession.browser.test.ts`: German dark mobile focus setup | Failed: `60:01` instead of `60:00` at line 899 | Passed |

These are observed baseline failures. Focus results vary between executions;
their precise cause is unproved. No unrelated production code or timeout was
changed. The local full suite is not reported as green.

Environment: Node 20.20.2, pnpm 10.11.0, `TMPDIR=/private/tmp`, `TZ=UTC`.
Commands were run from each revision's `server/` directory:

```sh
pnpm --filter happyherd-app exec vitest run \
  sources/components/herd/shell/herdShell.browser.test.ts \
  -t 'collapses with' --maxWorkers=1 --minWorkers=1
pnpm --filter happyherd-app exec vitest run \
  sources/components/projectsSuperSession.browser.test.ts \
  -t 'starts all four focus durations|keeps the German dark mobile focus setup' \
  --maxWorkers=1 --minWorkers=1
```

Local evidence is retained in `/private/tmp/hh348-contract-final.log`,
`hh348-shell-baseline.log`, `hh348-shell-final-head.log`,
`hh348-focus-baseline.log` and `hh348-focus-final-head.log` in the same temporary
directory. The PR and final issue receipt record subsequent exact-head CI and
the complete Workspace browser regression result.

## Comparison after main advanced

After Athena's PR #358 merged, the branch was rebased onto
`abefe670ec8bdc7e44732ef52c90d8046486e294`. The same commands were run serially
on an archive of that new base and source head
`ea62062f31aa42a5589c410d2d9967d530c49423`. Relevant test and runtime blobs are
identical between that base and head; all invocations reached their assertions.

| Unchanged test | New base | Rebased head |
| --- | --- | --- |
| Sidebar collapse | Failed: 1,000 ms timeout at line 753 | Same failure |
| Four Focus durations | Failed: `45:01` instead of `45:00` at line 785 | Failed: `15:01` instead of `15:00` at the same line |
| German mobile Focus | Failed: `60:01` instead of `60:00` at line 899 | Passed |

The rebased issue-focused matrix passed all **90 tests in eight files**,
including the full 48-test Workspace browser suite. Logs for the new comparison
are `/private/tmp/hh348-rebase-{shell,focus}-{baseline,head}.log`; the focused
matrix log is `/private/tmp/hh348-rebase-focused.log`. Environment and proof
limits are unchanged. The old comparison above remains historical evidence.
