# Issue #296: pinned integration rehearsal and remaining work

**Blocked draft; no new upstream implementation is delivered by this report.**

Owner: <https://github.com/NickGuAI/HappyHerd/issues/296>.
The live issue body and all comments were read on September 20, 2026. Both
`gh issue view --json body,comments` and the paginated comments API returned
no comments. The four maintainer decisions in the body are settled.

## Frozen inputs and history

| Input | Revision |
| --- | --- |
| Fetched `origin/main` / clean worktree parent | `c1dd1b1eccb3e5434725dfa68a178e5c1c49153f` |
| Approved upstream target | `37e9479947e183800cd557d4ccb968c2e2298ac1` |
| Merge base / already integrated upstream | `4b7d763ee3afda04985f3210b9cb9acf9359c7d9` |
| Earlier upstream integration merge | `2f549143a9b2574f72339076a4eefa70ec7b189b` |

The earlier integration has two parents:
`772033be804296394d6c52581679008c7eca6ff0` and
`4b7d763ee3afda04985f3210b9cb9acf9359c7d9`.
Its exact subject is `Merge commit '4b7d763ee3afda04985f3210b9cb9acf9359c7d9'`.
It is reachable from the frozen main revision through merged PR #277.
There are 21 upstream commits reachable from the target but not from that main.

Only the exact target was fetched for this task. The stock rehearsal script
pulls live `upstream main`, so it was not used: that would not establish the
requested pinned-only candidate. No branch was rebased, squashed, or rewritten.
The target is **not** an ancestor of this report's branch. `docs/lineage.md`
correctly continues to name `4b7d763e` as the latest integrated upstream.

## Rehearsal and stop boundary

From the isolated, clean worktree at the frozen main:

```sh
git merge --no-commit --no-ff -s ort -Xsubtree=server \
  37e9479947e183800cd557d4ccb968c2e2298ac1
git diff --name-only --diff-filter=U
git ls-files --unmerged
git diff --cc
git diff --cached --stat
```

Git 2.54.0 (Apple Git-157) returned exit 1 from the merge. The conflict paths
are recorded below. The index stages and combined conflict diff were also
captured in the execution transcript before `git merge --abort` restored the
clean baseline. No conflict was resolved and no merge commit was created.

The current [development guide](../.dev/AGENTS.md) requires: "Preserve
upstream-conflict evidence and pause for owner direction before resolving it."
That instruction is the stop boundary for this draft. The next direction
needed is permission to resolve these recorded conflicts using the **existing
settled decisions**, not a new choice about Workspace, Codium, expo-tailcat,
or CLI-first pairing. Continue in this same issue and PR after that direction.

Important conflict combinations already visible in the rehearsal:

- `daemon/run.ts`: upstream single-flight, late ownership checks and stopping
  state overlap HappyHerd authoritative recovery, side chats, automations,
  provider account selection, and permission-transition lifecycle. Preserve
  those owners while adapting duplicate-owner prevention. Do not import the
  raw fallback key path bundled into the upstream resume code.
- `persistence.ts`: upstream liveness changes include the rejected 14-day
  expiry. HappyHerd currently returns all retained records and reports failed
  persistence to callers. Neither contract may be lost.
- App `sync.ts`, reducers, first-send hooks and new-session route: preserve
  strict outbox acceptance, attachments, current provider settings, and
  Workspace/side-chat drafts while adapting receipt reconciliation and
  first-message retention.
- `HomeDock.tsx` / `machineChoices.ts`: extract zero-runnable-harness setup
  help without adopting the rejected hiding or silent rerouting of choices.
- Avatar components and storage: integrate encrypted session descriptors
  without erasing Commander, bot, or project presentation contracts.
- Upstream TypeScript translation catalogs were deleted downstream. New
  accepted product copy belongs in the en/cn/de JSON catalogs instead.
- Upstream auth combines accepted non-destructive logout with rejected
  Desktop credential linking; the whole-file upstream result is not acceptable.

### Conflict paths

All paths are relative to the repository root:

```text
server/.agents/skills/release/SKILL.md
server/packages/happy-app/CHANGELOG.md
server/packages/happy-app/sources/-session/SessionView.tsx
server/packages/happy-app/sources/app/(app)/new/index.tsx
server/packages/happy-app/sources/changelog/changelog.json
server/packages/happy-app/sources/components/Avatar.tsx
server/packages/happy-app/sources/components/EmptyMainScreen.tsx
server/packages/happy-app/sources/components/FlatSessionRow.tsx
server/packages/happy-app/sources/components/HomeDock.tsx
server/packages/happy-app/sources/components/MessageView.tsx
server/packages/happy-app/sources/components/SessionsList.tsx
server/packages/happy-app/sources/encryption/blob.test.ts
server/packages/happy-app/sources/hooks/useGroupedMessages.test.ts
server/packages/happy-app/sources/hooks/useImagePicker.test.ts
server/packages/happy-app/sources/hooks/useImagePicker.ts
server/packages/happy-app/sources/hooks/useStartSessionFromDraft.test.ts
server/packages/happy-app/sources/hooks/useStartSessionFromDraft.ts
server/packages/happy-app/sources/sync/machineChoices.spec.ts
server/packages/happy-app/sources/sync/machineChoices.ts
server/packages/happy-app/sources/sync/ops.ts
server/packages/happy-app/sources/sync/reducer/reducer.ts
server/packages/happy-app/sources/sync/rig.test.ts
server/packages/happy-app/sources/sync/storage.ts
server/packages/happy-app/sources/sync/storageTypes.ts
server/packages/happy-app/sources/sync/sync.ts
server/packages/happy-app/sources/sync/typesRaw.ts
server/packages/happy-app/sources/text/_default.ts
server/packages/happy-app/sources/text/translations/ca.ts
server/packages/happy-app/sources/text/translations/en.ts
server/packages/happy-app/sources/text/translations/es.ts
server/packages/happy-app/sources/text/translations/it.ts
server/packages/happy-app/sources/text/translations/ja.ts
server/packages/happy-app/sources/text/translations/pl.ts
server/packages/happy-app/sources/text/translations/pt.ts
server/packages/happy-app/sources/text/translations/ru.ts
server/packages/happy-app/sources/text/translations/zh-Hans.ts
server/packages/happy-app/sources/text/translations/zh-Hant.ts
server/packages/happy-cli/package.json
server/packages/happy-cli/src/api/apiMachine.ts
server/packages/happy-cli/src/codex/codexAppServerClient.ts
server/packages/happy-cli/src/codex/runCodex.ts
server/packages/happy-cli/src/daemon/controlClient.ts
server/packages/happy-cli/src/daemon/controlServer.ts
server/packages/happy-cli/src/daemon/run.resume.test.ts
server/packages/happy-cli/src/daemon/run.ts
server/packages/happy-cli/src/persistence.test.ts
server/packages/happy-cli/src/persistence.ts
```

## Accepted-group audit at the frozen baseline

"Inherited" below means represented by PR #277 and its retained integration
report, not newly verified acceptance. Do not reimport those delivered changes.
The prior PR's green CI does not prove all current authenticated/native journeys.

| Group | Baseline evidence / remaining work |
| --- | --- |
| 5 | CLI is already `@happyherd/cli`, command `happyherd`, repository HappyHerd, version `1.2.3`. Target metadata raises upstream to `1.2.4`; reconcile without reverting identity, independent releases, or downgrading a later downstream version. |
| 8, 9 | Inherited lowercase tool aliases, terminal display and raw patch preview from #277; retain richer provider result/error models. Current-head behavioral re-verification outstanding. |
| 10, 11 | Inherited Astra ordering and focus-safe prewarming from #277; retain explicit choices. Current-head interaction re-verification outstanding. |
| 16 | Inherited bounded worktree discovery from #277; stale-response and current-choice proof still required at final head. |
| 17 | Already present: `src/daemon/controlClient.ts` uses `AbortSignal.timeout(5000)` for the probe. Do not replace this with unrelated Desktop linking changes. |
| 18 | Already present: app `ChatList.tsx` tracks watched turn IDs and expands watched groups. Final-head completion/foreground interaction proof outstanding. |
| 19 | Offline-help differentiation inherited from #277. Retain CLI-first onboarding instead of upstream Desktop-first replacement. |
| 20, 21 | Off-thread syntax, bounded diff work and unified/mobile presentation inherited from #277. Final-head responsiveness/viewport and retained-layout verification outstanding. |
| 22, 23 | Plain headers and terminal/message-detail presentation inherited from #277. Preserve downstream folder/path, outcome, Projects/sidebar and Workspace contracts; final-head UI proof outstanding. |
| 24 | Outstanding: `src/commands/auth.ts` still recursively removes the shared home on logout. Adopt only credential/machine clearing from `3f91c7c4`; reject its Desktop token-sharing path. |
| 25 | Outstanding integration: `902c4fbe` changes participant attribution, receipt schemas, reducer state and sync. Current strict outbox acceptance exists but does not establish equivalence to all requested capability-gated mobile receipt behavior. |
| 29 | Outstanding: `6d0f9265` adds continuation-envelope turn repair and changes processor-mapper return shape plus `runCodex` callers. Baseline lacks `ensureCodexEnvelopeTurn`. |
| 30 | Outstanding: baseline `apiSession.close()` clears the interval, but the one-second reconnect timeout is untracked and there is no closed-state guard. Adapt `76214536` and its close/reconnect regression tests. |
| 33 | Outstanding: baseline iOS normalization converts at quality 0.92 with no resize; size validation uses pre-conversion metadata. Adapt `af053d6e` for 3072-edge sizing, final bytes and encryption overhead while retaining controlled drafts and Workspace upload limits. |
| 34 | Outstanding: baseline resume checks tracked owners before awaited recovery, but lacks the upstream per-session single-flight and late ownership reconciliation. Adapt `8aa19f04` without group 31's rejected raw key fallback or group 28's expiry. |
| 35 | Outstanding: baseline first-send hook still invokes `void sync.sendMessage(...)`; adapt `ad257d2e` for sync wait, accepted-send draft retention and idempotent session retries across both composers. |
| 36 | Outstanding: target introduces app descriptor/hydration/cache modules and server migration/transport in `38251304`, `eb482897`, `37e94799`. Existing Commander avatars are not this end-to-end session-avatar feature. |
| 38 | Outstanding: extract help from `070728ee` while preserving disabled harness visibility and saved recovery rows. Localize in JSON catalogs and prove zero-runnable state interactions. |

The single-Workspace merge-base decision, retained Codium and standalone
experimental expo-tailcat were already represented by #277. This draft makes
no runtime changes, so all rejected-group boundaries remain at the baseline;
their final integrated behavior has not been re-verified. In particular, do
not adopt upstream release notes or publisher tooling, raw key fallback,
resume expiry, Desktop credentials, separate Changes routes, bot deletion,
or harness hiding. Retain the existing terminal-evidence wait and sodium tests.

## Independent ownership and dependencies

- **#295** owns native plan/question recovery and answer persistence. Upstream
  continuation mapping touches `sessionProtocolMapper.ts`, `runCodex.ts`, and
  related app models also used by that work. Preserve its native request/turn
  identity behavior when composing the branches; this PR does not implement it.
- **#297 / #307** own CLI and non-CLI renaming. Integrate at current paths here;
  their maintainers must reconcile renamed paths and rerun the scoped rename
  process over newly integrated files. Upstream provenance and attribution
  remain exact. This draft adds no rename implementation or naming policy.
- Other provider-account/resume PRs were visible during inspection. This task
  does not take them over; reconcile their current main changes when resuming.

These are source-composition dependencies, not authority to merge or deploy.

## Verification and sign-off limits

- Verified clean initial parent equals fetched main, trusted upstream remote,
  merge base, prior two-parent upstream ancestry, and 21 unintegrated commits.
- Pinned subtree-aware merge: **failed with conflicts**, as recorded above.
- Aborted rehearsal: clean baseline restored before writing this report.
- No app, CLI, server, provider, browser, native or production acceptance run
  is claimed for the target. No target implementation exists in this draft.
- The installed `happyherd` executable was not found on PATH, so the proposal
  automation's active state, `Etc/UTC` / `17 9 * * *` schedule and latest run
  remain unproved. This does not change the owner's pinned sync authority.
- Final report/ledger checks and remote PR check status are recorded in the PR.
  They validate this documentation-only head, not upstream integration.

**Sign-off: Not signed off.** Delivery of the approved end state, two-parent
target merge, group-by-group current-head acceptance and all affected checks
remain outstanding. No runtime activation is needed for this report. No merge,
deployment, email, release, installation, restart or issue closure was performed.
