# #453 — Restore temporary Claude hook settings at each launch

## Contract and scope

Base: `b03a81b63e71446d3cae9c56a0a236b352ee07f1` (main).
The delegated deliverable is a local review candidate, with publication owned by
its parent. No installed CLI, daemon, server, native app, credentials, or other
session was changed. The issue remains open.

The hook server port now travels explicitly with the settings path through
`runClaude` → `loop` → `Session` → both launchers. Local launch restores settings
immediately before `crossSpawn`, after asynchronous sandbox preparation. Remote
launch restores them immediately before SDK `query`, after waiting for input and
before native resume initialization. The helper recreates the owned temporary
directory and settings using modes 0700/0600, retaining the existing forwarder
and SessionStart configuration. No periodic timer or persistent storage was
added. Offline local launch still has no hook settings.

Shutdown removes the empty owned directory even if the file was already deleted.
If local settings preparation fails after sandbox initialization, sandbox cleanup
runs once while preserving the initiating error. Existing SDK fixture suites
mock settings I/O for their invented paths; the new boundary suite uses the real
generator and filesystem and observes the file at actual spawn/query calls.

## First regression and focused verification

Commands run from `server/`, Node 24.20.0, workspace-selected pnpm 10.11.0.
The global pnpm shim reports another version outside the workspace; the install
log and workspace readback both identify 10.11.0. SDK 0.3.296; installed Claude
Code 2.1.322. Own frozen filtered CLI dependency store, no sibling borrowing.

- One `pnpm install --filter @happyherd/cli... --frozen-lockfile --ignore-scripts`:
  exit 0, 24.26s. Maintained root postinstall, including wire build: exit 0, 4.17s.
- Initial control build used the incorrect scoped package filter: exit 0 but
  **no projects matched**, so it is not build evidence. Correct declared
  `pnpm --filter happyherd-control-agent build`: exit 0, 3.30s.
- Added `hookSettingsLaunch.test.ts` before modifying production source. First
  unchanged-main run: **5 failed / 1 passed**. The four local/remote deletion
  cases passed their initial control launch, then failed ENOENT at the actual
  spawn/query seam after file or directory removal. The fifth failure was the
  empty directory remaining after deletion-before-cleanup. This was a natural
  regression run, not restoration of broken source after a fix.
- First repaired run: new boundary 6 + existing generator 1 = **7 passed**.
- Affected 11 files: **174 passed** (local, local launcher, remote, plugins,
  native resume, rotation, remote launcher/heartbeat, runClaude, generator and
  boundary). Existing globalSetup and runner budgets unchanged.
- Source review identified sandbox cleanup on the newly introduced ensure-error
  path. Added that cleanup and two tests: deletion during awaited wrapping and
  obstruction before spawn with a throwing cleanup. Final boundary **8 passed**.
- Declared CLI typecheck: exit 0, 4.28s. Explicit CLI build: exit 0, 8.30s.
- Official app changelog parser: exit 0, 211 entries; latest title
  “November 17 — Keep long-running Claude sessions working”.

Focused command format:
`pnpm --filter @happyherd/cli exec vitest run --project unit --maxWorkers=1 --no-file-parallelism <files>`.
All first commands, outputs, timings, process-group readbacks and disk samples
are retained under task-private `.artifacts/issue-453/`.

## Broader package result — not green

One full CLI unit invocation with the same project/worker flags: exit 1,
**2,418 passed / 14 failed**, 212 passing files / 5 failing files, 170.35s.
The failing files and their owners are unchanged from the base; no unrelated
repair, assertion change or rerun was made:

- Commander context (4) and Claude executable (1): macOS `/var` versus canonical
  `/private/var` path expectations; the unreadable-file mock also compares the
  noncanonical path literally.
- Local voice RPC (2): platform expectation `unsupported` versus `not-installed`.
- Difftastic (5): vendor executable prerequisite absent in this filtered install.
- Ripgrep (2): system-ripgrep diagnostic preamble differs from fixture expectations.

See `cli-unit-full-first.log` and `full-unit-failure-scope.json`. These are named
local full-suite limitations, not a passing aggregate or proof of future CI.

## Live native proof

One disposable source-built HappyHerd Claude session, using the normal existing
login and current production launch code, completed three harmless no-tool turns:

| Turn | Action before send | Result |
|---|---|---|
| Control | Existing settings, low effort | Exact requested reply; SessionStart callback 1 |
| File deletion | Delete only owned file; medium effort forces relaunch | Exact reply; callback 2 |
| Directory deletion | Delete owned file and its now-empty directory; high effort forces relaunch | Exact reply; callback 3 |

All three callbacks used the same hook server port. Recreated settings bytes
were identical, modes were 0600/0700, and neither missing-settings nor launch
errors appeared. Source-built API sending preserved effort metadata and therefore
actually triggered two mode-change relaunches. No raw credentials were copied.

Before shutdown the owned file was deleted once more. The supported exact-session
stop returned success; process exited naturally 0, its process group was absent,
the hook port refused connections, and both file and directory were absent.
Private receipts: `live-{control,file,directory}-proof.json`,
`live-teardown-first.json`, `live-tested-source-hashes.json`.

The initial smoke startup exited 1 **before session creation or provider turns**:
it inherited this worker's consumed transient Commander context path. Its first
log and receipt remain unchanged. The smoke harness then prepared a fresh context
through the existing Commander-context owner; only the resulting single session
was used and stopped. This was a harness correction, not a product repair.

This verifies manual deletion, not an actual invocation of the OS three-day
cleaner. Real native proof is remote mode; local spawning is covered by the real
filesystem/simulated-provider regression. The separate investigation worker's
original failure and its earlier incomplete sender probe remain separate.

## Review and activation

Used repository delivery/provider workflows; bounded inline source review found
and then cleared the sandbox cleanup issue. Shared `engineering-review` tooling
was not available in the supplied skill catalog; parent exact-commit review is
still required. Apply the repository sign-off lane distinction: this changes
Claude session-process CLI code, not the running daemon/server/Web/native app.
Existing old CLI session processes have not been patched in place.

No push, PR creation, merge, installation, service restart, or issue closure.
Full local sign-off remains withheld for the disclosed aggregate failures and
pending exact-head CI. The parent owns publication and subsequent CI. The earlier
missing-upstream prerequisite is resolved: the parent restored the official
`https://github.com/slopus/happy.git` remote and trusted upstream/main ref
`1d6d88c5e14cbfb98cad76881acd7ff171edb50c`. All final repository gates passed on
`bcc4007806e3e0ea49c45bd7d227731a6ea1d2aa`, including patch discipline
(863 owned / 28 .dev-only / 1 pinned legacy), without bypasses. Two independent
parent exact-commit source reviews reported no actionable product-code findings.
This follow-up changes evidence only; production and test bytes remain identical
to the tested and live-smoked candidate.
