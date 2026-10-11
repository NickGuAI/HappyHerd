# Native parity stack provenance

Issue #369 / draft PR #419 depends on reviewed PR #413 at
`d0a853cb7ab7f3a2175417e8d795637ca797760d` for maintained iOS generation,
iOS 16 minimum, compiler compatibility and scene lifecycle. Those source
files remain owned by #413 and byte-identical to that reviewed revision in the
original pre-rebase composition.

The #369 topical commits originally reviewed as
`98e66255e52ba0c92dd3ed0fa5115d147ef3d896` and
`75b010c25bc4816b5aede945751bd0845541804d` are reapplied in that order as
single-parent patches. Both changelog entries and all topical ledger rows
are retained; at the original review head parser output contained 193 entries. Application and native
source matches the reviewed local composition tree
`6fcfe9c78cde4523e62698079b55ae788a496759`. Its rejected merge ledger row is
omitted; that merge is not part of the publication history.

The initial stack retained the original #419 four changelog baselines pending
combined-source review. Completed CI capture run `37944137557` at source
`2ab8643cc1a2b9354c0f19920aa68c45bc201271` compared all 28 variants and found
exactly four expected changelog differences. All 12 expected/actual/diff images
were individually reviewed; the other 24 actual images matched baseline bytes.
The supported importer ingested those four reviewed captures in commit
`5d266bcdab4eba2e2266d59e9b559a4f2d685202`, alongside its unique ledger row.
Application and capture inputs are unchanged from that capture source. Final-head
CI remains required; this Web capture evidence is not native/device acceptance.

For the source-only rebase, the frozen base is main at
`bd8e77108ac206874067604cb5b192fbe9d37219`. The maintained changelog parser
now reports 195 entries, and the UI inventory was regenerated from the merged
source. The four binary captures remain current-main baselines strictly as
temporary integration resolutions; they do not validate the rebased changelog
and need recapture before acceptance. Current-main local voice, Claude model
discovery and the merged iOS lifecycle remain in the base tree.

The first standalone #369 native attempt passed project generation, Pods
integration and settings validation, then failed before Swift compilation
on Xcode 27 Pod resource deployment floors. This stack has not been built
or run natively. Native module compilation, responder behavior and original
physical-device journeys remain unproved. The separate broker review request
#420 remains pending explicit maintainer approval; this composition grants
no broker design or implementation authority.
