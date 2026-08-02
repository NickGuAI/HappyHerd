# Upstream sync rehearsal

A5 proves that HappyHerd can consume the real `slopus/happy` lineage without
silently losing or combining owned patches. It has two independent checks:

1. `scripts/rehearse-upstream-sync.sh` clones the pushed HappyHerd `main`
   branch, fetches the real `upstream/main`, and runs the non-squashed subtree
   pull. When the live tree is already imported, it reconstructs the
   distribution at the previous real upstream commit, replays the exact owned
   series, advances to the current real upstream commit, and prints a
   non-tautological `git range-diff` before and after integration.
2. `scripts/contract-suite.sh` exercises lineage, patch discipline, runtime
   isolation, shell validation, and the application, wire, agent, CLI, and
   server contracts. Its provenance fixtures also prove that an unrelated
   second parent, an out-of-prefix change, and a false merge subject are each
   rejected while a valid upstream merge is accepted.

The rehearsal intentionally uses disposable clones. A sync failure cannot alter
the delivery checkout, and the reconstructed real upstream interval guarantees
that the acceptance path is not a tautological no-op. The script requires the
local HEAD to equal the pushed `origin/main` SHA, verifies every owned patch is
an identity match in the post-sync range-diff, installs from the frozen
lockfile, and runs the complete contract suite in the post-sync clone.

The first accepted run observed live upstream SHA
`971d608923f175d3d63af7c204e8c036206b3e99`. The script does not pin that SHA:
if the public remote advances, the disposable rehearsal integrates and tests
the new commit rather than silently accepting or rejecting it. Acceptance
evidence always records the observed live SHA. The subtree merge message names
that full SHA exactly, making the second-parent provenance independently
verifiable after the rehearsal.

A5 is accepted only after both scripts pass and an independent reviewer checks
the resulting patch series and evidence. Acceptance adds one dated JSON record
under `docs/acceptance/`; `scripts/verify-a5-evidence.mjs` requires the tested
commit, real non-no-op upstream interval, identity-match count, complete test
totals, successful GitHub Actions run and artifacts, and an accepted independent
review resolving all four original findings. The patch-discipline verifier
permits at most one such accepted row and validates it mechanically. Until that
record exists, every A5 manifest row remains `code-ready`.
