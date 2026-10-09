# Native parity stack provenance

Issue #369 / draft PR #419 depends on reviewed PR #413 at
`d0a853cb7ab7f3a2175417e8d795637ca797760d` for maintained iOS generation,
iOS 16 minimum, compiler compatibility and scene lifecycle. Those source
files remain owned by #413 and byte-identical to that reviewed revision.

The #369 topical commits originally reviewed as
`98e66255e52ba0c92dd3ed0fa5115d147ef3d896` and
`75b010c25bc4816b5aede945751bd0845541804d` are reapplied in that order as
single-parent patches. Both changelog entries and all topical ledger rows
are retained; parser output contains 193 entries. Application and native
source matches the reviewed local composition tree
`6fcfe9c78cde4523e62698079b55ae788a496759`. Its rejected merge ledger row is
omitted; that merge is not part of the publication history.

The four retained `production-changelog-latest-entries` PNGs are the original
#419 baselines and are **unverified for this combined source**. The other
24 baselines are unchanged. Combined-source capture review and supported
four-image ingestion remain required; parent-source green results cannot
be relabeled as combined verification.

The first standalone #369 native attempt passed project generation, Pods
integration and settings validation, then failed before Swift compilation
on Xcode 27 Pod resource deployment floors. This stack has not been built
or run natively. Native module compilation, responder behavior and original
physical-device journeys remain unproved. The separate broker review request
#420 remains pending explicit maintainer approval; this composition grants
no broker design or implementation authority.
