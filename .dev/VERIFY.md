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
| Provider registry, Agent Defaults, or launch-mode propagation | Focus `sources/sync/agentDefaults.test.ts`, `sources/sync/settings.spec.ts`, `sources/app/(app)/settings/agents.test.ts`, `sources/app/(app)/new/index.launch.test.ts`, `sources/components/modelModeOptions.test.ts`, `sources/hooks/useNewSessionDraft.test.ts`, `sources/hooks/useStartSessionFromDraft.test.ts`, and `sources/utils/newSessionModeSelection.test.ts`; prove active-registry parity, every active provider group, explicit capability-source selection and unavailable states, selected exact-machine catalog ownership, independent provider keys, every cross-provider draft reset, empty unsupported dimensions, Rig spawn payloads in both launchers, and post-await GrokBuild/Rig revalidation; then run the full app checks |
| New provider or provider protocol behavior | Follow [the provider-onboarding playbook](playbooks/provider-onboarding.md). Prove arbitrary provider-native mode transit through wire, app, and CLI admission; exact-daemon validation and launch arguments; every advertised permission mode's callback behavior; raw/spec-shaped text, thinking, tool start/update/result/error mapping; stable call correlation; and meaningful generic app rendering. Add the missing focused fixture at the owning boundary, then run wire plus affected CLI/app package checks. Run a live provider smoke when its external prerequisites are available; argv proof alone is insufficient. |
| UI, routes, or localized copy | App checks plus `pnpm --filter happy-app i18n:check` |
| Catalog keys/placeholders | First `pnpm --filter happy-app i18n:generate`, review generated changes, then `i18n:check` |
| Route or UI-owning module | First `pnpm --filter happy-app ui:inventory:generate`, review generated changes, then `i18n:check` |
| Wire protocol | `pnpm --filter @slopus/happy-wire test`, then affected app/CLI/agent/server consumers |
| Happy CLI/provider/session logic | `pnpm --filter happy typecheck`; `pnpm --filter happy test` |
| Local side-chat authentication | Focus `src/commands/machine.test.ts`, `src/commands/sideChat.test.ts`, and `src/daemon/run.resume.test.ts`; then, with the account-control link absent, run `happy session side-chat <local-parent-id> --json` and confirm the returned child is active under the same daemon without a QR prompt |
| Session continuity across updates/restarts | `pnpm --filter happy test:session-continuity` must include recent and older-than-14-day records, then run the Happy CLI typecheck/tests |
| Real provider/daemon/auth integration | `pnpm --filter happy test:integration` when its external prerequisites are available |
| Local installer and HappyHerd alias | `scripts/test-public-launcher-release-contract.sh`; `pnpm --filter @happyherd/cli typecheck`; `pnpm --filter @happyherd/cli test`; shellcheck changed installer scripts |
| Agent runtime | `pnpm --filter happy-agent test`; `pnpm --filter @happyherd/happyherd-agent test` |
| Server | `pnpm --filter ./packages/happy-server typecheck`; `test`; `build` |
| Repository or deployment shell | `scripts/test-component-deployment-contract.sh`; nearest other `scripts/test-*-contract.sh`; `shellcheck -x` on changed shell files |
| Product identity | `node scripts/verify-product-identity.mjs` |
| Public boundary | `node scripts/test-public-boundary.mjs`; `node scripts/verify-public-boundary.mjs` |
| Lineage | `scripts/verify-lineage.sh` |
| Owned patch ledger | Unless every changed path is under `.dev/`, add the exact commit subject to `docs/owned-patches.tsv`; then run `scripts/verify-patch-discipline.sh` from a clean tree |

## Provider onboarding conformance

Every new provider, and every provider protocol-shape change, needs a
deterministic vertical-slice fixture. The minimum matrix is:

| Plane | Deterministic proof | Live proof when available |
|---|---|---|
| Capability ownership | Models, efforts, and permission modes come from the documented provider source; unsupported dimensions are empty | Catalog matches the installed provider version |
| Prompt admission | A provider-native mode not known to Claude or Codex survives wire, app, and CLI transit and reaches the provider boundary | One prompt reaches the selected provider |
| Launch/runtime selection | Exact native arguments or runtime selector; plan/build remains independent from permission policy; app and terminal resume restore persisted policy only after exact-machine catalog validation | Selected mode remains visible after a real resume |
| Permission callbacks | A synthetic late callback after startup and after resume prompts exactly once for interactive modes; allow-without-prompt selects only an advertised allow option; deny-without-prompt selects an advertised reject or cancels; neither non-interactive mode creates a pending request; unknown modes fail safe | Harmless calls show zero prompts and the documented allow/deny outcome in non-interactive modes, plus a prompt where the interactive contract requires one |
| Tool events | Start from a raw/spec-shaped unfamiliar tool with required title, optional category absent, and structured input. Split later descriptor and output/error deltas from a status-only completion/failure; preserve the accumulated fields, original start time, title, and call ID across the CLI, wire, and app model. | Harmless unfamiliar/native tool has a meaningful activity label and paired completion |
| App rendering | Normalize and reduce the real wire shape; prove compact and expanded generic views prefer authoritative provider text without a `knownTools` entry | Tool call is readable on the supported app surface |

Provider integration tests that inject an already-normalized `AgentMessage` do
not satisfy the raw-event row. Permission tests that stop after constructing
argv do not satisfy the callback row. Keep security-feature approval evidence
separate from test evidence; both are required when the implementation
introduces or expands Happy-owned permission enforcement.

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

## Combined post-update runtime acceptance

When an operator intentionally updates both the central server/Web component
and a native CLI/daemon host, follow
[`playbooks/post-update-restart.md`](playbooks/post-update-restart.md). Runtime
acceptance is ordered and is separate from build or CI proof:

1. deploy and restart the selected server image first;
2. retain local/public `/health`, service start-time, configured-image, and OCI
   revision read-backs;
3. stop, upgrade, and start the daemon as the same host account with the same
   Happy home and environment;
4. compare exact pre/post session IDs and continue one historical session when
   session or recovery behavior changed; and
5. refresh the website and verify the existing machine name, online state, paths,
   and provider catalogs.

An online machine labeled `unknown machine` fails this acceptance. Do not
delete or recreate it: verify the required decrypted metadata shape and use the
authenticated versioned metadata-update owner described in the playbook.

## Full local acceptance

The contract suite requires a clean committed tree, pnpm 10.11.0, ShellCheck,
the recorded upstream lineage tag, and the exact trusted `upstream` remote. It
is an integration gate; it does not build or activate a lockstep release:

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

## Pull-request and post-merge proof planes

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

After merge, evaluate two proof planes independently:

- **Ordinary feature permanence:** the current pushed `main` SHA has a
  successful Quality workflow, a successful `Contract suite` job, and both the
  merged head and merge commit are ancestors of `origin/main`. This proves an
  unrelated feature permanent and permits cleanup of its exact PR head.
- **Upstream readiness:** the `Real upstream rehearsal` job succeeds.

The aggregate contract workflow may be red solely because the rehearsal found
a Git merge conflict. Once the job log establishes that conflict, retain the
evidence and route it to the owning TickTick task for owner direction. It
blocks upstream reconciliation and any resolution PR, but does not block
cleanup of an otherwise verified unrelated feature. Any required-job failure
outside this verified conflict case remains blocking. See the
[development lifecycle](playbooks/development-lifecycle.md) for commands and
race-safe deletion guards.

## Evidence to retain in the PR or handoff

- exact commands run and their outcomes;
- focused behavior proof for the changed invariant;
- generated-file diffs and changelog parser result when applicable;
- all six required PR check conclusions;
- merge SHA, successful Quality and `Contract suite` job evidence;
- `Real upstream rehearsal` conclusion and log, including retained conflict
  evidence and owning-task routing when applicable;
- merged head SHA, ancestry proof, and exact branch cleanup result.

The public native-launcher matrix is separate: it runs for `happyherd-v*` tags
or manual dispatch, not for ordinary PRs. Do not claim five-platform release
proof from the normal PR gates.
