# Happy Provider

Verified 2026-08-30 against the current HappyHerd source. Recheck native Rig
metadata and behavior because its provider and mode catalogs are dynamic.

## Execution boundary

Happy is a native machine/provider boundary, not a `happy-cli` child process.
The wire contract lives in
`server/packages/happy-wire/src/rigMetadata.ts`; the app consumes it through
`server/packages/happy-app/sources/sync/rigSessionCreation.ts` and
`server/packages/happy-app/sources/sync/rig.ts`.

## Capability and permission contract

- `operatingModes[].code` is the authoritative native value.
- `value` and `description` are presentation fields.
- `kind` classifies semantics but never replaces the native code.
- Creation and active selection validate and transmit the exact code.
- `capabilities.permissionModeSelection` decides whether the UI exposes the
  selector.
- Permission callbacks and enforcement are owned by native Rig.

## Continuity

Provider restart and restoration are native Rig responsibilities. HappyHerd
hides its own resume action for these sessions rather than inventing a second
continuity path.

## Verification focus

- Use dynamic fixture codes that differ from Claude and Codex values.
- Prove exact-code creation, active selection, and display.
- Cover each advertised semantic class without treating `kind` as the value.

## Known gaps

The 2026-08-30 audit did not have a native Rig fixture or live smoke proving
callback behavior, active switching, and provider-owned restoration for every
advertised class.
