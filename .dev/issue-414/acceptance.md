# Issue 414 — source and focused CLI acceptance

Owner: https://github.com/NickGuAI/HappyHerd/issues/414

Base: `632dc24332e49bfd773c5163ab8c045a3b74a5cf`.
Branch: `task/issue-414-astra-20261015`.
Session: `cmva5cjo91577t01swiknrz9o`; parent:
`8809d047-1cb3-4ea6-bffc-5be43de17557`.
Dispatched settings: GPT-6-Astra / medium / yolo (parent-confirmed daemon
receipts; no independent settings verification or provider launch here).

## Current verification status

The exclusive first CLI slot completed with natural exit 0 for every prescribed
stage on fixed `d2919d3ba0885edee003fce18c601b930294feb4`, tree
`95e1928c1bbb82d763d521c88a81b0b182375d1c`. All 76 tests in the four selected
files passed on their first execution. CLI build/typecheck and the official
changelog parser passed. The slot was explicitly released to the parent.
The dated source-phase sections below are historical receipts, not claims
that these checks are still unrun. See the final CLI receipt section below.

## Boundary and evidence

The existing mapper recognizes meta user task notifications whose XML follows
`[SYSTEM NOTIFICATION - NOT USER INPUT]` only when `origin.kind` is
`task-notification`. Existing #344 native JSONL fixtures encode that contract.
`SDKToLogConverter.convert` preserves the meta flag but previously omitted
`origin`. Feeding that supported notification shape through the converter
therefore made the mapper skip its child terminal outcome as ordinary meta text.
The repair preserves the supplied origin without expanding notification parsing.

This establishes a source-level information-loss boundary, not the root cause
of the owner's screenshot. The fixture is synthetic and composed from the
existing native-notification contract; a live SDK emission of this shape has
not been captured. Typed SDK system task notifications already retain their
fields. Local scanner schema parsing uses passthrough and also retains origin.
No change is made to either path, parent completion, or background launch rules.
PR #359 introduced the relevant mapper contract, but remains a suspected link
to the reported session rather than a proven causal regression.

## End-to-end source trace

- Remote: `claudeRemote` forwards events → `claudeRemoteLauncher` outgoing queue
  → `SDKToLogConverter` → API `sendClaudeSessionMessage` → protocol mapper.
- Local: `sessionScanner` parses retained JSONL with `RawJSONLinesSchema`
  passthrough → API `sendClaudeSessionMessageFromLocalTranscript` → same mapper.
- Mapper correlates task ID through launch receipt/task events to tool call and
  stable session subagent ID, then emits authoritative per-child stop envelopes.
- API enqueues protocol envelopes for encrypted session persistence. App
  `typesRaw` converts stop envelopes to the matching Subagent tool result.
- Reducer preserves authoritative results against provisional results and keeps
  activity attached to the child. `SubagentView` uses result status for its badge;
  shared `ToolView` uses tool state/completedAt for header/spinner/time.
- Existing app `subagentLifecycle.spec.ts` covers terminal replay before/after
  launch and running siblings; `SubagentView.spec.ts` covers presentation.
  These are selected checks, not freshly executed evidence.

## Changed coverage and checks

New converter-to-mapper regression covers completed/failed/stopped (cancelled)
notifications after launch acknowledgment and parent completion, sibling
isolation, repeated terminal notification, delayed progress, repeated fresh
mapping, and exclusion of ordinary user/unrelated meta text. No original
assertions or time budgets were changed.

Source-phase checks:

- Node 26.6.0 TypeScript syntax stripping: changed implementation/test parse.
  This is not the supported Node 20 toolchain or typechecking.
- `node scripts/lint-source.mjs`: passed (reports 6210 inspected paths).
- `git diff --check`: passed.
- Existing changelog parser executed through Node TypeScript stripping with
  import/export/entrypoint adaptation only; newest title and 200 entries agree
  with Markdown. First attempt failed because the shebang was passed into
  `new Function`; removing the shebang from the in-memory runner fixed it.
  Parser source and parsing behavior are unchanged.
- Initial navigation used root-relative paths from `server/` and failed with
  missing paths; corrected to repository root. First parent send failed with
  ENOENT from that same path mismatch; retry of the same message ID was queued.

No dependency installation, package tests, builds, browser, device, native or
provider runtime checks have run. No dependencies borrowed from other worktrees.
No CI, exact-head external review, push or PR yet. Parent must assign the
sequential resource slot and later publication authority.

## Required next proof

From `server/`, pinned pnpm 10.11.0 / supported toolchain:

1. CLI focused converter, mapper/background and scanner tests on the current
   committed fixed source; preserve every actual first failure.
2. CLI typecheck and package tests; app existing subagent lifecycle and view
   tests, then applicable app/i18n checks. No UI-owning source changed, so no
   inventory regeneration is triggered by this patch.
3. Repository contract checks and independent exact-head review before PR.
4. Real Claude child terminal transition, including active/background sibling,
   with sanitized native input → stored envelope → displayed card evidence.
5. Desktop and mobile production session: open child activity, observe matching
   badge/header/spinner/frozen elapsed time and retained output, refresh/reconnect
   and repeat. Both web surfaces and native hosts remain unproved; no deployment
   or device authority is implied.

The owning issue stays open. Missing reported child IDs, actual terminal event,
running revision, and live rendered proof remain acceptance gaps.

## Parent review follow-up and resource packet

Parent confirmed the converter boundary and authorized this narrow repair.
#394 owns `claudeRemote.ts` result handling and `claudeRemote.test.ts` /
`claudeRemoteLauncher.test.ts`; no changes to those files are included here.

Expanded source coverage includes two task IDs whose terminal notifications
arrive before launch receipts, reverse receipt order, late sibling progress,
and serialization followed by `RawJSONLinesSchema.parse` before fresh replay.
The replay assertions compare stable envelope/turn/child IDs and outcomes.
Negative cases now start from an active child, so terminal deduplication cannot
mask an incorrectly accepted notification. This is prepared coverage, not run.

Raw user schema explicitly preserves `isMeta` and uses top-level passthrough,
which preserves `origin` and launch-result fields. No schema changes are needed.
`stopped` and `killed` map to cancelled; explicit cancelled is also accepted.
The mapper does not accept `interrupted` task notifications. The workspace
re-exports SDK types, and the lock pins SDK 0.3.296, but dependencies are absent;
that SDK's exact task-status union has not been inspected here. Do not claim an
interrupted task-notification contract or fabricate terminal evidence. Inspect
the pinned SDK declaration during the assigned dependency phase and report any
supported missing outcome before changing mapper scope.

Concrete commands proposed for the assigned sequential slot (not run):

```sh
# server/; supported Node 20 and pnpm 10.11.0
pnpm --filter @happyherd/cli... install --frozen-lockfile --ignore-scripts
pnpm --filter @happyherd/wire build
pnpm --filter happyherd-control-agent build
pnpm --filter @happyherd/cli exec vitest run --project unit --maxWorkers=1 --no-file-parallelism src/claude/utils/sessionProtocolMapper.background.test.ts src/claude/utils/sessionProtocolMapper.test.ts src/claude/utils/sdkToLogConverter.test.ts src/claude/utils/sessionScanner.test.ts
pnpm --filter @happyherd/cli typecheck
```

The first package run MUST use the actual current committed fixed source.
Do not restore the old converter to manufacture a first failure. No baseline or
mutant run is authorized by this packet. If separately requested later, label
it counterfactual rather than historical reproduction, bound the change and
restore the exact head. Do not alter assertions, setup or budgets. The full
CLI package checks remain required after focused coverage.

Dependency footprint: CLI plus workspace wire/control-agent and their locked
transitive dependencies/dev toolchain. Runtime imports in the focused mapper
suite include wire, cuid2 and Zod; Vitest also loads the unit environment setup.
CLI Vitest's global setup runs `pnpm build` (CLI tsc + pkgroll), even for a single
file, so this is a build-capable resource slot, not a lightweight test-only run.
Wire/control-agent exports resolve built dist files. A filtered install with
scripts disabled avoids the root patching hook and CLI shared-home seeding;
necessary package builds are explicit. This is a proposal for the parent-owned
slot, not permission to install or alter machine state now. Disk usage is not
measured or promised; no broad audit or dependency borrowing was performed.

App proof requires its own additional dependency footprint; when assigned:

```sh
pnpm --filter happyherd-app exec vitest run --maxWorkers=1 --no-file-parallelism sources/sync/reducer/subagentLifecycle.spec.ts sources/components/tools/views/SubagentView.spec.ts
```

No app install/build/browser allocation is included in the initial CLI proposal.
Full app/i18n requirements and real production journeys remain separate gaps.

## Source revision provenance and slot order

Initial source receipt: `bd0cf54fb2588650958fee8c8c437a272970325a`, retained
locally at `refs/issue-414/source-phase-initial`. Its clean-tree receipt describes
that moment, not later edits. Expanded active-child negative cases and schema
roundtrip/out-of-order replay were committed at
`5e193a300db6b17307dfdc53105ef7d2322ffc09`; that source check was clean, with no
package execution. The negative cases in the initial head ran after terminal
state and alone could not establish rejection; the expanded cases fix that
discrimination. Both revisions remain fixture/source evidence, not live SDK or
reported-session reproduction.

Parent assigned #394 the exclusive first install/build/test slot. #414 is next
in the queue, not authorized to start resources. This receipt correction does
not change that hold. Parent owns installed prerequisites and the later slot,
exact-head review and publication decisions. No independent app, browser,
native or provider runtime allocation is requested as part of the CLI slot.


## First fixed-source CLI slot — terminal 0, released

[Machine-readable receipt](cli-slot-receipt.json) retains before/after hashes,
exact commands, actual stage timestamps, limits, exit codes, process groups,
space readings, versions and log hashes. Original logs remain in this worktree
at `.artifacts/issue-414-cli-slot/`; no initial output was overwritten.

| Stage | Result |
| --- | --- |
| One filtered frozen own-store install, scripts disabled | 0 |
| Unchanged maintained root postinstall, including wire build | 0 |
| Explicit control-agent build | 0 |
| Explicit CLI build | 0 |
| Exact four-file focused command | 0; 4 files / 76 tests passed |
| CLI typecheck | 0 |
| Official changelog parser via root resolution | 0; 200 entries, expected newest title, generated JSON unchanged |

Node 20.20.2 and pnpm 10.11.0 were verified immediately using parent-provided
executables and task-owned command-scoped wrappers. The task used its own
store and no sibling dependencies. Vitest's existing global setup and its CLI
build were retained. Local one-worker/no-file-parallelism constraints do not
constitute default CI proof. No test assertion, configuration or budget changed.
No baseline/mutant run, retry, app install, runtime provider turn or device run
occurred. Root postinstall's maintained dependency patches ran as authorized;
CLI postinstall/shared-home seeding did not run.

Free disk was 13.6 GiB before install and 13.185 GiB at final snapshot; all stage
boundaries stayed above 8 GiB. The runner polled the floor while each stage ran.
All stages naturally exited 0 without cleanup signals. Final `ps -g` selections
for each recorded group returned 1 with empty stdout/stderr (no selected
processes). No historical/recycled process group was signaled. The receipt's
132-second total includes a conservative 45-second preflight allowance, not a
measured preflight duration; recorded stage times are exact observations.

Before/after source, lockfile, global setup/configuration and changelog hashes
match, and the tested tree stayed tracked-clean. The lockfile SHA256 is
`79bd621c488cbabaab545159e95b9c685be430e0573eac3d8b7cc10a750fcae4`.
This final evidence update does not modify production or test bytes.

Installed SDK 0.3.296 declarations at the own workspace's hoisted
`server/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` confirm
`SDKUserMessage.origin?: SDKMessageOrigin` and task-notification status
`completed | failed | stopped`. `stopped` is mapped to cancelled by the existing
mapper. No `interrupted` task-notification status is declared; no new behavior
was introduced. The initial read assumed a package-local dependency path and
failed; locating the actual own hoisted dependency resolved the read without
installation retries. The declared origin contract supports the converter
repair, but does not capture a real SDK emission or the reported session.

Observed nonfatal logs include the existing expo-tailcat Node >=22 engine
warning under the required Node 20 toolchain, and pkgroll bin/empty-chunk
warnings. Those do not replace the independently observed explicit CLI build
exit 0. Full CLI/package/contract suites, default CI, app lifecycle/view/i18n,
rendered Desktop/Mobile/native journeys, live provider transition and independent
exact-head review are still unperformed. No push, PR, merge, deployment,
restart or issue closure occurred.
