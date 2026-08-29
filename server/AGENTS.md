# Agent Workflow

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

- Every user-facing interface term must use `t()` and exist in all three canonical JSON catalogs: `packages/happy-app/sources/text/locales/en.json`, `cn.json`, and `de.json`.
- English defines the key and placeholder schema. Do not add TypeScript language catalogs or inline translation objects.
- Preserve raw user content, provider/model slugs, paths, commands, logs, and protocol payloads; these are data, not interface copy.
- Run `pnpm --filter happy-app i18n:generate` after changing catalog keys or placeholders, then run `pnpm --filter happy-app i18n:check`.
- Never refresh the hardcoded-copy allowlist to hide newly introduced UI strings. Move new copy into the three catalogs. The allowlist is only the explicit legacy migration baseline.
