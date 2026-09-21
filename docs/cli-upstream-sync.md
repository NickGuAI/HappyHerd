# Preserve CLI naming during upstream synchronization

[#296](https://github.com/NickGuAI/HappyHerd/issues/296) owns the parallel
upstream integration. #297 supplies naming tooling and does not merge upstream.

1. Read the owning issue, approved upstream SHA and settled decisions. Fetch
   `origin` and trusted `upstream`, which must remain
   `https://github.com/slopus/happy.git`. Record downstream base and pinned
   upstream revision. Use an isolated clean integration branch.
2. Determine the last imported ancestor from the provenance record and
   `git merge-base`. Keep **full upstream history** reachable: no squash or
   snapshot cherry-pick in place of ancestry; preserve URLs and attribution.
3. Follow `.dev/skills/happyherd-sync-upstream/SKILL.md` and
   `scripts/rehearse-upstream-sync.sh` for the established subtree import into
   `server/`. Preserve the merge parents. Do not do a root-layout upstream
   merge that duplicates packages beside `server/`.

   ```bash
   UPSTREAM_SHA="<approved full SHA>"
   git fetch upstream "$UPSTREAM_SHA"
   git subtree merge --prefix=server "$UPSTREAM_SHA" -m "Merge commit '$UPSTREAM_SHA'"
   ```

   Do not add `--squash`. The live-head rehearsal script pulls `upstream/main`;
   for a pinned issue, rehearse the pinned SHA instead of adopting newer work.
4. Preserve conflicts and obtain owner direction as required by the sync
   skill. Map upstream `packages/happy-cli` to downstream
   `server/packages/happyherd-cli`. Integrate approved behavior at the new
   path instead of restoring the retired tree. Preserve independent
   `@happyherd/cli` release ownership and current version.
5. Track new source files and rerun the scoped tool:

   ```bash
   node scripts/rename-cli.mjs --from Happy --to HappyHerd
   node scripts/rename-cli.mjs --from Happy --to HappyHerd --apply
   git add -A
   node scripts/rename-cli.mjs --from Happy --to HappyHerd --check
   ```

   This also catches legacy text added inside the renamed tree. Review the
   [migration contract](cli-renaming.md): new env inputs need compatibility
   review; new persisted keys, external packages and encryption domains are
   not ordinary copy. Coordinate shared references with #307.
6. Run the rename, CLI, session-continuity, installer and package checks in that
   SOP. Recheck frozen-lockfile installation, product identity, scoped old-name
   scan and original session/home access. Record authenticated integration
   prerequisites and platform gaps separately.
7. Prove `git merge-base --is-ancestor APPROVED_UPSTREAM_SHA HEAD` and run
   `scripts/verify-lineage.sh`, upstream provenance and owned-patch checks.
   Preserve the merge's full parents; ledger topical owned commits and update
   the downstream changelog. Review every included commit before the PR.

For #296, primary overlaps are CLI `package.json`, `src/daemon/run.ts`,
`src/daemon/controlClient.ts`, `src/commands/auth.ts`, resume tests, workspace
manifests, `.dev`, changelog and ledger. Apply accepted behavior at renamed
paths. Keep logout home retention, independent CLI pairing, resume-record
retention and release ownership. Naming is not evidence that an upstream
behavior group was integrated.

Recovery uses the recorded starting revision or reviewed reverts, not erased
merge history or reverse blanket renaming. Merge, deployment, daemon restart
and issue closure remain separate authorized operations.
