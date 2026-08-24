# Source lineage

HappyHerd preserves Happy's complete Git history as a subtree at `server/`.

- Upstream: `https://github.com/slopus/happy.git`
- Remote name: `upstream`
- Import mode: `git subtree` without `--squash`
- Upstream base: `971d608923f175d3d63af7c204e8c036206b3e99`
- Latest integrated upstream: `046bb0b947f2deccda3aed03aea2515d96d75269`
- Upstream base tag: `happy-upstream-base-2026-08-02`
- Upstream base tree: `6d164e9b8cbd254becf3e3a4d26179830d74d547`
- Distribution shell: `b7ebaba52aa2072b474fd59e515ef5102dd60945`
- Lineage merge: `7a52067b800d6a1f5349ddad44707074373b8342`
- Pristine materialization: `e6e81cf389ec4b59af00994ab3b605d40ee89054`
- Product rename in G0/A1-A6: none

The sanitized import connects an organization-neutral distribution shell to
the unchanged upstream commit and materializes that exact tree under `server/`.
Subsequent audited subtree merges advance that public lineage through the
recorded integrated upstream commit before HappyHerd-owned patches are
applied. This keeps every upstream commit reachable and allows ordinary,
non-squashed `git subtree pull --prefix=server upstream main` updates.

Run `scripts/verify-lineage.sh` from anywhere in the checkout to verify the
remote contract, immutable base tag, full-history ancestry, and pristine import
tree. Owned HappyHerd patches may change the current `server/` tree; the script
therefore compares the upstream tree with the immutable materialization commit.
