# Verification matrix

Run root commands from the repository root and package commands from `server/`.
Choose checks from the changed contract, not from file extension alone.

## Toolchain and installation

Root CI defines the supported verification toolchain:

```bash
node --version       # Node 20
pnpm --version       # pnpm 10.11.0
bun --version        # Bun 1.3.11
command -v shellcheck
```

Prove the lockfile is reproducible:

```bash
cd server
pnpm install --frozen-lockfile
cd ..
git diff --exit-code
```

## Cheap checks during every iteration

```bash
git diff --check
node scripts/lint-source.mjs
git status --short
```

`lint-source.mjs` scans changed and untracked source for conflict markers,
invalid JSON, and whitespace errors. It is not ESLint and it is not a formatter.

Prefer a focused Vitest file and the owning package's typecheck while iterating:

```bash
cd server
pnpm --filter happy-app exec vitest run sources/path/example.test.ts
pnpm --filter happy exec vitest run --project unit src/path/example.test.ts
pnpm --filter ./packages/happy-server exec vitest run sources/path/example.test.ts
```

## Targeted bundles

Commands in this table run from `server/` unless they start with `scripts/` or
`node scripts/`, which run from the repository root.

| Changed surface | Required targeted checks |
|---|---|
| App logic | `pnpm --filter happy-app typecheck`; `pnpm --filter happy-app test --run` |
| UI, routes, or localized copy | App checks plus `pnpm --filter happy-app i18n:check` |
| Catalog keys/placeholders | First `pnpm --filter happy-app i18n:generate`, review generated changes, then `i18n:check` |
| Route or UI-owning module | First `pnpm --filter happy-app ui:inventory:generate`, review generated changes, then `i18n:check` |
| Wire protocol | `pnpm --filter @slopus/happy-wire test`, then affected app/CLI/agent/server consumers |
| Happy CLI/provider/session logic | `pnpm --filter happy typecheck`; `pnpm --filter happy test` |
| Real provider/daemon/auth integration | `pnpm --filter happy test:integration` when its external prerequisites are available |
| HappyHerd launcher | `pnpm --filter @happyherd/cli typecheck`; `pnpm --filter @happyherd/cli test` |
| Agent runtime | `pnpm --filter happy-agent test`; `pnpm --filter @happyherd/happyherd-agent test` |
| Server | `pnpm --filter ./packages/happy-server typecheck`; `test`; `build` |
| Repository or release shell | Nearest `scripts/test-*-contract.sh`; `shellcheck -x` on changed shell files |
| Product identity | `node scripts/verify-product-identity.mjs` |
| Public boundary | `node scripts/test-public-boundary.mjs`; `node scripts/verify-public-boundary.mjs` |
| Lineage | `scripts/verify-lineage.sh` |
| Owned patch ledger | Add the exact commit subject to `docs/owned-patches.tsv`, commit it with the change, then run `scripts/verify-patch-discipline.sh` from a clean tree |

## User-visible change gate

Every user-visible HappyHerd change updates
`server/packages/happy-app/CHANGELOG.md`. Regenerate its checked-in JSON:

```bash
cd server
pnpm --filter happy-app exec tsx sources/scripts/parseChangelog.ts
```

Record the parser-reported latest title and entry count, and review
`sources/changelog/changelog.json`. CI does not currently have a dedicated
Markdown-to-JSON synchronization check, so this evidence is part of review.

## Production proof

```bash
cd server
APP_ENV=production pnpm --filter happy-app exec expo export \
  --platform web --output-dir dist-ci
grep -F '<title>HappyHerd</title>' \
  packages/happy-app/dist-ci/index.html
pnpm --filter happy build
pnpm --filter ./packages/happy-server build
```

## Full local acceptance

The contract suite requires a clean committed tree, pnpm 10.11.0, ShellCheck,
the immutable tags, and the exact trusted `upstream` remote:

```bash
scripts/contract-suite.sh
```

Then run the quality-gate surfaces that the contract suite does not cover:

```bash
cd server
pnpm --filter happy-app i18n:check
APP_ENV=production pnpm --filter happy-app exec expo export \
  --platform web --output-dir dist-ci
grep -F '<title>HappyHerd</title>' packages/happy-app/dist-ci/index.html
pnpm --filter happy build
pnpm --filter ./packages/happy-server build
```

Also run `pnpm install --frozen-lockfile` followed by `git diff --exit-code` as
shown above. There is no single local command that reproduces both root CI
workflows.

## Pull-request and permanent-main gates

A PR is ready to merge only after conversations are resolved and all required
checks pass:

- `Clean install`
- `Lint`
- `Typecheck`
- `Unit tests`
- `Production build`
- `Contract suite`

The root sources of truth are `.github/workflows/quality-gates.yml` and
`.github/workflows/contract-suite.yml`. The latter deliberately skips
`Real upstream rehearsal` on pull requests.

A merge is fully verified only when the current pushed `main` SHA passes both
main-push workflows, including the successful `Real upstream rehearsal` job.
Only then may the exact merged PR head be deleted. See the
[development lifecycle](playbooks/development-lifecycle.md) for commands and
race-safe deletion guards.

## Evidence to retain in the PR or handoff

- exact commands run and their outcomes;
- focused behavior proof for the changed invariant;
- generated-file diffs and changelog parser result when applicable;
- all six required PR check conclusions;
- merge SHA and successful main-push workflow links;
- merged head SHA, ancestry proof, and exact branch cleanup result.

The public native-launcher matrix is separate: it runs for `happyherd-v*` tags
or manual dispatch, not for ordinary PRs. Do not claim five-platform release
proof from the normal PR gates.
