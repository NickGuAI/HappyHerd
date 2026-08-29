# Upstream merge proposal

Upstream readiness is investigated by the machine-local HappyHerd automation
named `happyherd-upstream-merge-proposal`, not by GitHub Actions. It preserves
the former daily `17 9 * * *` cadence in `Etc/UTC` while keeping expected merge
conflicts out of normal feature status checks and GitHub notifications.

The automation freezes current HappyHerd origin main and `slopus/happy` main in
a disposable clone. `scripts/rehearse-upstream-sync.sh` remains the
read-only evidence owner: it performs the non-squashed subtree merge, checks
the owned series with `git range-diff`, and runs the full contract suite when
the merge is clean. `scripts/test-upstream-sync-provenance.sh` continues to
prove accepted merge topology. The canonical checkout is never mutated.

```text
same upstream SHA ──→ silent no-op
new upstream SHA  ──→ one deduplicated AgentWork proposal
                         ├─ features and impact
                         ├─ resolvable conflicts
                         └─ genuine owner decisions only
```

The automation may read GitHub and write the scoped TickTick proposal. It must
never push a branch, create or update a GitHub issue or pull request, merge,
deploy, alter the canonical checkout, or create failure-alert tasks. A proposal
is not merge authority; implementation still proceeds through the normal
reviewed branch and pull-request lifecycle after owner direction.
