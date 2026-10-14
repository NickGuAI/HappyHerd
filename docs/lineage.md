# Source lineage

HappyHerd preserves Happy's complete Git history as a subtree at `server/`.

- Upstream: `https://github.com/slopus/happy.git`
- Remote name: `upstream`
- Import mode: `git subtree` without `--squash`
- Upstream base: `971d608923f175d3d63af7c204e8c036206b3e99`
- Latest integrated upstream: `fda37d23fa044bb03093a62bdb48a1d5689790c9`
- Upstream base tag: `happy-upstream-base-2026-08-02`
- Upstream base tree: `6d164e9b8cbd254becf3e3a4d26179830d74d547`
- Distribution shell: `b7ebaba52aa2072b474fd59e515ef5102dd60945`
- Lineage merge: `7a52067b800d6a1f5349ddad44707074373b8342`
- Pristine materialization: `e6e81cf389ec4b59af00994ab3b605d40ee89054`
- Product rename in G0/A1-A6: none

The 2026-10-14 approved sync retains upstream history through
`fda37d23fa044bb03093a62bdb48a1d5689790c9` as the second parent of the
non-squashed merge `2318a0736242c316f8c45bf211ee0bf4a9f8b358`. Per the
maintainer's recorded decisions, its new UIKit and Kotlin client trees and the
iOS-only workflow are excluded from the final distribution tree; the parity
work is tracked in [issue #430](https://github.com/NickGuAI/HappyHerd/issues/430)
and [issue #431](https://github.com/NickGuAI/HappyHerd/issues/431). The
existing Expo client and its publisher identities remain the supported mobile
surface. See [the sync report](upstream-sync-fda37d2.md) for the exact range
and verification evidence.

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
