# Agent Workflow

## Releasing anything

Every release goes through the `release` skill: `.agents/skills/release/SKILL.md`.
Read it in full before running `eas update`, `eas build`, `eas submit`, any
`pnpm ota*` or `pnpm release:*` script, or dispatching a release workflow.
That covers preview and production OTA updates, native builds, store
submissions, and CLI publishes.

The rule the skill opens with is the one that is never skipped: **release from
a local `main` that is exactly `origin/main`, checked against a fetch made right
then, with a clean tree.** Not from a worktree. Not from a branch. Not from a
`main` that is ahead or behind. The mobile release scripts refuse anything else
(`packages/happyherd-app/sources/scripts/releasePreflight.mjs`).

The only exception is one the user asks for by name in the current
conversation. A standing instruction from an earlier session is not that, and
neither is your own judgement that it is probably fine. When they do ask, the
skill says how: show what `main` commits the release will lack, get a yes, run
with `HAPPYHERD_RELEASE_ALLOW_OFF_MAIN=1`, and say it was off-main in the report.

Why: an OTA channel serves whatever was published last, not whatever is on
`main`. On 2026-09-20 a preview OTA from a stale worktree silently rolled four
shipped fixes off every preview phone for hours. Git looked fine the whole time.

## Sync To Main

When the user says `sync to main` or `synt to main`, they mean:

1. Fetch `origin/main` and rebase the current topical branch onto it.
2. Push only that feature branch and open or update its pull request.
3. Wait for every required protected-branch check and resolve review threads.
4. Merge with a GitHub merge commit.
5. Verify the Quality and Contract main-push workflows, then delete only the
   exact merged PR head. Upstream merge proposals are owned separately by the
   native `happyherd-upstream-merge-proposal` automation.

Never push `HEAD:main` or force-push `main`. Follow the complete repository
lifecycle and race-safe cleanup procedure in
`../.dev/playbooks/development-lifecycle.md`.

## Interface localization

- Every user-facing interface term must use `t()` and exist in all three canonical JSON catalogs: `packages/happyherd-app/sources/text/locales/en.json`, `cn.json`, and `de.json`.
- English defines the key and placeholder schema. Do not add TypeScript language catalogs or inline translation objects.
- Preserve raw user content, provider/model slugs, paths, commands, logs, and protocol payloads; these are data, not interface copy.
- Run `pnpm --filter happyherd-app i18n:generate` after changing catalog keys or placeholders, then run `pnpm --filter happyherd-app i18n:check`.
- Never refresh the hardcoded-copy allowlist to hide newly introduced UI strings. Move new copy into the three catalogs. The allowlist is only the explicit legacy migration baseline.
