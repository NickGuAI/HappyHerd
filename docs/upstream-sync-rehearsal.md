# Upstream sync rehearsal

The upstream rehearsal proves that HappyHerd can consume the real
`slopus/happy` lineage without silently losing or combining owned patches.

1. `scripts/rehearse-upstream-sync.sh` clones the pushed `main`, fetches
   `upstream/main`, and performs a non-squashed subtree pull.
2. When upstream advances, it compares the owned series before and after the
   real integration with `git range-diff` and rejects a lost or combined owned
   patch. A merge conflict remains a failing rehearsal that requires a real
   upstream-sync change; an already-integrated upstream is a successful no-op.
3. The full contract suite runs inside the disposable clone at the exact
   post-sync tree, including the no-op case.

The delivery checkout is never mutated. The rehearsal requires local `HEAD` to
equal pushed `origin/main`, validates the trusted upstream URL and second-parent
ancestry, and rejects changes escaping the `server/` prefix. CI keeps short-lived
logs as workflow artifacts; generated logs and operator deployment evidence do
not belong in public source history.
