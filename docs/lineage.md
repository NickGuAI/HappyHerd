# Source lineage

HappyHerd preserves Happy's complete Git history as a subtree at `server/`.

- Upstream: `https://github.com/slopus/happy.git`
- Remote name: `upstream`
- Import mode: `git subtree` without `--squash`
- Upstream base: `971d608923f175d3d63af7c204e8c036206b3e99`
- Upstream base tag: `happy-upstream-base-2026-08-02`
- Upstream base tree: `6d164e9b8cbd254becf3e3a4d26179830d74d547`
- Lineage merge: `95da7a96a5c1ba21d0d152c04cf50c58c4f07702`
- Pristine materialization: `b88bb71822dcb2e3ad4183f2135f10c7b9cba238`
- Product rename in G0/A1-A6: none

The initial import connected the unrelated distribution-shell root to the
upstream commit and materialized that exact upstream tree under `server/`.
This keeps every upstream commit reachable and allows ordinary, non-squashed
`git subtree pull --prefix=server upstream main` updates.

Run `scripts/verify-lineage.sh` from anywhere in the checkout to verify the
remote contract, immutable base tag, full-history ancestry, and pristine import
tree. Owned HappyHerd patches may change the current `server/` tree; the script
therefore compares the upstream tree with the immutable materialization commit.
