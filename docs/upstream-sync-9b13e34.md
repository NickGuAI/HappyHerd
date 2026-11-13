# Approved upstream sync through `9b13e34`

```text
HappyHerd baseline 921470539 ──┐
                              ├─ full-history subtree merge → owned adaptation
Happy upstream 9b13e34 ────────┘                                │
                                                              ├─ shared new-machine schema
                                                              └─ explicit server Web API types

Existing Expo / Web / Tauri / control agent / TypeScript server → retained
```

[Issue #447](https://github.com/NickGuAI/HappyHerd/issues/447) records approval
for this exact target and its dispositions. Later upstream commits are outside
the integration.

## Frozen history and conflict resolution

- Distribution baseline: `9214705391fc8498f85f99d9ec2d7c3c7f5c6300`.
- Previous integrated upstream: `a1f694ba3e4e652838b602eacd3b107619024dc2`.
- Approved target: `9b13e34ae00571b6c904c807e3c81b57787d53eb`.
- Structural merge: `04f635298d1b2f077d94fb9ceb4fb6c67f36456e`.
- Parents, in order: the distribution baseline and the approved target.
- Subject: `Merge commit '9b13e34ae00571b6c904c807e3c81b57787d53eb'`.

The approved upstream interval contains 1,213 commits and 7,360 changed paths
under a no-renames comparison, with 621,983 additions and 289,750 deletions.
The pinned subtree merge produced 2,155 unresolved paths: 1,358 upstream
deletions/downstream modifications, 746 downstream deletions/upstream
modifications, 32 both-modified paths, seven upstream additions, six
both-deleted paths and six downstream additions. The raw merge output and
complete unmerged index were preserved before resolution. The structural
merge retains the baseline tree byte for byte; its second parent makes the
complete approved upstream history reachable. A separate owned patch applies
only the two accepted changes below.

The maintained no-argument rehearsal also attempted the live upstream head in
a disposable clone. It stopped on conflicts before range-diff, installation
or contract tests. That live-head rehearsal does not expand the pinned target.
The final owned range-diff and local checks are collected separately from the
actual resolved integration.

## Accepted adaptations

Both accepted changes originate in upstream commit
`e46a907d269ac87e3c1836e9ff1f9f48e87cbc01`; its unrelated client deletions are
excluded.

The existing `new-machine` body moves into `@happyherd/wire` as
`NewMachineBodySchema`, together with `NewMachineUpdateContainerSchema` and
upstream tests for retaining metadata/data keys, accepting legacy keyless
machines and rejecting incomplete events. The retained app keeps its public
`ApiUpdateNewMachineSchema` name as an alias to the identical shared schema.
The server creation-route tests use the shared container instead of importing
app source. Event production, encryption initialization and runtime validation
keep their existing payload and behavior.

The TypeScript server declares `dom` alongside `es2022` and
`esnext.asynciterable`, so Node WebAssembly/Blob types do not depend on client
packages supplying ambient declarations. Its existing build configuration
continues to extend that configuration and exclude tests.
The transcription decoder's return type records its existing ArrayBuffer-backed
allocation, so the unchanged audio bytes satisfy the explicit DOM `BlobPart`
declaration. No runtime conversion or audio-copy behavior is added.

These are schema-ownership and type-declaration changes without a user-visible
behavior change, so the existing product changelog is retained.

## Preserved contracts

The integration retains the Expo, Web and Tauri clients, control agent,
self-hosted Web bundle, TypeScript/Redis server, database-backed session
history, en/cn/de product catalogs, current independent release identities and
owned tooling. `server/packages/happyherd-cli` remains the in-place CLI with
package `@happyherd/cli` and command `happyherd`.

The recorded owner decisions reject the public Cloudflare/D1 push relay,
reducing the five-hour voice hard limit to two hours, and S3 history offload or
deletion of database history. Server-side voice entitlement checks remain.
The other rejected groups include Swift/Kotlin/AppKit client replacements,
Rust production server, native-only releases and localization, Happy Cloud,
Vault, Surfaces, Gen UI and their related trust and product boundaries.

## Verification boundary

Local acceptance covers lineage, merge provenance, owned patch preservation,
public boundary, focused wire/app/server contracts, frozen dependencies,
package checks and the repository contract/production checks. Exact results
are retained in the issue and pull-request handoff. Required PR checks,
independent review and post-main Quality/Contract workflows remain separate
delivery proof. This source integration does not deploy, install, release,
restart services or change the proposal automation.

The read-only automation inspection found `happyherd-upstream-merge-proposal`
active, in `Etc/UTC`, on `17 9 * * *`. Its latest run completed on 2026-11-13
at 09:51 UTC.
