# Owned patch discipline

HappyHerd is a thin patch series over Happy, not a second implementation of
Happy. The immutable tag `happyherd-owned-baseline-2026-08-02` identifies the
last commit before product-specific G0/A1-A6 work. Its `server/` tree is exactly
the tree recorded by `happy-upstream-base-2026-08-02`.

## Mechanical contract

Run:

```bash
scripts/verify-patch-discipline.sh
```

The verifier requires all of the following:

1. the owned-baseline tag still resolves to
   `7b1acd8554f4de8c56b085f3f564a6f92865985b`;
2. the owned baseline's `server/` tree remains byte-identical to the recorded
   upstream base tree;
3. every first-parent commit after that baseline has one unique, conventional
   subject in `docs/owned-patches.tsv`;
4. ordinary owned patches are not merge commits; an upstream merge is allowed
   only when its manifest gate is explicitly `UPSTREAM_SYNC`;
5. no `fixup!`, `squash!`, `WIP`, or empty patch is present; and
6. the worktree is clean when acceptance evidence is recorded.

The subject-keyed manifest avoids self-referential commit hashes while still
resolving every patch to one exact commit. Inspect the resolved series with:

```bash
scripts/list-owned-patches.sh
```

Each future HappyHerd change must add its own manifest row in the same commit.
If several commits form one gate, they share the gate name and are reverted in
reverse commit order.

## Current gap boundaries

| Gate | Patch boundary | Revert contract |
| --- | --- | --- |
| G0 | Account-key lifecycle, backup gate, restore route, and settings visibility | Revert `feat(auth): make account keys primary and recoverable` |
| Branding | Hervald mark assets and logo-only presentation | Revert `feat(brand): apply Hervald mark to Happy surfaces` |
| A2 | Deterministic release builder followed by the Expo Hermes determinism guard | Revert the Hermes guard first, then the release builder |
| A3 | Runtime configuration, isolation validator, runner, and service unit | Revert `ops: isolate HappyHerd runtime state` |
| A4 | This manifest, verifier, and audit contract | Revert `docs: codify owned patch discipline` |

Use `git log --first-parent --format='%H %s'
happyherd-owned-baseline-2026-08-02..HEAD` to obtain the full hashes before a
revert. Reviewers should use `git show <hash>` for a single patch and
`git range-diff happyherd-owned-baseline-2026-08-02..HEAD` when comparing a
rebased or upstream-synced series.

## Dirty-reference exclusion

The separate checkout at `App/external-projects/happy` contained an uncommitted
model-detection stopgap on 2026-08-02: 17 modified files plus the untracked
`packages/happy-cli/src/daemon/detectModels.ts`. Its tracked patch ID was
`75159ef0750123dc9166f1227cfcf69688380654`.

None of that checkout was used as the HappyHerd baseline. The baseline verifier
compares Git tree objects, not filenames or timestamps:

```text
upstream base tree: 6d164e9b8cbd254becf3e3a4d26179830d74d547
owned server tree:  6d164e9b8cbd254becf3e3a4d26179830d74d547
```

One later owned patch legitimately touches
`server/packages/happy-app/sources/app/(app)/index.tsx`; its changes are the G0
account-key routes and approved logo mark, not the reference checkout's model
label experiment. The untracked `detectModels.ts` is absent from the immutable
baseline. Any future model support must enter as a new, reviewed manifest row.
