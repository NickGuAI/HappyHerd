# Issue #394: source-phase evidence

Owner: https://github.com/NickGuAI/HappyHerd/issues/394

Baseline: `632dc24332e49bfd773c5163ab8c045a3b74a5cf`.
Branch: `task/issue-394-astra-20261015`.
Worker session: `cmva5cpm5157ht01s9si0jngl`.

## Established boundary

The issue and comments were read on 2026-10-15. The report does not include
an affected native version or a captured missing-subscription event/exit.
This patch does **not** establish that cause or implement subscription-driven
rotation. It repairs the independently source-evidenced false-completion part
of the acceptance contract.

`claudeRemote.ts` previously called `onReady()` for native SDK failure results
unless a narrow auth/quota classifier had already recognized the cause.
`claudeRemoteLauncher.ts` interprets that as a completed wire turn and may send
a done push. The patch passes `failed` for `is_error` results and non-success
result subtypes, and suppresses a successful-compaction announcement. Existing
quota handling remains earlier in the result path, preserving its interrupted
batch and daemon-owned rotation behavior.

The new fixtures model generic SDK errors, not the missing-subscription refusal.
They cover failed completion, unchanged error forwarding, no invented auth
classification, no quota notification, a separately queued next prompt through
the same resumed query, no replay, and launcher output flush before one failed
wire turn closes without a done notification.

## Rotation trace and unresolved cause

`providerLimits.ts` accepts rejected usage events or a provider-marked
`assistant.error=rate_limit` with an SDK-owned usage-limit prefix.
`providerLimitNotice.ts` attributes the incident to the stable account/version.
The daemon validates ownership and calls `rotateProviderSessionAfterLimit`.
`rotation.ts` marks the account temporarily limited, stops the process and
resumes the same HappyHerd session through `resumeSession`. The daemon verifies
the returned session ID before persisting the switch event. If all accounts
are limited, it publishes quota exhaustion and waits for the earliest cooldown.
This temporary quota state is not evidence of subscription eligibility. An
unknown subscription refusal must not be assigned a manufactured cooldown.

Required before full issue acceptance: sanitized actual native event/exception
or exit, affected Claude/SDK versions, a usable saved alternative case, and the
no-usable-alternative case through the supported native path. Neither private
provider state nor credentials were inspected; no real provider turn ran.

## Source-phase checks

- `git diff --check`: passed.
- `HAPPYHERD_LINT_BASE=632dc24332e49bfd773c5163ab8c045a3b74a5cf node scripts/lint-source.mjs`:
  passed (9 paths including local coordination notes).
- Node 26.6.0 built-in `stripTypeScriptTypes` parsed the three changed TypeScript
  files: passed. This is syntax evidence, not TypeScript typechecking.
- Unchanged `parseChangelog.ts` exported parser invoked through Node's built-in
  TypeScript import with its CommonJS path globals supplied: generated 200
  entries, latest `October 15 — Report failed Claude turns accurately`.
  No dependencies were installed. The pinned pnpm/tsx invocation remains to run.
- Focused CLI tests, CLI typecheck, affected package checks, rendered UI,
  exact-head review, CI, and live provider proof: not run in this source phase.
  Parent owns the sequential capacity slot and publication authorization.

No PR, push, merge, deployment, restart, account mutation, or issue closure.
No claims of a complete #394 fix or native acceptance.

Initial operational failures retained: one source-read batch mistakenly used
root-relative paths from `server/` and returned file-not-found; rerun from the
repository root succeeded. The first parent send used the wrong absolute path
to its task note and returned `ENOENT`; retry with the corrected path and the
same message ID succeeded (`queued`, seq 17462). These were not test runs.

## Intended focused verification

From `server/`, use the pinned pnpm and current lockfile once capacity is assigned:

```sh
pnpm --filter @happyherd/cli exec vitest run src/claude/claudeRemote.test.ts src/claude/claudeRemote.rotation.test.ts src/claude/claudeRemoteLauncher.test.ts src/credentialPool/providerLimits.test.ts src/credentialPool/providerLimitNotice.test.ts src/credentialPool/rotation.test.ts
pnpm --filter @happyherd/cli typecheck
pnpm --filter happyherd-app exec tsx sources/scripts/parseChangelog.ts
```

Then apply the affected-package and exact-head gates from `.dev/VERIFY.md`.
