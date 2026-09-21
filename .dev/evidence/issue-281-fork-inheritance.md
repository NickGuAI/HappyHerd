# Issue 281 — fork permission and Commander inheritance

- Issue: https://github.com/NickGuAI/HappyHerd/issues/281
- Date: 2026-09-17
- Base: `4c9454af40581865d43ec08ec90d987d19ab5f68`
- Revision under test: the code patch in `fix(sessions): inherit parent permissions and commander on fork`, based on the above revision.
- Status: deterministic reproduction and local repair verified; live acceptance unproved.

## Reproduction and cause

The app's `forkAndSpawn` copied the Claude/Codex conversation and kept the
directory and lineage, but omitted `permissionMode` and `commanderId` from
`spawn-happy-session`. Regression tests with an Athena parent and Claude
`bypassPermissions` / Codex `yolo` failed against the original implementation:
both fields arrived as `undefined`.

The sibling daemon-owned side-chat creation path omitted the Commander too.
Its launch-settings resolution used explicit child selections or machine
defaults without consulting the parent's permission. Tests reproduced the
missing Commander for native forks. The repaired matrix also verifies native
permission arguments and the daemon's launch receipt for Claude, Codex, Grok,
DSH, and Antigravity.

## Repair

- App `sources/sync/ops.ts`: read the current parent at invocation time and
  carry its permission and Commander through both native fork/duplicate
  branches. Use the matching launch receipt when local permission is absent,
  then legacy metadata only when that receipt field is absent. A null receipt
  does not resurrect a stale metadata permission.
- CLI `src/daemon/run.ts`: inherit the authoritative parent's Commander and
  permission in the existing side-chat lifecycle. Grok/DSH use their persisted
  launch policy; mutable providers use the current metadata then the matching
  receipt. Explicit child permission still wins and passes existing catalog
  validation.
- Test cleanup now clears the daemon's actual 10-second shutdown timer rather
  than looking for a 1-second timer; the stale cleanup produced an unhandled
  `process.exit(1)` during a longer test run.
- No new provider-native fork capability is claimed. Claude/Codex have native
  forks; other supported side-chat providers use their existing fresh-session
  lifecycle.

## Checks

Commands run from `server/`, using pnpm 10.11.0. Final CLI suite used Node
20.20.2 and a canonical `/private/var/...` TMPDIR (macOS `/var` is a symlink).
The initial Node 26 CLI run exposed a deprecation-output assertion and two
temporary-path assertions; the supported Node/canonical-path run passed.

| Check | Result |
|---|---|
| Frozen-lockfile install | Pass; lockfile unchanged |
| App fork ops suite | 14 passed, including two previously failing provider rows |
| Daemon continuity suite | 66 passed, including five inherited-provider rows and explicit override validation |
| Full CLI `pnpm --filter @happyherd/cli test` | 170 files / 1,690 tests passed; includes CLI build |
| App and CLI typechecks | Pass; built `happyherd-control-agent` first for its exported type declarations |
| Full app `pnpm --filter happyherd-app test --run --maxWorkers=4` | 275 files passed, one failed; 2,774 tests passed, three failed, one skipped |
| `pnpm --filter happyherd-app i18n:check` | Pass after regenerating inventory fingerprints |
| Production Expo Web export to `dist-ci` | Pass |
| `pnpm --filter happyherd-app web:smoke` | Pass; production React mounted |
| Changelog parser | 134 entries; newest: `September 17 — Forked session settings` |
| `git diff --check`, root source lint | Pass |

The remaining app failure is
`sources/components/workspaceDelete.browser.test.ts`: browser
`global is not defined`, one test timeout, one listing assertion, and teardown
timeout. That fixture substitutes its own `@/sync/ops` and `./ops` modules, so
it does not execute the modified app implementation. Its failures were not
repaired as part of this issue. The full run's existing 73 side-chat browser
tests passed, but they do not establish this new inheritance journey.

## Human acceptance still required

Journey: open an existing session with a selected Commander and non-default
permission, invoke Fork/Duplicate (or New side chat), then inspect the new
session's original directory, Commander, displayed permission, and effective
provider behavior. Refresh and resume the child and verify the retained state.
Creation failure must retain the existing error/retry path.

| Surface / proof plane | State |
|---|---|
| Web Desktop, actual fork/side-chat gesture with updated daemon | Unproved |
| Web Mobile, actual fork/side-chat gesture with updated daemon | Unproved |
| Native iOS/desktop clients | Unproved; no native device acceptance collected |
| Authenticated native provider permission behavior after fork | Unproved |
| Deployment | Not performed |

Read-only `happyherd daemon status` through the maintained source entrypoint
reported the running local daemon as version 1.2.2. Activating the repaired
app/daemon and running the above journey is the next acceptance step. The
current daemon was not replaced or restarted.
