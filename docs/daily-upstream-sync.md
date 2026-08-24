# Daily Happy upstream sync

`.github/workflows/upstream-sync.yml` checks Happy's public `main` once a day
and turns one frozen comparison into either one reviewed pull request, one
conflict issue, or a no-op. It never auto-merges and it never changes the
frozen commits while a run is active.

```text
09:17 UTC / manual dispatch
          │
          ▼
╔══════════════════════════════════════════════════════════════╗
║ PREPARE · read-only token                                   ║
║ Freeze HappyHerd main + Happy main → exact subtree merge    ║
║ Output hashes + Git bundle OR complete conflict evidence    ║
╚══════════════════════════════════════════════════════════════╝
          │ clean                         │ conflict / no-op
          ▼                               │
╔══════════════════════════════════════╗   │
║ VALIDATE · read-only token           ║   │
║ Fresh runner checks out the bundle   ║   │
║ Install, contracts, tests, build     ║   │
╚══════════════════════════════════════╝   │
          │ pass                          │
          └──────────────┬─────────────────┘
                         ▼
╔══════════════════════════════════════════════════════════════╗
║ PUBLISH · narrow write token                                ║
║ Fresh trusted-base checkout; verify hashes + topology       ║
║ Never check out or execute imported upstream content        ║
╚══════════════════════════════════════════════════════════════╝
          │ clean             │ conflict             │ no-op
          ▼                   ▼                      ▼
 automation/upstream-sync   one canonical issue     no write
 + one open reviewed PR     + evidence artifact
```

## Frozen-run contract

- The workflow runs at `17 9 * * *` and supports `workflow_dispatch`.
- Concurrency serializes runs without cancelling an active run.
- The workflow event's exact `main` SHA is the HappyHerd base. The prepare job
  verifies that it is still remote `main`, resolves Happy `main` exactly once,
  and fetches both commits by SHA. A later commit waits for the next run.
- A clean result is a real two-parent, non-squashed subtree merge. Its first
  parent is the frozen HappyHerd SHA, its second parent is the frozen Happy SHA,
  and its changes are confined to `server/`.
- The merge author and committer are
  `HappyHerd Maintainers <maintainers@happyherd.example>`.
- Publication rechecks that HappyHerd `main` has not advanced. A stale run
  exits without overwriting the fixed branch.

## Outcomes

For a clean merge, the read-only validation runner performs the frozen install,
repository contract suite, localization/type checks, and production builds.
Only a passing result reaches publication. The publication job verifies the
artifact's per-file SHA-256 manifest, exact Git bundle ref, two-parent topology,
commit identity, and `server/`-only diff without checking out the result. It
then updates `automation/upstream-sync` with a lease and creates or updates its
single open pull request. Review and merge remain human actions.

For a conflict, publication does not push a result and does not create a pull
request. It opens or updates the one issue titled
`[upstream sync] Happy main conflict requires reconciliation`. The issue holds
the complete human-readable path/blob map (split across comments only if the
GitHub body limit requires it) and links the 90-day evidence artifact. That
artifact also contains byte-exact NUL-delimited Git status and stage records,
the merge log, frozen metadata, and hashes.

When the frozen Happy commit is already reachable from HappyHerd `main`, the
run verifies the no-op evidence and writes nothing.

## Repository activation

The repository owner must enable pull-request creation for `GITHUB_TOKEN`:

1. Open **Settings → Actions → General**.
2. Under **Workflow permissions**, enable **Allow GitHub Actions to create and
   approve pull requests**. The workflow creates pull requests but does not
   approve or merge them.

GitHub puts `pull_request` workflows created or synchronized by `GITHUB_TOKEN`
into an approval-required state. A person with repository write access must
select **Approve workflows to run** on the pull request before the normal
required checks begin. This is expected and must not be bypassed with an
auto-merge token.

References:

- [GitHub Actions repository settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [Events triggered by `GITHUB_TOKEN`](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)
- [Artifact digest validation](https://docs.github.com/en/enterprise-cloud@latest/actions/tutorials/store-and-share-data#validating-artifacts)

After this file and the workflow reach default `main`, use **Run workflow** once
on `main`. Keep the resulting frozen SHAs, outcome, artifact link, and job
conclusions as activation evidence.
