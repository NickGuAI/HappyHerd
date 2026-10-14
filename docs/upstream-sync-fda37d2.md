# Approved upstream sync through `fda37d2`

```text
HappyHerd main 734c585c6 ──┐
                           ├─ non-squashed subtree merge → one sync PR
Upstream Happy fda37d23 ───┘                          │
                                                       ├─ keep current Expo app
                                                       └─ track deferred clients
```

This sync carries the owner-approved upstream history to
`fda37d23fa044bb03093a62bdb48a1d5689790c9` while leaving HappyHerd's current
server tree unchanged. The merge commit
`2318a0736242c316f8c45bf211ee0bf4a9f8b358` has the frozen HappyHerd head
`734c585c6275bc8ca8dee311fdbb7f19bf12e81f` as its first parent and the exact
approved upstream revision as its second parent. Its subject is
`Merge commit 'fda37d23fa044bb03093a62bdb48a1d5689790c9'`.

The approved range from the prior integrated revision
`99f415fa0d12d233a80a77fd88122bfb19b17477` contains 386 commits. Its endpoint
adds 1,298 files: 1,173 UIKit iOS files, 124 Kotlin Android files, and one
iOS-only workflow. The non-squashed subtree merge at the approved head was
clean and had no conflicts. Its imported paths were precisely those 1,298 additions. The
owner deferred both clients, so those paths were removed from the final merge
tree; `server/` is byte-identical to the frozen HappyHerd parent. The existing
Expo app, CLI, server, wire, and JavaScript dependencies therefore remain the
same. The newer `upstream/main` head is outside this approved sync.

The deferred clients' feature and adoption work is tracked separately in
[issue #430](https://github.com/NickGuAI/HappyHerd/issues/430) for iOS and
[issue #431](https://github.com/NickGuAI/HappyHerd/issues/431) for Android.
Those trackers retain acceptance coverage for HappyHerd's current supported
features, including Projects, Assistant, Commanders, Automations, Workspace,
side chats and voice, despite upstream exclusions. They also cover credentials
and session continuity, accessibility and localization, build and upgrade
proof, and publisher-owned signing, app-link, push and store setup as
prerequisites for any future client adoption. They do not authorize native
implementation in this sync; issue #429 remains the sole implementation owner
for this structural sync.

## Bounded live-upstream rehearsal diagnostic

A separate no-argument rehearsal fetched live `upstream/main` at
`6e5a085e2f287cf55b68fea3597c5c8356d0418c`, which is newer than and outside
this approved import. That rehearsal had no merge conflicts, preserved the
owned range-diff, and passed its frozen-install check. Its contract run stopped
at public-boundary verification with six findings: four non-example email
files in native iOS, a native fixture using a POSIX home path, and a rehearsal
merge identity. This is diagnostic evidence for the newer-head rehearsal only;
it does not change the exact `fda37d2` import, the approved exclusions, or the
structural verification below.

## Verification at the prepared merge

- Subtree merge: two parents; exact upstream SHA is parent two; no conflicts.
- Final server: same tree as the frozen first parent; `server/packages/happy-ios`,
  `server/packages/happy-android`, and the imported iOS workflow are absent.
- Existing CLI path `server/packages/happyherd-cli`, public package
  `@happyherd/cli`, and command `happyherd` are retained.
- Owned-patch range-diff: all 821 baseline ledger subjects match (`=`); the
  full report is produced from the frozen main and prepared candidate.
- `scripts/verify-lineage.sh`: passed.
- `scripts/verify-patch-discipline.sh`: passed (821 owned patches, 27
  `.dev`-only commits and the pinned legacy empty patch).
- `scripts/test-upstream-sync-provenance.sh`: passed (one valid and four
  rejected fixtures).
- `node scripts/verify-public-boundary.mjs`: passed.

The full contract suite, required PR checks, post-merge main workflows, and
server/daemon restart are tracked by [the owning sync issue](https://github.com/NickGuAI/HappyHerd/issues/429)
and remain separate acceptance steps.
