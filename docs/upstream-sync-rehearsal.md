# Upstream sync rehearsal

A5 proves that HappyHerd can consume the real `slopus/happy` lineage without
silently losing or combining owned patches. It has two independent checks:

1. `scripts/rehearse-upstream-sync.sh` clones the pushed HappyHerd `main`
   branch, fetches the real `upstream/main`, runs the non-squashed subtree pull,
   and prints a `git range-diff` of the owned patch series before and after the
   pull.
2. `scripts/contract-suite.sh` exercises lineage, patch discipline, runtime
   isolation, shell validation, and the application, wire, agent, CLI, and
   server contracts.

The rehearsal intentionally uses a disposable clone. A sync failure cannot
alter the delivery checkout, and a successful no-op cannot masquerade as a
local uncommitted state. The script also requires the local HEAD to equal the
pushed `origin/main` SHA.

The live upstream SHA recorded for this rehearsal is
`971d608923f175d3d63af7c204e8c036206b3e99`. It is the same commit as the
recorded upstream base, so the expected sync result is `Already up to date` and
an identity range-diff. If the live remote advances, the snapshot rehearsal
fails closed and must be repeated and reviewed against the new SHA.

A5 is accepted only after both scripts pass and an independent reviewer checks
the resulting patch series and evidence. The dated run output and review are
recorded in this document after execution; adding the scripts alone is not A5
acceptance.
