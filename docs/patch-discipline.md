# Owned patch discipline

HappyHerd remains a reviewable distribution over Happy. The immutable tag
`happyherd-owned-baseline-2026-08-02` identifies the pristine subtree boundary;
its `server/` tree is byte-identical to `happy-upstream-base-2026-08-02`.

Run:

```bash
scripts/verify-patch-discipline.sh
```

The verifier requires:

1. the baseline tag to resolve to its pinned commit;
2. the baseline `server/` tree to match the recorded upstream tree;
3. every owned commit after the baseline to have one conventional, unique
   subject in `docs/owned-patches.tsv`, except a commit whose changed paths are
   all under `.dev/`;
4. ordinary owned patches to remain single-parent commits;
5. structural pull-request and upstream merges to satisfy their independent
   tree and provenance checks; and
6. acceptance to run from a clean worktree.

The subject-keyed ledger avoids self-referential commit hashes while resolving
every row to one exact commit. Add a row in the same commit as every future
owned change unless every changed path is under `.dev/`. Inspect the resolved
series with:

```bash
scripts/list-owned-patches.sh
git range-diff happyherd-owned-baseline-2026-08-02..HEAD
```

The baseline commit is `e6e81cf389ec4b59af00994ab3b605d40ee89054`; the release rewrite that set
this boundary intentionally consolidated the former distribution patch stack
after removing private deployment artifacts from public history.
