# Agent Workflow

## Sync To Main

When the user says `sync to main` or `synt to main`, they mean:

1. Fetch `origin/main`.
2. Rebase the current branch on `origin/main`.
3. Push the current HEAD directly to `main` with a normal push, for example:
   `git push origin HEAD:main`

Do not force push for this workflow.

## Interface localization

- Every user-facing interface term must use `t()` and exist in all three canonical JSON catalogs: `packages/happy-app/sources/text/locales/en.json`, `cn.json`, and `de.json`.
- English defines the key and placeholder schema. Do not add TypeScript language catalogs or inline translation objects.
- Preserve raw user content, provider/model slugs, paths, commands, logs, and protocol payloads; these are data, not interface copy.
- Run `pnpm --filter happy-app i18n:generate` after changing catalog keys or placeholders, then run `pnpm --filter happy-app i18n:check`.
- Never refresh the hardcoded-copy allowlist to hide newly introduced UI strings. Move new copy into the three catalogs. The allowlist is only the explicit legacy migration baseline.
